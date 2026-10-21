# DriveSafe — CMS Web & Pengolah Hasil Pengujian

Panel kendali web untuk sistem DriveSafe (Dokumen **C-251**, Capstone B-06,
DTETI FT UGM).

**Tanpa `npm install`.** Seluruh kode berjalan di atas modul bawaan Node.js —
termasuk basis datanya. Tidak ada dependensi pihak ketiga, tidak ada langkah
build, tidak perlu internet untuk menjalankannya.

---

## Posisi dalam arsitektur

Perangkat DriveSafe **tidak terhubung ke server ini**, dan memang tidak
dirancang begitu. Tabel 6.1 dan Bab 5.4 menetapkan BLE sebagai satu-satunya
komunikasi nirkabel perangkat, dan Bab 7.3 memilih SMS sebagai jalur darurat
justru supaya tidak bergantung internet.

```
  KECELAKAAN ──► SMS + missed call ──► kontak darurat    (jalur darurat, tanpa internet)
             └─► event log di flash perangkat
                        │
                        │  disalin manual sebagai events.csv
                        ▼
                   server ini ──► dashboard, analisis    (lapisan pencatatan)
```

Server menangani yang tidak mendesak: mencatat konfigurasi perangkat dan
kontak darurat, menyimpan riwayat kejadian hasil impor, dan mengolah hasil
105 trial menjadi confusion matrix.

Ini memenuhi aturan Fairness 2e (CMS Web) tanpa mengubah satu pun keputusan
desain di dokumen.

---

## Menjalankan

Butuh **Node.js 22.5 atau lebih baru** (modul `node:sqlite` dipakai sebagai
basis data). Cek dengan `node --version`.

```bash
cd drivesafe-backend
node scripts/seed.js      # isi data contoh, opsional
node src/server.js
```

Buka **http://localhost:3000**

Basis data tersimpan di `data/drivesafe.db`. Untuk mengosongkan sebelum
pengujian sungguhan:

```bash
node scripts/seed.js --reset
```

Menjalankan uji otomatis (server harus sudah jalan di terminal lain):

```bash
node scripts/test-api.js
```

51 pemeriksaan, termasuk verifikasi Precision, Recall, dan F1 terhadap
perhitungan manual.

---

## Isi berkas

| Berkas | Isi |
|---|---|
| `src/server.js` | Server HTTP dan seluruh endpoint REST |
| `src/db.js` | Skema SQLite dan lapisan repository |
| `src/analysis.js` | Confusion matrix, metrik Pers. 4.24–4.26, impor CSV |
| `src/http.js` | Router, parsing body, penyajian berkas statis |
| `public/` | Panel kendali web (HTML, CSS, JavaScript vanilla) |
| `scripts/seed.js` | Data contoh untuk meninjau dashboard |
| `scripts/test-api.js` | Uji end-to-end |

---

## Empat halaman

**Ringkasan** — confusion matrix 2×2, Recall terhadap ambang 85 %, metrik
Pers. 4.24–4.26, rincian tujuh skenario, dan verifikasi tiga parameter
Tabel 6.2 yang hanya bisa dibuktikan lewat uji lapangan. Tombol unduh
menghasilkan CSV siap tempel ke laporan.

**Pengujian** — pencatatan 105 trial. Pilih skenario, tekan "Alarm memicu"
atau "Sistem diam". Label kelas diturunkan dari Tabel 10.2 di sisi server,
jadi tidak mungkin tertukar meski yang mencatat berganti orang.

**Kejadian** — riwayat event log dengan G puncak, keparahan, jenis benturan,
pemicu yang aktif, dan tautan peta. Diisi dengan mengimpor `events.csv` dari
memori flash perangkat.

**Perangkat** — catatan unit, profil kendaraan, hitung mundur, dan kontak
darurat dengan batas 5 sesuai Tabel 6.2 no. 8.

---

## Memasukkan data kejadian

Firmware menulis setiap kejadian ke `/events.csv` pada memori flash internal
perangkat (Bab 8.3 poin 4). Salin berkas itu ke laptop, lalu buka halaman
Kejadian dan tekan **Impor events.csv**.

