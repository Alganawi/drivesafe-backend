/* ============================================================================
 *  DriveSafe Backend - scripts/seed.js
 *  Isi basis data dengan contoh data agar dashboard langsung dapat ditinjau
 *  dan dipakai latihan sebelum pengujian lapangan sungguhan.
 *
 *  Jalankan:  node scripts/seed.js
 *  Kosongkan: node scripts/seed.js --reset
 *
 *  CATATAN: data ini CONTOH, bukan hasil pengukuran. Hapus dengan --reset
 *  sebelum mencatat 105 trial yang sebenarnya agar tidak tercampur.
 * ========================================================================== */

/* Pemeriksaan versi dilakukan sebelum import apa pun. Pada modul ES, import
   statis dijalankan lebih dulu daripada baris kode mana pun, sehingga
   src/db.js diimpor secara dinamis di bawah agar pesan di sini sempat
   muncul pada Node yang terlalu lama. */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('');
  console.error(`  Node.js terpasang versi ${process.versions.node}, terlalu lama.`);
  console.error('  Backend ini butuh Node.js 22.5 atau lebih baru,');
  console.error('  karena memakai basis data bawaan Node (node:sqlite).');
  console.error('');
  console.error('  Unduh versi LTS di https://nodejs.org, pasang, lalu tutup');
  console.error('  dan buka kembali terminal. Cek dengan: node --version');
  console.error('');
  process.exit(1);
}

const { db, Devices, Contacts, Events, Trials, SCENARIOS } =
  await import('../src/db.js');

const reset = process.argv.includes('--reset');

db.exec('DELETE FROM trials');
db.exec('DELETE FROM events');
db.exec('DELETE FROM contacts');
db.exec('DELETE FROM devices');

if (reset) {
  console.log('Basis data dikosongkan. Tidak ada data contoh yang ditulis.');
  process.exit(0);
}

/* -------------------------------------------------------------- perangkat */
const dev = Devices.create({
  device_id: 'DriveSafe-0078',
  mac: '70:4b:ca:48:00:78',
  owner: 'Lisa Olivia',
  profile: 'motor',
  countdown_s: 30
});

Contacts.create(dev.id, { name: 'Ayah',  phone: '+6281234567890', priority: 1 });
Contacts.create(dev.id, { name: 'Ibu',   phone: '+6285678901234', priority: 2 });
Contacts.create(dev.id, { name: 'Rivan', phone: '+6281122334455', priority: 3 });

/* ----------------------------------------------------------------- events */
const base = Math.floor(Date.now() / 1000) - 5 * 86400;
const sample = [
  { dt: 0,      g: 4.82, j: 3412, r: 1180, roll: 72.4, pitch: 11.2, sev: 1, type: 5, flags: 0x11 },
  { dt: 93_000, g: 7.35, j: 5240, r: 1890, roll: 15.2, pitch: 88.4, sev: 2, type: 1, flags: 0x09 },
  { dt: 201_000, g: 3.10, j: 1180, r: 430, roll: 64.1, pitch: 5.0,  sev: 0, type: 4, flags: 0x10 }
];

for (const s of sample) {
  Events.create(dev.id, {
    ts: base + s.dt,
    g_peak: s.g, j_peak: s.j, r_peak: s.r,
    roll_peak: s.roll, pitch_peak: s.pitch,
    lat: -7.7654 + (Math.random() - 0.5) * 0.02,
    lon: 110.3721 + (Math.random() - 0.5) * 0.02,
    severity: s.sev, crash_type: s.type,
    profile: 'motor', flags: s.flags, phase: 'SENT', source: 'csv'
  });
}

/* ----------------------------------------------------------------- trials */
/* Contoh hasil yang menghasilkan Recall sedikit di atas target 85 %,
   sehingga tampilan dashboard dapat ditinjau dalam keadaan "lulus". */
const outcome = {
  1: Array(15).fill(0),
  2: Array(15).fill(0),
  3: [1, ...Array(14).fill(0)],
  4: [1, 1, ...Array(13).fill(0)],
  5: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  6: [0, ...Array(14).fill(1)],
  7: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
};

for (const s of SCENARIOS) {
  outcome[s.no].forEach(pred => {
    Trials.create({
      device_id: dev.id,
      scenario: s.no,
      predicted: pred,
      g_peak: s.actual ? 3.5 + Math.random() * 4 : 0.9 + Math.random() * 1.6,
      detect_ms: pred ? 4000 + Math.floor(Math.random() * 3200) : null,
      sms_ms: pred ? 16000 + Math.floor(Math.random() * 9000) : null
    });
  });
}

const all = Trials.list();
const TP = all.filter(t => t.actual === 1 && t.predicted === 1).length;
const FN = all.filter(t => t.actual === 1 && t.predicted === 0).length;
const FP = all.filter(t => t.actual === 0 && t.predicted === 1).length;
const TN = all.filter(t => t.actual === 0 && t.predicted === 0).length;

console.log('\nData contoh berhasil dibuat:');
console.log(`  Perangkat   : ${dev.device_id}`);
console.log(`  Kontak      : ${Contacts.forDevice(dev.id).length}`);
console.log(`  Kejadian    : ${Events.list().length}`);
console.log(`  Trial       : ${all.length}`);
console.log(`  Matriks     : TP=${TP} FN=${FN} FP=${FP} TN=${TN}`);
console.log(`  Recall      : ${(TP / (TP + FN) * 100).toFixed(2)} %`);
console.log('\nIni data CONTOH. Jalankan "node scripts/seed.js --reset" sebelum');
console.log('mencatat hasil pengujian yang sebenarnya.\n');
