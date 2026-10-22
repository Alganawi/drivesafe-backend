import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  db, Devices, Contacts, Events, Trials,
  SCENARIOS, SEVERITY, CRASH_TYPE, MAX_CONTACTS
} from './db.js';

import {
  buildReport, reportToCsv, parseEventsCsv, parseTrialsCsv
} from './analysis.js';

import {
  Router, sendJson, sendText, sendError, readJson, readBody, serveStatic
} from './http.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const PORT  = Number(process.env.PORT ?? 3000);
const HOST  = process.env.HOST ?? '0.0.0.0';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

const router = new Router();

function requireAdmin(req) {
  if (!ADMIN_TOKEN) return;
  const got = req.headers['x-admin-token'];
  if (got !== ADMIN_TOKEN) {
    throw Object.assign(new Error('Token admin tidak valid'), { status: 401 });
  }
}

function deviceOr404(id) {
  const d = Devices.byId(Number(id));
  if (!d) throw Object.assign(new Error('Perangkat tidak ditemukan'), { status: 404 });
  return d;
}

const asInt = (v, d = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

router.get('/api/v1/health', (req, res) => {
  sendJson(res, 200, {
    ok: true,
    service: 'DriveSafe Backend',
    document: 'C-251-B06',
    version: '1.0.0',
    node: process.version,
    uptime_s: Math.round(process.uptime()),
    time: new Date().toISOString()
  });
});

router.get('/api/v1/meta', (req, res) => {
  sendJson(res, 200, {
    ok: true,
    scenarios: SCENARIOS,
    severity: SEVERITY,
    crash_type: CRASH_TYPE,
    max_contacts: MAX_CONTACTS,
    profiles: ['sepeda', 'motor', 'mobil'],
    admin_required: Boolean(ADMIN_TOKEN)
  });
});

router.get('/api/v1/stats', (req, res) => {
  requireAdmin(req);
  const devices = Devices.all();
  const report  = buildReport();
  sendJson(res, 200, {
    ok: true,
    devices: { total: devices.length },
    events: Events.stats(),
    trials: {
      done: report.progress.done,
      planned: report.progress.planned,
      recall: report.metrics.recall
    }
  });
});

router.get('/api/v1/devices', (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, { ok: true, data: Devices.all() });
});

router.post('/api/v1/devices', async (req, res) => {
  requireAdmin(req);
  const b = await readJson(req);
  if (!b.device_id || String(b.device_id).trim() === '') {
    return sendError(res, 400, 'device_id wajib diisi, mis. "DriveSafe-0078"');
  }
  if (Devices.byDeviceId(String(b.device_id).trim())) {
    return sendError(res, 409, 'device_id sudah terdaftar');
  }
  const profile = ['sepeda', 'motor', 'mobil'].includes(b.profile) ? b.profile : 'motor';
  const dev = Devices.create({
    device_id: String(b.device_id).trim(),
    mac: b.mac ?? null,
    owner: b.owner ?? 'Pengguna',
    profile,
    countdown_s: asInt(b.countdown_s, 30)
  });
  sendJson(res, 201, { ok: true, data: dev });
});

router.get('/api/v1/devices/:id', (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  sendJson(res, 200, {
    ok: true,
    data: { ...d, contacts: Contacts.forDevice(d.id) }
  });
});

router.patch('/api/v1/devices/:id', async (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  const b = await readJson(req);
  const fields = {};
  if (b.owner !== undefined) fields.owner = String(b.owner);
  if (b.profile !== undefined) {
    if (!['sepeda', 'motor', 'mobil'].includes(b.profile)) {
      return sendError(res, 400, 'profile harus sepeda, motor, atau mobil');
    }
    fields.profile = b.profile;
  }
  if (b.countdown_s !== undefined) {
    const c = asInt(b.countdown_s);
    if (c === null || c < 5 || c > 120) {
      return sendError(res, 400, 'countdown_s harus 5-120 detik');
    }
    fields.countdown_s = c;
  }
  sendJson(res, 200, { ok: true, data: Devices.update(d.id, fields) });
});

router.delete('/api/v1/devices/:id', (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  Devices.remove(d.id);
  sendJson(res, 200, { ok: true });
});

router.get('/api/v1/devices/:id/contacts', (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  sendJson(res, 200, { ok: true, data: Contacts.forDevice(d.id) });
});

router.post('/api/v1/devices/:id/contacts', async (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  const b = await readJson(req);
  const phone = String(b.phone ?? '').trim();
  if (phone.length < 8) {
    return sendError(res, 400, 'Nomor telepon minimal 8 karakter, format +62...');
  }
  const c = Contacts.create(d.id, {
    name: String(b.name ?? '-').slice(0, 15),
    phone: phone.slice(0, 15),
    priority: asInt(b.priority, 1)
  });
  sendJson(res, 201, { ok: true, data: c });
});

