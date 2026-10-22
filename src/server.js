/* ============================================================================
 *  DriveSafe Backend - src/server.js
 *
 *  Titik masuk aplikasi. Berkas ini sengaja dibuat tipis dan TANPA import
 *  statis apa pun, karena pada modul ES seluruh import dijalankan lebih
 *  dahulu sebelum baris kode mana pun. Bila src/app.js diimpor secara statis
 *  di sini, Node versi lama akan gagal memuat `node:sqlite` sebelum
 *  pemeriksaan di bawah sempat berjalan, dan yang muncul adalah pesan galat
 *  yang membingungkan.
 *
 *  Menjalankan:  node src/server.js
 * ========================================================================== */

const NODE_MIN_MAJOR = 22;
const NODE_MIN_MINOR = 5;

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < NODE_MIN_MAJOR ||
   (major === NODE_MIN_MAJOR && minor < NODE_MIN_MINOR)) {
  console.error('');
  console.error(`  Node.js terpasang versi ${process.versions.node}, terlalu lama.`);
  console.error(`  Backend ini butuh Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} atau lebih baru,`);
  console.error('  karena memakai basis data bawaan Node (node:sqlite).');
  console.error('');
  console.error('  Langkah perbaikan:');
  console.error('    1. Unduh versi LTS di https://nodejs.org lalu pasang');
  console.error('    2. Tutup terminal (dan VS Code) sepenuhnya, buka lagi');
  console.error('    3. Cek dengan: node --version');
  console.error('');
  process.exit(1);
}

/* Import dinamis: baru dijalankan setelah pemeriksaan di atas lolos. */
await import('./app.js');
