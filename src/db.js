import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.DRIVESAFE_DB
  ? resolve(process.env.DRIVESAFE_DB)
  : resolve(process.cwd(), 'data', 'drivesafe.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
try {
  const cols = db.prepare("PRAGMA table_info(devices)").all();
  if (cols.length > 0 && cols.some(c => c.name === 'api_key')) {
    console.log('[DB] Skema lama terdeteksi, basis data dibuat ulang.');
    console.log('[DB] Jalankan "node scripts/seed.js" bila ingin data contoh.');
    db.exec(`
      DROP TABLE IF EXISTS trials;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS contacts;
      DROP TABLE IF EXISTS devices;
    `);
  }
} catch { /* basis data baru, tidak ada yang perlu disesuaikan */ }

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    TEXT    NOT NULL UNIQUE,   -- mis. "DriveSafe-0078"
  mac          TEXT,
  owner        TEXT    NOT NULL DEFAULT 'Pengguna',
  profile      TEXT    NOT NULL DEFAULT 'motor'
                       CHECK (profile IN ('sepeda','motor','mobil')),
  countdown_s  INTEGER NOT NULL DEFAULT 30
                       CHECK (countdown_s BETWEEN 5 AND 120),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_device ON contacts(device_id);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,          -- epoch Unix UTC dari GPS (0 = tidak ada fix)
  g_peak      REAL    NOT NULL DEFAULT 0,
  j_peak      REAL    NOT NULL DEFAULT 0,
  r_peak      REAL    NOT NULL DEFAULT 0,
  roll_peak   REAL    NOT NULL DEFAULT 0,
  pitch_peak  REAL    NOT NULL DEFAULT 0,
  lat         REAL,
  lon         REAL,
  severity    INTEGER NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 2),
  crash_type  INTEGER NOT NULL DEFAULT 0 CHECK (crash_type BETWEEN 0 AND 5),
  profile     TEXT    NOT NULL DEFAULT 'motor',
  flags       INTEGER NOT NULL DEFAULT 0,  -- bit0 G, bit1 J, bit2 R, bit3 shock, bit4 rollover
  phase       TEXT    NOT NULL DEFAULT 'SENT',
  cancelled   INTEGER NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL DEFAULT 'csv',    -- csv | manual
  received_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (device_id, ts, g_peak)
);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_ts     ON events(ts DESC);

CREATE TABLE IF NOT EXISTS trials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  scenario     INTEGER NOT NULL CHECK (scenario BETWEEN 1 AND 7),
  repetition   INTEGER,
  actual       INTEGER NOT NULL CHECK (actual    IN (0,1)), -- label sebenarnya
  predicted    INTEGER NOT NULL CHECK (predicted IN (0,1)), -- keluaran sistem
  g_peak       REAL,
  j_peak       REAL,
  r_peak       REAL,
  detect_ms    INTEGER,   -- waktu deteksi, Tabel 6.2 no.3 (target < 10000 ms)
  sms_ms       INTEGER,   -- waktu kirim SMS, Tabel 6.2 no.4 (target <= 30000 ms)
  note         TEXT,
  tested_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trials_scenario ON trials(scenario);
`);
export const SCENARIOS = [
  { no: 1, name: 'Berkendara normal di jalan lurus', actual: 0, planned: 15 },
  { no: 2, name: 'Manuver belokan tajam',            actual: 0, planned: 15 },
  { no: 3, name: 'Pengereman mendadak',              actual: 0, planned: 15 },
  { no: 4, name: 'Melintasi polisi tidur / lubang',  actual: 0, planned: 15 },
  { no: 5, name: 'Simulasi jatuh ke samping (v < 5 km/jam)', actual: 1, planned: 15 },
  { no: 6, name: 'Simulasi benturan frontal mendadak',       actual: 1, planned: 15 },
  { no: 7, name: 'Simulasi overturn / terguling',            actual: 1, planned: 15 }
];

export const SEVERITY   = ['Ringan', 'Sedang', 'Parah'];
export const CRASH_TYPE = [
  'Tidak diketahui', 'Tabrakan depan', 'Ditabrak belakang',
  'Benturan samping', 'Terjatuh', 'Terguling'
];
export const Devices = {
  all() {
    return db.prepare(`
      SELECT d.*,
             (SELECT COUNT(*) FROM contacts c WHERE c.device_id = d.id) AS contact_count,
             (SELECT COUNT(*) FROM events   e WHERE e.device_id = d.id) AS event_count
      FROM devices d ORDER BY d.created_at DESC`).all();
  },

  byId(id) {
    return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  },

  byDeviceId(deviceId) {
    return db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
  },

  create({ device_id, mac = null, owner = 'Pengguna',
           profile = 'motor', countdown_s = 30 }) {
    const r = db.prepare(`
      INSERT INTO devices (device_id, mac, owner, profile, countdown_s)
      VALUES (?, ?, ?, ?, ?)`)
      .run(device_id, mac, owner, profile, countdown_s);
    return this.byId(Number(r.lastInsertRowid));
  },

  update(id, fields) {
    const allowed = ['owner', 'profile', 'countdown_s', 'mac'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return this.byId(id);
    const sql = `UPDATE devices SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map(k => fields[k]), id);
    return this.byId(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
  }
};

export const MAX_CONTACTS = 5;