router.put('/api/v1/devices/:id/contacts', async (req, res, { params }) => {
  requireAdmin(req);
  const d = deviceOr404(params.id);
  const b = await readJson(req);
  if (!Array.isArray(b.contacts)) {
    return sendError(res, 400, 'Body harus berisi array "contacts"');
  }
  const list = b.contacts
    .filter(c => String(c.phone ?? '').trim().length >= 8)
    .map(c => ({
      name: String(c.name ?? '-').slice(0, 15),
      phone: String(c.phone).trim().slice(0, 15),
      priority: asInt(c.priority, 1)
    }));
  sendJson(res, 200, { ok: true, data: Contacts.replaceAll(d.id, list) });
});

router.patch('/api/v1/contacts/:id', async (req, res, { params }) => {
  requireAdmin(req);
  const c = Contacts.byId(Number(params.id));
  if (!c) return sendError(res, 404, 'Kontak tidak ditemukan');
  const b = await readJson(req);
  sendJson(res, 200, {
    ok: true,
    data: Contacts.update(c.id, {
      name: b.name === undefined ? null : String(b.name).slice(0, 15),
      phone: b.phone === undefined ? null : String(b.phone).slice(0, 15),
      priority: b.priority === undefined ? null : asInt(b.priority, 1)
    })
  });
});

router.delete('/api/v1/contacts/:id', (req, res, { params }) => {
  requireAdmin(req);
  if (!Contacts.remove(Number(params.id))) {
    return sendError(res, 404, 'Kontak tidak ditemukan');
  }
  sendJson(res, 200, { ok: true });
});

router.get('/api/v1/events', (req, res, { query }) => {
  requireAdmin(req);
  const deviceId = query.get('device_id') ? Number(query.get('device_id')) : null;
  const limit  = Math.min(500, asInt(query.get('limit'), 100));
  const offset = Math.max(0, asInt(query.get('offset'), 0));
  const rows = Events.list({ deviceId, limit, offset });
  sendJson(res, 200, {
    ok: true,
    data: rows.map(decorateEvent),
    count: rows.length
  });
});

router.get('/api/v1/events/:id', (req, res, { params }) => {
  requireAdmin(req);
  const e = Events.byId(Number(params.id));
  if (!e) return sendError(res, 404, 'Event tidak ditemukan');
  sendJson(res, 200, { ok: true, data: decorateEvent(e) });
});

router.delete('/api/v1/events/:id', (req, res, { params }) => {
  requireAdmin(req);
  if (!Events.remove(Number(params.id))) {
    return sendError(res, 404, 'Event tidak ditemukan');
  }
  sendJson(res, 200, { ok: true });
});

router.post('/api/v1/events/import', async (req, res, { query }) => {
  requireAdmin(req);
  const deviceId = Number(query.get('device_id'));
  const dev = Devices.byId(deviceId);
  if (!dev) return sendError(res, 400, 'Parameter device_id wajib dan harus valid');

  const text = (await readBody(req)).toString('utf8');
  const { rows, errors } = parseEventsCsv(text);

  let inserted = 0, duplicate = 0;
  for (const r of rows) {
    const created = Events.create(dev.id, r);
    if (created) inserted++; else duplicate++;
  }
  sendJson(res, 200, {
    ok: true,
    parsed: rows.length,
    inserted,
    duplicate,
    errors
  });
});

function decorateEvent(e) {
  return {
    ...e,
    severity_name: SEVERITY[e.severity] ?? '-',
    crash_type_name: CRASH_TYPE[e.crash_type] ?? '-',
    maps_url: (e.lat && e.lon)
      ? `https://maps.google.com/?q=${e.lat.toFixed(6)},${e.lon.toFixed(6)}`
      : null,
    triggers: [
      e.flags & 0x01 ? 'G-Force' : null,
      e.flags & 0x02 ? 'Jerk' : null,
      e.flags & 0x04 ? 'Rotational Jerk' : null,
      e.flags & 0x08 ? 'Shock XY' : null,
      e.flags & 0x10 ? 'Rollover' : null
    ].filter(Boolean)
  };
}

router.get('/api/v1/trials', (req, res, { query }) => {
  requireAdmin(req);
  const scenario = query.get('scenario') ? Number(query.get('scenario')) : null;
  sendJson(res, 200, { ok: true, data: Trials.list({ scenario }) });
});

router.post('/api/v1/trials', async (req, res) => {
  requireAdmin(req);
  const b = await readJson(req);
  const scenario = asInt(b.scenario);
  if (!SCENARIOS.some(s => s.no === scenario)) {
    return sendError(res, 400, 'scenario harus 1-7 sesuai Tabel 10.2', {
      scenarios: SCENARIOS
    });
  }
  if (b.predicted === undefined) {
    return sendError(res, 400, 'predicted wajib diisi (1 = sistem memicu alarm, 0 = tidak)');
  }
  const t = Trials.create({
    device_id: b.device_id ? Number(b.device_id) : null,
    scenario,
    repetition: b.repetition !== undefined ? asInt(b.repetition) : undefined,
    predicted: b.predicted ? 1 : 0,
    g_peak: b.g_peak ?? null,
    j_peak: b.j_peak ?? null,
    r_peak: b.r_peak ?? null,
    detect_ms: b.detect_ms !== undefined ? asInt(b.detect_ms) : null,
    sms_ms: b.sms_ms !== undefined ? asInt(b.sms_ms) : null,
    note: b.note ?? null
  });
  sendJson(res, 201, { ok: true, data: t });
});