Format yang dibaca persis seperti yang ditulis firmware:

```csv
ts,g_peak,j_peak,r_peak,lat,lon,roll,pitch,severity,type,profile,flags
1789570000,7.35,5200.0,1890.3,-7.782100,110.367800,15.2,88.4,2,1,1,0x09
```

Baris yang rusak dilewati dan dilaporkan, kejadian yang sudah ada tidak
diduplikasi.

---

## REST API

Basis: `http://localhost:3000/api/v1`

| Metode | Jalur | Keterangan |
|---|---|---|
| GET | `/health`, `/meta`, `/stats` | Status server, daftar skenario, ringkasan |
| GET POST | `/devices` | Daftar dan pendaftaran perangkat |
| GET PATCH DELETE | `/devices/:id` | Detail, ubah, hapus |
| GET POST PUT | `/devices/:id/contacts` | Kontak darurat, maksimal 5 |
| PATCH DELETE | `/contacts/:id` | Ubah dan hapus kontak |
| GET DELETE | `/events`, `/events/:id` | Riwayat kejadian |
| POST | `/events/import?device_id=N` | Impor `events.csv` |
| GET POST | `/trials` | Catatan percobaan |
| POST | `/trials/import`, `/trials/reset` | Impor CSV, kosongkan |
| GET | `/analysis` | Confusion matrix dan metrik |
| GET | `/analysis.csv` | Unduh hasil sebagai CSV |

Untuk dipakai di luar jaringan lokal, set variabel lingkungan `ADMIN_TOKEN`;
seluruh endpoint akan menuntut header `X-Admin-Token`.

```bash
ADMIN_TOKEN=rahasia123 node src/server.js
```

---

## Impor catatan percobaan

Selain lewat tombol di halaman Pengujian, 105 trial bisa dimasukkan sekaligus
dari CSV:

```csv
scenario,predicted,detect_ms,sms_ms,g_peak,note
1,0,,,0.9,berkendara normal
6,1,5200,21000,5.4,benturan frontal
7,ya,4800,19500,6.1,terguling
```

Kolom `predicted` menerima `1`/`0`, `ya`/`tidak`, `true`/`false`. Label kelas
sebenarnya **tidak dibaca dari berkas** — selalu diturunkan dari nomor
skenario menurut Tabel 10.2.

---

## Cara menghitung Recall untuk laporan

1. Jalankan server, kosongkan data contoh: `node scripts/seed.js --reset`
2. Daftarkan perangkat di halaman Perangkat
3. Lakukan 105 percobaan sesuai Tabel 10.2, catat lewat halaman Pengujian
4. Buka halaman Ringkasan — confusion matrix dan Recall terhitung sendiri
5. Tekan **Unduh hasil (CSV)** untuk mendapat tabel siap tempel

Angka yang dihasilkan memakai Pers. 4.24, 4.25, dan 4.26 persis seperti
tertulis di dokumen. Bila data belum cukup, metrik dilaporkan sebagai `—`,
bukan nol, supaya tidak menyesatkan saat ditulis ke laporan.

---

## Catatan teknis

**Metrik yang belum terdefinisi tidak dibulatkan jadi nol.** Recall tanpa
satu pun percobaan positif bernilai `null`, dan dashboard menampilkannya
sebagai "Belum ada data". Ini menghindari klaim "Recall 0 %" yang keliru.

**Label kelas ditentukan server.** Klien tidak bisa mengirim label `actual`;
nilainya selalu diambil dari nomor skenario. Dengan 105 percobaan dan
kemungkinan beberapa orang bergantian mencatat, ini menutup sumber kesalahan
yang sulit dilacak belakangan.

**Basis data lama dibuat ulang otomatis.** Versi awal backend sempat memuat
kolom untuk jalur WiFi. Jalur itu dihapus karena bertentangan dengan Tabel 6.1
dan Bab 5.4. Bila `data/drivesafe.db` versi lama terdeteksi, tabelnya dibuat
ulang saat server dijalankan dan akan ada pesan di terminal.