export const Contacts = {
  forDevice(deviceId) {
    return db.prepare(
      'SELECT * FROM contacts WHERE device_id = ? ORDER BY priority ASC, id ASC'
    ).all(deviceId);
  },

  count(deviceId) {
    return db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE device_id = ?')
             .get(deviceId).n;
  },

  byId(id) {
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  },

  create(deviceId, { name, phone, priority = 1 }) {
    if (this.count(deviceId) >= MAX_CONTACTS) {
      const e = new Error(`Maksimal ${MAX_CONTACTS} kontak per perangkat (Tabel 6.2 no.8)`);
      e.status = 409;
      throw e;
    }
    const r = db.prepare(
      'INSERT INTO contacts (device_id, name, phone, priority) VALUES (?, ?, ?, ?)'
    ).run(deviceId, name, phone, priority);
    return this.byId(Number(r.lastInsertRowid));
  },

  update(id, { name, phone, priority }) {
    db.prepare(`UPDATE contacts
                SET name     = COALESCE(?, name),
                    phone    = COALESCE(?, phone),
                    priority = COALESCE(?, priority)
                WHERE id = ?`)
      .run(name ?? null, phone ?? null, priority ?? null, id);
    return this.byId(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes > 0;
  },

  replaceAll(deviceId, list) {
    const tx = () => {
      db.prepare('DELETE FROM contacts WHERE device_id = ?').run(deviceId);
      const ins = db.prepare(
        'INSERT INTO contacts (device_id, name, phone, priority) VALUES (?, ?, ?, ?)'
      );
      list.slice(0, MAX_CONTACTS).forEach((c, i) =>
        ins.run(deviceId, c.name ?? '-', c.phone, c.priority ?? i + 1));
    };
    db.exec('BEGIN');
    try { tx(); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    return this.forDevice(deviceId);
  }
};

export const Events = {
  list({ deviceId = null, limit = 100, offset = 0 } = {}) {
    const where = deviceId ? 'WHERE e.device_id = ?' : '';
    const args  = deviceId ? [deviceId, limit, offset] : [limit, offset];
    return db.prepare(`
      SELECT e.*, d.device_id AS device_code, d.owner
      FROM events e JOIN devices d ON d.id = e.device_id
      ${where}
      ORDER BY e.ts DESC, e.id DESC
      LIMIT ? OFFSET ?`).all(...args);
  },

  byId(id) {
    return db.prepare(`
      SELECT e.*, d.device_id AS device_code, d.owner
      FROM events e JOIN devices d ON d.id = e.device_id
      WHERE e.id = ?`).get(id);
  },

  create(deviceId, ev) {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO events
        (device_id, ts, g_peak, j_peak, r_peak, roll_peak, pitch_peak,
         lat, lon, severity, crash_type, profile, flags, phase, cancelled, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const r = stmt.run(
      deviceId,
      Math.trunc(ev.ts ?? 0),
      ev.g_peak ?? 0, ev.j_peak ?? 0, ev.r_peak ?? 0,
      ev.roll_peak ?? 0, ev.pitch_peak ?? 0,
      ev.lat ?? null, ev.lon ?? null,
      ev.severity ?? 0, ev.crash_type ?? 0,
      ev.profile ?? 'motor', ev.flags ?? 0,
      ev.phase ?? 'SENT',
      ev.cancelled ? 1 : 0,
      ev.source ?? 'csv'
    );
    return r.changes > 0 ? this.byId(Number(r.lastInsertRowid)) : null;
  },

  remove(id) {
    return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;
  },

  stats() {
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(MAX(g_peak), 0) AS max_g,
             COALESCE(AVG(g_peak), 0) AS avg_g,
             SUM(CASE WHEN severity = 2 THEN 1 ELSE 0 END) AS severe,
             SUM(CASE WHEN cancelled  = 1 THEN 1 ELSE 0 END) AS cancelled
      FROM events`).get();
    const bySeverity = db.prepare(
      'SELECT severity, COUNT(*) AS n FROM events GROUP BY severity').all();
    const byType = db.prepare(
      'SELECT crash_type, COUNT(*) AS n FROM events GROUP BY crash_type').all();
    return { ...row, bySeverity, byType };
  }
};

export const Trials = {
  list({ scenario = null } = {}) {
    const where = scenario ? 'WHERE scenario = ?' : '';
    const args  = scenario ? [scenario] : [];
    return db.prepare(
      `SELECT * FROM trials ${where} ORDER BY scenario ASC, id ASC`).all(...args);
  },

  byId(id) {
    return db.prepare('SELECT * FROM trials WHERE id = ?').get(id);
  },

  create(t) {
    const meta = SCENARIOS.find(s => s.no === t.scenario);
    if (!meta) {
      const e = new Error('Skenario harus 1-7 sesuai Tabel 10.2');
      e.status = 400;
      throw e;
    }
    const actual = meta.actual;
    const nextRep = t.repetition ?? (db.prepare(
      'SELECT COUNT(*) AS n FROM trials WHERE scenario = ?').get(t.scenario).n + 1);
    const r = db.prepare(`
      INSERT INTO trials
        (device_id, scenario, repetition, actual, predicted,
         g_peak, j_peak, r_peak, detect_ms, sms_ms, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      t.device_id ?? null, t.scenario, nextRep, actual,
      t.predicted ? 1 : 0,
      t.g_peak ?? null, t.j_peak ?? null, t.r_peak ?? null,
      t.detect_ms ?? null, t.sms_ms ?? null, t.note ?? null);
    return this.byId(Number(r.lastInsertRowid));
  },

  remove(id) {
    return db.prepare('DELETE FROM trials WHERE id = ?').run(id).changes > 0;
  },

  clear() {
    return db.prepare('DELETE FROM trials').run().changes;
  }
};