router.delete('/api/v1/trials/:id', (req, res, { params }) => {
  requireAdmin(req);
  if (!Trials.remove(Number(params.id))) {
    return sendError(res, 404, 'Trial tidak ditemukan');
  }
  sendJson(res, 200, { ok: true });
});

router.post('/api/v1/trials/import', async (req, res) => {
  requireAdmin(req);
  const text = (await readBody(req)).toString('utf8');
  const { rows, errors } = parseTrialsCsv(text);
  let inserted = 0;
  for (const r of rows) { Trials.create(r); inserted++; }
  sendJson(res, 200, { ok: true, parsed: rows.length, inserted, errors });
});

router.post('/api/v1/trials/reset', (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, { ok: true, deleted: Trials.clear() });
});

router.get('/api/v1/analysis', (req, res) => {
  requireAdmin(req);
  sendJson(res, 200, { ok: true, data: buildReport() });
});

router.get('/api/v1/analysis.csv', (req, res) => {
  requireAdmin(req);
  const csv = reportToCsv(buildReport());
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="drivesafe-hasil-pengujian.csv"'
  });
  res.end(csv);
});

const server = createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    return sendError(res, 400, 'URL tidak valid');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const m = router.match(req.method, url.pathname);

    if (m && m.handler) {
      await m.handler(req, res, { params: m.params, query: url.searchParams });
      log(req, res, started);
      return;
    }
    if (m && m.methodMismatch) {
      return sendError(res, 405, `Metode ${req.method} tidak didukung untuk jalur ini`);
    }

    if (!url.pathname.startsWith('/api/')) {
      if (await serveStatic(req, res, PUBLIC_DIR, url.pathname)) {
        log(req, res, started);
        return;
      }
      if (await serveStatic(req, res, PUBLIC_DIR, '/index.html')) return;

      if (url.pathname === '/') {
        return sendJson(res, 200, {
          ok: true,
          service: 'DriveSafe Backend',
          document: 'C-251-B06',
          note: 'Front end belum dipasang. Letakkan berkasnya di folder public/ '
              + '(index.html dan pendukungnya), lalu muat ulang halaman ini.',
          docs: 'Lihat API.md untuk daftar endpoint lengkap.',
          endpoints: [
            'GET    /api/v1/health',
            'GET    /api/v1/meta',
            'GET    /api/v1/stats',
            'GET    /api/v1/devices',
            'POST   /api/v1/devices',
            'GET    /api/v1/devices/:id',
            'PATCH  /api/v1/devices/:id',
            'DELETE /api/v1/devices/:id',
            'GET    /api/v1/devices/:id/contacts',
            'POST   /api/v1/devices/:id/contacts',
            'PUT    /api/v1/devices/:id/contacts',
            'PATCH  /api/v1/contacts/:id',
            'DELETE /api/v1/contacts/:id',
            'GET    /api/v1/events',
            'GET    /api/v1/events/:id',
            'DELETE /api/v1/events/:id',
            'POST   /api/v1/events/import?device_id=N',
            'GET    /api/v1/trials',
            'POST   /api/v1/trials',
            'DELETE /api/v1/trials/:id',
            'POST   /api/v1/trials/import',
            'POST   /api/v1/trials/reset',
            'GET    /api/v1/analysis',
            'GET    /api/v1/analysis.csv'
          ]
        });
      }
    }

    sendError(res, 404, 'Endpoint tidak ditemukan');
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error('[ERROR]', err);
    if (!res.headersSent) {
      sendError(res, status, err.message ?? 'Kesalahan internal server');
    }
  }
});

function log(req, res, started) {
  const ms = Date.now() - started;
  if (req.url.startsWith('/api/')) {
    console.log(`${req.method.padEnd(6)} ${res.statusCode} ${req.url}  ${ms}ms`);
  }
}

server.listen(PORT, HOST, () => {
  const n = Devices.all().length;
  console.log('');
  console.log('  DriveSafe Backend  -  Dokumen C-251 | Capstone B-06 DTETI UGM');
  console.log('  ' + '-'.repeat(62));
  console.log(`  API       : http://localhost:${PORT}/api/v1`);
  console.log(`  Front end : http://localhost:${PORT}  (dari folder public/)`);
  console.log(`  Node      : ${process.version}`);
  console.log(`  Perangkat : ${n} terdaftar`);
  console.log(`  Admin     : ${ADMIN_TOKEN ? 'token aktif' : 'terbuka (mode demo lokal)'}`);
  console.log('');
  console.log('  Catatan: perangkat tidak terhubung ke server ini. Komunikasi');
  console.log('  nirkabelnya hanya BLE (Tabel 6.1), dan notifikasi darurat');
  console.log('  dikirim lewat SMS tanpa internet (Bab 7.3). Data kejadian');
  console.log('  masuk dengan mengimpor berkas events.csv dari perangkat.');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nMenutup server...');
  try { db.close(); } catch { /* abaikan */ }
  process.exit(0);
});
