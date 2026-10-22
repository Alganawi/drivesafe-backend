/* ============================================================================
 *  DriveSafe Backend - scripts/test-api.js
 *  Uji end-to-end seluruh endpoint terhadap server yang sedang berjalan.
 *  Jalankan:  node src/server.js   (terminal 1)
 *             node scripts/test-api.js  (terminal 2)
 * ========================================================================== */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_TOKEN ?? '';

let pass = 0, fail = 0;

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  OK    ${name}`); }
  else { fail++; console.log(`  GAGAL ${name}${detail ? '  -> ' + detail : ''}`); }
}

async function api(method, path, body, headers = {}) {
  const h = { ...headers };
  if (ADMIN) h['X-Admin-Token'] = ADMIN;
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string') { payload = body; h['Content-Type'] = 'text/csv'; }
    else { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* bukan JSON (mis. CSV) */ }
  return { status: r.status, json, text };
}

const nearly = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ------------------------------------------------------------------------ */
console.log('\n=== UJI END-TO-END BACKEND DriveSafe ===\n');

console.log('[1] Kesehatan & metadata');
{
  const h = await api('GET', '/api/v1/health');
  check('GET /health merespons 200', h.status === 200 && h.json?.ok === true);

  const m = await api('GET', '/api/v1/meta');
  check('Tabel 10.2 berisi 7 skenario', m.json?.scenarios?.length === 7);
  check('Total rencana ulangan = 105',
    m.json?.scenarios?.reduce((a, s) => a + s.planned, 0) === 105);
  check('Batas kontak = 5 (Tabel 6.2 no.8)', m.json?.max_contacts === 5);
}

/* ------------------------------------------------------------------------ */
console.log('\n[2] Pendaftaran perangkat');
let device;
{
  const code = 'DriveSafe-' + Math.floor(Math.random() * 65536).toString(16)
                                  .toUpperCase().padStart(4, '0');
  const r = await api('POST', '/api/v1/devices', {
    device_id: code, mac: '70:4b:ca:48:00:78',
    owner: 'Lisa Olivia', profile: 'motor', countdown_s: 30
  });
  check('POST /devices membuat perangkat', r.status === 201, `status ${r.status}`);
  device = r.json?.data;
  check('perangkat tidak lagi memakai kunci API', device?.api_key === undefined);

  const dup = await api('POST', '/api/v1/devices', { device_id: code });
  check('device_id ganda ditolak (409)', dup.status === 409);

  const bad = await api('PATCH', `/api/v1/devices/${device.id}`, { countdown_s: 500 });
  check('countdown di luar 5-120 ditolak', bad.status === 400);

  const ok = await api('PATCH', `/api/v1/devices/${device.id}`, { profile: 'mobil' });
  check('profil dapat diubah ke mobil', ok.json?.data?.profile === 'mobil');
  await api('PATCH', `/api/v1/devices/${device.id}`, { profile: 'motor' });
}

/* ------------------------------------------------------------------------ */
console.log('\n[3] Kontak darurat (Pers. 4.31, maks 5)');
{
  for (let i = 1; i <= 5; i++) {
    const r = await api('POST', `/api/v1/devices/${device.id}/contacts`,
      { name: 'Kontak' + i, phone: '+62812345678' + i, priority: i });
    if (i === 1) check('kontak pertama tersimpan', r.status === 201);
  }
  const sixth = await api('POST', `/api/v1/devices/${device.id}/contacts`,
    { name: 'Lebih', phone: '+628999999999', priority: 6 });
  check('kontak ke-6 ditolak (409)', sixth.status === 409, `status ${sixth.status}`);

  const shortPhone = await api('POST', `/api/v1/devices/${device.id}/contacts`,
    { name: 'X', phone: '123' });
  check('nomor < 8 karakter ditolak', shortPhone.status === 400);

  const list = await api('GET', `/api/v1/devices/${device.id}/contacts`);
  check('terdaftar tepat 5 kontak', list.json?.data?.length === 5);
  check('urut berdasarkan prioritas', list.json?.data?.[0]?.priority === 1);

  const repl = await api('PUT', `/api/v1/devices/${device.id}/contacts`, {
    contacts: [
      { name: 'Ayah', phone: '+6281234567890', priority: 1 },
      { name: 'Ibu',  phone: '+6285678901234', priority: 2 }
    ]
  });
  check('PUT mengganti seluruh daftar', repl.json?.data?.length === 2);
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */
console.log('\n[4] Impor events.csv dari LittleFS');
{
  const csv = [
    'ts,g_peak,j_peak,r_peak,lat,lon,roll,pitch,severity,type,profile,flags',
    '1789570000,7.35,5200.0,1890.3,-7.782100,110.367800,15.2,88.4,2,1,1,0x09',
    '1789571000,3.10,980.5,430.1,-7.783000,110.368000,62.1,5.0,0,4,1,0x11',
    'baris,rusak'
  ].join('\n');
  const r = await api('POST', `/api/v1/events/import?device_id=${device.id}`, csv);
  check('2 baris valid terimpor', r.json?.inserted === 2, JSON.stringify(r.json));
  check('baris rusak dilaporkan sebagai galat', r.json?.errors?.length === 1);

  const list = await api('GET', `/api/v1/events?device_id=${device.id}&limit=500`);
  const severe = list.json?.data?.find(e => e.ts === 1789570000);
  check('G 7,35g diklasifikasi Parah (Pers. 4.23)', severe?.severity_name === 'Parah');
  check('sumber event tercatat sebagai csv', severe?.source === 'csv');
  check('flag 0x09 terbaca G-Force + Shock XY',
    severe?.triggers?.includes('G-Force') && severe?.triggers?.includes('Shock XY')
    && severe?.triggers?.length === 2);
  check('tautan peta terbentuk', typeof severe?.maps_url === 'string'
    && severe.maps_url.includes('-7.782100'));
}

/* ------------------------------------------------------------------------ */
console.log('\n[5] Pencatatan trial & validasi label');
{
  await api('POST', '/api/v1/trials/reset');

  const bad = await api('POST', '/api/v1/trials', { scenario: 9, predicted: 1 });
  check('skenario di luar 1-7 ditolak', bad.status === 400);

  /* Skenario 1 berlabel "Tidak Kecelakaan" -> actual harus 0 meski klien
     mencoba mengirim actual = 1 */
  const t1 = await api('POST', '/api/v1/trials',
    { scenario: 1, predicted: 0, actual: 1 });
  check('label actual diturunkan dari Tabel 10.2, bukan dari klien',
    t1.json?.data?.actual === 0);

  const t2 = await api('POST', '/api/v1/trials', { scenario: 6, predicted: 1 });
  check('skenario 6 berlabel Kecelakaan (actual = 1)', t2.json?.data?.actual === 1);
  check('nomor ulangan terisi otomatis', t2.json?.data?.repetition === 1);
}

/* ------------------------------------------------------------------------ */
console.log('\n[6] Confusion matrix & metrik (Pers. 4.24 - 4.26)');
{
  await api('POST', '/api/v1/trials/reset');

  /* Rancang data dengan hasil yang dapat dihitung tangan:
     Skenario 1-4 (negatif, 60 trial): 4 kali terpicu -> FP = 4,  TN = 56
     Skenario 5-7 (positif, 45 trial): 6 kali gagal   -> FN = 6,  TP = 39     */
  const rows = [];
  for (let s = 1; s <= 4; s++)
    for (let i = 0; i < 15; i++) rows.push({ scenario: s, predicted: (s === 4 && i < 4) ? 1 : 0 });
  for (let s = 5; s <= 7; s++)
    for (let i = 0; i < 15; i++) rows.push({ scenario: s, predicted: (s === 5 && i < 6) ? 0 : 1 });

  for (const r of rows) {
    await api('POST', '/api/v1/trials', {
      ...r,
      detect_ms: r.predicted ? 4200 + Math.floor(Math.random() * 2000) : null,
      sms_ms: r.predicted ? 18000 + Math.floor(Math.random() * 6000) : null
    });
  }

  const a = await api('GET', '/api/v1/analysis');
  const d = a.json?.data;
  const cm = d?.confusion;

  check('total trial = 105', d?.progress?.done === 105, `done ${d?.progress?.done}`);
  check('TP = 39', cm?.TP === 39, `TP ${cm?.TP}`);
  check('FN = 6',  cm?.FN === 6,  `FN ${cm?.FN}`);
  check('FP = 4',  cm?.FP === 4,  `FP ${cm?.FP}`);
  check('TN = 56', cm?.TN === 56, `TN ${cm?.TN}`);

  /* Perhitungan manual:
     Precision = 39/43 = 0,906976744...
     Recall    = 39/45 = 0,866666666...
     F1        = 2PR/(P+R) = 0,88636363... */
  check('Precision = 39/43 (Pers. 4.24)', nearly(d.metrics.precision, 39 / 43, 1e-12),
    String(d.metrics.precision));
  check('Recall = 39/45 (Pers. 4.25)', nearly(d.metrics.recall, 39 / 45, 1e-12),
    String(d.metrics.recall));
  const p = 39 / 43, rc = 39 / 45;
  check('F1 = 2PR/(P+R) (Pers. 4.26)',
    nearly(d.metrics.f1, 2 * p * rc / (p + rc), 1e-12), String(d.metrics.f1));
  check('Accuracy = 95/105', nearly(d.metrics.accuracy, 95 / 105, 1e-12));

  const recallCheck = d.checks.find(c => c.spec === 'Tabel 6.2 no.1');
  check('Recall 86,67 % lulus target >= 85 %', recallCheck?.pass === true,
    `nilai ${recallCheck?.value?.toFixed(2)}`);

  const s4 = d.perScenario.find(x => x.no === 4);
  check('skenario 4 mencatat 4 galat jenis FP',
    s4?.errors === 4 && s4?.errorKind === 'FP');
  const s5 = d.perScenario.find(x => x.no === 5);
  check('skenario 5 mencatat 6 galat jenis FN',
    s5?.errors === 6 && s5?.errorKind === 'FN');

  const det = d.checks.find(c => c.spec === 'Tabel 6.2 no.3');
  check('waktu deteksi maks < 10.000 ms', det?.pass === true, `maks ${det?.value}`);
  const sms = d.checks.find(c => c.spec === 'Tabel 6.2 no.4');
  check('waktu SMS maks <= 30.000 ms', sms?.pass === true, `maks ${sms?.value}`);
}

/* ------------------------------------------------------------------------ */
console.log('\n[7] Metrik tak terdefinisi saat data kosong');
{
  await api('POST', '/api/v1/trials/reset');
  const a = await api('GET', '/api/v1/analysis');
  const m = a.json?.data?.metrics;
  check('recall bernilai null, bukan 0, saat belum ada data', m?.recall === null);
  check('status target dilaporkan null (belum ada data)',
    a.json?.data?.checks?.[0]?.pass === null);
}

/* ------------------------------------------------------------------------ */
console.log('\n[8] Impor trials.csv & ekspor hasil');
{
  const csv = [
    'scenario,predicted,detect_ms,sms_ms,g_peak,note',
    '1,0,,,0.9,berkendara normal',
    '6,1,5200,21000,5.4,benturan frontal',
    '7,ya,4800,19500,6.1,terguling',
    '9,1,,,,skenario tidak ada'
  ].join('\n');
  const r = await api('POST', '/api/v1/trials/import', csv);
  check('3 baris valid terimpor', r.json?.inserted === 3, JSON.stringify(r.json));
  check('skenario 9 ditolak dengan pesan galat', r.json?.errors?.length === 1);
  check('nilai "ya" dibaca sebagai predicted = 1',
    (await api('GET', '/api/v1/trials?scenario=7')).json?.data?.[0]?.predicted === 1);

  const csvOut = await api('GET', '/api/v1/analysis.csv');
  check('ekspor CSV berisi confusion matrix',
    csvOut.text.includes('CONFUSION MATRIX') && csvOut.text.includes('Pers. 4.25'));
}

/* ------------------------------------------------------------------------ */
console.log('\n[9] Keamanan dasar');
{
  /* Jalur WiFi dihapus karena Tabel 6.1 menetapkan BLE sebagai satu-satunya
     komunikasi nirkabel perangkat; endpoint-nya tidak boleh tersisa. */
  for (const [method, path] of [['POST', '/ingest/events'],
                                ['POST', '/ingest/hello'],
                                ['GET',  '/ingest/config']]) {
    /* GET tidak boleh membawa body, jadi body hanya dikirim untuk POST. */
    const r = await api(method, '/api/v1' + path, method === 'GET' ? undefined : {});
    check(`endpoint ${path} sudah dihapus`, r.status === 404, `status ${r.status}`);
  }

  const trav = await fetch(BASE + '/../package.json');
  check('path traversal tidak membocorkan berkas',
    trav.status === 404 || !(await trav.text()).includes('drivesafe-backend'));

  const m405 = await api('DELETE', '/api/v1/health');
  check('metode salah mengembalikan 405', m405.status === 405);

  const badJson = await fetch(BASE + '/api/v1/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{rusak'
  });
  check('JSON rusak mengembalikan 400', badJson.status === 400);
}

/* ------------------------------------------------------------------------ */
console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===\n`);
process.exit(fail === 0 ? 0 : 1);
