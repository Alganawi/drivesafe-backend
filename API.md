# API DriveSafe — Panduan untuk Pembuat Front End

Dokumen ini berisi semua yang dibutuhkan untuk membangun front end CMS Web
DriveSafe. Backend-nya sudah siap dan tidak perlu diubah.

Basis URL: `http://localhost:3000/api/v1`
Seluruh respons berformat JSON, UTF-8.

---

## Menjalankan backend

Butuh Node.js 22.5 ke atas.

```bash
node scripts/seed.js      # isi data contoh untuk bahan uji coba
node src/server.js
```

Letakkan berkas front end di folder `public/`. Berkas `index.html` akan
otomatis disajikan saat membuka `http://localhost:3000`. Tidak perlu
mengatur apa pun — selama server jalan, folder itu langsung tersaji.

Selama `public/` masih kosong, membuka alamat itu menampilkan indeks API
dalam bentuk JSON.

CORS sudah dibuka untuk semua origin, jadi front end boleh juga dijalankan
dari Live Server atau port lain.

---

## Bentuk respons

Semua endpoint mengembalikan pola yang sama.

Berhasil:

```json
{ "ok": true, "data": ... }
```

Gagal:

```json
{ "ok": false, "error": "Pesan dalam bahasa Indonesia" }
```

Kode status: `200` berhasil, `201` data baru dibuat, `400` input salah,
`404` tidak ditemukan, `405` metode salah, `409` bentrok (misalnya kontak
sudah 5), `413` body terlalu besar.

Pesan di field `error` sudah ditulis dalam bahasa Indonesia yang layak
ditampilkan langsung ke pengguna.

---

## Empat halaman yang perlu dibuat

Ini saran pembagian halaman berdasarkan kebutuhan Dokumen C-251. Silakan
disesuaikan.

| Halaman | Endpoint utama | Isi |
|---|---|---|
| Ringkasan | `GET /analysis` | Confusion matrix, Recall, metrik, rincian skenario |
| Pengujian | `GET /analysis`, `POST /trials` | Pencatatan 105 trial |
| Kejadian | `GET /events` | Riwayat event log + peta |
| Perangkat | `GET /devices` | Kontak darurat, profil kendaraan |

---

## 1. Metadata — isi dropdown dan label

### `GET /meta`

Panggil sekali saat aplikasi dimuat. Berisi daftar skenario Tabel 10.2 dan
nama-nama yang dipakai di seluruh antarmuka.

```json
{
  "ok": true,
  "scenarios": [
    { "no": 1, "name": "Berkendara normal di jalan lurus", "actual": 0, "planned": 15 },
    { "no": 2, "name": "Manuver belokan tajam", "actual": 0, "planned": 15 },
    { "no": 3, "name": "Pengereman mendadak", "actual": 0, "planned": 15 },
    { "no": 4, "name": "Melintasi polisi tidur / lubang", "actual": 0, "planned": 15 },
    { "no": 5, "name": "Simulasi jatuh ke samping (v < 5 km/jam)", "actual": 1, "planned": 15 },
    { "no": 6, "name": "Simulasi benturan frontal mendadak", "actual": 1, "planned": 15 },
    { "no": 7, "name": "Simulasi overturn / terguling", "actual": 1, "planned": 15 }
  ],
  "severity": ["Ringan", "Sedang", "Parah"],
  "crash_type": ["Tidak diketahui", "Tabrakan depan", "Ditabrak belakang",
                 "Benturan samping", "Terjatuh", "Terguling"],
  "max_contacts": 5,
  "profiles": ["sepeda", "motor", "mobil"],
  "admin_required": false
}
```

`actual` bernilai `1` untuk skenario berlabel Kecelakaan, `0` untuk Tidak
Kecelakaan. Pakai ini untuk memberi warna berbeda pada kartu skenario.

### `GET /health`

Cek server hidup. Berguna untuk menampilkan status koneksi.

---

## 2. Halaman Ringkasan — yang paling penting

### `GET /analysis`

Satu panggilan menghasilkan seluruh isi halaman Ringkasan.

```json
{
  "ok": true,
  "data": {
    "generated_at": "2026-10-21T04:48:00.000Z",

    "progress": { "done": 105, "planned": 105, "percent": 100, "complete": true },

    "confusion": { "TP": 40, "FP": 3, "TN": 57, "FN": 5 },

    "metrics": {
      "precision":   0.9302325581395349,
      "recall":      0.8888888888888888,
      "f1":          0.9090909090909091,
      "accuracy":    0.9238095238095239,
      "specificity": 0.95,
      "fpr":         0.05
    },

    "perScenario": [
      {
        "no": 4,
        "name": "Melintasi polisi tidur / lubang",
        "label": "Tidak Kecelakaan",
        "actual": 0,
        "planned": 15,
        "done": 15,
        "triggered": 2,
        "correct": 13,
        "accuracy": 0.8666666666666667,
        "errorKind": "FP",
        "errors": 2
      }
    ],

    "timing": {
      "detect": { "n": 43, "min": 4012, "avg": 5600.2, "max": 7138, "p95": 7001 },
      "sms":    { "n": 43, "min": 16102, "avg": 20500.7, "max": 24916, "p95": 24300 }
    },

    "checks": [
      {
        "spec": "Tabel 6.2 no.1",
        "name": "Recall deteksi kecelakaan",
        "target": ">= 85 %",
        "value": 88.88888888888889,
        "unit": "%",
        "pass": true
      }
    ]
  }
}
```

### Hal penting soal metrik

**Nilai `null` berarti belum terdefinisi, bukan nol.** Saat belum ada trial
yang tercatat, `recall` bernilai `null` karena penyebutnya nol. Jangan
tampilkan sebagai `0 %` — itu klaim yang keliru dan bisa salah dikutip ke
laporan. Tampilkan `—` atau "Belum ada data".

Hal yang sama berlaku untuk `pass` di dalam `checks`: nilainya bisa `true`,
`false`, atau `null` (belum ada data).

**Metrik berupa pecahan 0–1**, jadi kalikan 100 untuk persen. Dua angka di
belakang koma sudah cukup.

### Confusion matrix

Tata letaknya mengikuti Tabel 4.3 dokumen. Baris adalah keadaan sebenarnya,
kolom adalah keputusan sistem:

```
                    Sistem memicu alarm   Sistem diam
Kecelakaan                 TP                 FN
Tidak kecelakaan           FP                 TN
```

TP dan TN adalah hasil yang benar, FP dan FN adalah kesalahan. Beri warna
berbeda supaya langsung terbaca.

### `GET /analysis.csv`

Mengembalikan berkas CSV, bukan JSON. Cukup tautkan langsung sebagai tombol
unduh:

```html
<a href="/api/v1/analysis.csv">Unduh hasil (CSV)</a>
```

---

## 3. Halaman Pengujian — pencatatan 105 trial

### `POST /trials`

```json
{ "scenario": 6, "predicted": 1, "detect_ms": 5200, "sms_ms": 21000 }
```

Hanya `scenario` (1–7) dan `predicted` (1 atau 0) yang wajib. Sisanya
opsional.

**Jangan kirim field `actual`.** Label kelas ditentukan server dari nomor
skenario menurut Tabel 10.2. Ini disengaja: dengan 105 percobaan dan
beberapa orang bergantian mencatat, label yang dikirim klien adalah sumber
kesalahan yang sulit dilacak belakangan. Kalau klien mengirimnya, server
mengabaikan.

`repetition` juga terisi otomatis kalau tidak dikirim.

Saran antarmuka: satu kartu per skenario dengan dua tombol besar — "Alarm
memicu" dan "Sistem diam". Sekali klik langsung tercatat, lalu panggil ulang
`GET /analysis` supaya angka di layar ikut berubah.

### `GET /trials`

Daftar seluruh trial. Bisa disaring: `GET /trials?scenario=5`

```json
{
  "ok": true,
  "data": [
    {
      "id": 1, "device_id": 1, "scenario": 6, "repetition": 1,
      "actual": 1, "predicted": 1,
      "g_peak": 5.4, "detect_ms": 5200, "sms_ms": 21000,
      "note": null, "tested_at": "2026-10-21 04:48:00"
    }
  ]
}
```

Jenis hasil dihitung di sisi front end: `actual === predicted` berarti benar
(TP kalau actual 1, TN kalau 0), berbeda berarti salah (FN kalau actual 1,
FP kalau 0).

### `DELETE /trials/:id` dan `POST /trials/reset`

Hapus satu catatan, atau kosongkan semua. `reset` sebaiknya diberi dialog
konfirmasi.

### `POST /trials/import`

Kirim isi berkas CSV sebagai body mentah dengan `Content-Type: text/csv`.

```csv
scenario,predicted,detect_ms,sms_ms,g_peak,note
1,0,,,0.9,berkendara normal
6,1,5200,21000,5.4,benturan frontal
7,ya,4800,19500,6.1,terguling
```

Kolom `predicted` menerima `1`/`0`, `ya`/`tidak`, `true`/`false`.

Respons:

```json
{ "ok": true, "parsed": 3, "inserted": 3, "errors": ["Baris 5: skenario \"9\" tidak ada di Tabel 10.2 (1-7)"] }
```

Tampilkan isi `errors` ke pengguna — baris yang bermasalah dilewati, bukan
membatalkan seluruh impor.

---

## 4. Halaman Kejadian — riwayat event log

### `GET /events`

Parameter opsional: `device_id`, `limit` (maks 500, default 100), `offset`.

```json
{
  "ok": true,
  "count": 3,
  "data": [
    {
      "id": 2, "device_id": 1,
      "ts": 1789570000,
      "g_peak": 7.35, "j_peak": 5200, "r_peak": 1890.3,
      "roll_peak": 15.2, "pitch_peak": 88.4,
      "lat": -7.7821, "lon": 110.3678,
      "severity": 2, "crash_type": 1,
      "profile": "motor", "flags": 9,
      "phase": "SENT", "cancelled": 0, "source": "csv",
      "received_at": "2026-10-21 04:44:44",
      "device_code": "DriveSafe-0078",
      "owner": "Lisa Olivia",

      "severity_name": "Parah",
      "crash_type_name": "Tabrakan depan",
      "maps_url": "https://maps.google.com/?q=-7.782100,110.367800",
      "triggers": ["G-Force", "Shock XY"]
    }
  ]
}
```

Empat field terakhir sudah diolah server supaya front end tidak perlu
menerjemahkan sendiri. `maps_url` bernilai `null` bila kejadian tidak punya
koordinat GPS.

`ts` adalah epoch Unix UTC dari modul GPS. **Nilainya bisa `0`** bila GPS
belum pernah mendapat fix saat kejadian — jangan langsung diformat sebagai
tanggal, tampilkan "Tanpa GPS".

Untuk zona waktu Indonesia:

```js
new Date(ts * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
```

### `POST /events/import?device_id=N`

Impor berkas `events.csv` dari memori flash perangkat. Kirim isinya sebagai
body mentah dengan `Content-Type: text/csv`.

Format yang dibaca persis seperti yang ditulis firmware:

```csv
ts,g_peak,j_peak,r_peak,lat,lon,roll,pitch,severity,type,profile,flags
1789570000,7.35,5200.0,1890.3,-7.782100,110.367800,15.2,88.4,2,1,1,0x09
```

Respons menyebut `inserted`, `duplicate`, dan `errors`. Kejadian yang sudah
pernah masuk tidak diduplikasi.

### `DELETE /events/:id`

---

## 5. Halaman Perangkat — konfigurasi dan kontak darurat

### `GET /devices`

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "device_id": "DriveSafe-0078",
      "mac": "70:4b:ca:48:00:78",
      "owner": "Lisa Olivia",
      "profile": "motor",
      "countdown_s": 30,
      "created_at": "2026-10-21 04:40:00",
      "contact_count": 3,
      "event_count": 4
    }
  ]
}
```

### `GET /devices/:id`

Sama seperti di atas, ditambah array `contacts` di dalamnya.

### `POST /devices`

```json
{ "device_id": "DriveSafe-0078", "owner": "Lisa Olivia", "profile": "motor", "countdown_s": 30 }
```

Hanya `device_id` yang wajib. Nama perangkat muncul di Serial Monitor saat
perangkat menyala, pada baris `[BLE] Peripheral siap sebagai …`

### `PATCH /devices/:id`

Kirim hanya field yang berubah: `owner`, `profile`, atau `countdown_s`.

`profile` harus salah satu dari `sepeda`, `motor`, `mobil`.
`countdown_s` harus 5–120. Di luar itu ditolak dengan `400`.

### `DELETE /devices/:id`

Ikut menghapus seluruh kontak dan kejadian milik perangkat itu. Beri dialog
konfirmasi.

### Kontak darurat

```
GET    /devices/:id/contacts      daftar, terurut prioritas
POST   /devices/:id/contacts      tambah satu
PUT    /devices/:id/contacts      ganti seluruh daftar sekaligus
PATCH  /contacts/:id              ubah satu
DELETE /contacts/:id              hapus satu
```

Body untuk `POST`:

```json
{ "name": "Ayah", "phone": "+6281234567890", "priority": 1 }
```

Body untuk `PUT`:

```json
{ "contacts": [ { "name": "Ayah", "phone": "+6281234567890", "priority": 1 } ] }
```

Aturan yang ditegakkan server:

- **Maksimal 5 kontak** per perangkat (Tabel 6.2 no. 8). Yang ke-6 ditolak
  dengan status `409`.
- Nomor minimal 8 karakter, ditolak dengan `400` bila kurang.
- `name` dipotong 15 karakter, `phone` dipotong 15 karakter — mengikuti
  batas memori NVS perangkat (Pers. 4.31).

Kontak dengan `priority` terkecil adalah penerima *missed call*. Tandai di
antarmuka supaya pengguna paham maksudnya. Notifikasi SMS tetap dikirim ke
semua kontak.

Nonaktifkan tombol "Tambah kontak" saat jumlahnya sudah 5.

---

## Contoh pemanggilan

```js
const API = '/api/v1';

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string') {
      opt.body = body;
      opt.headers['Content-Type'] = 'text/csv';
    } else {
      opt.body = JSON.stringify(body);
      opt.headers['Content-Type'] = 'application/json';
    }
  }
  const r = await fetch(API + path, opt);
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(json?.error ?? `Gagal (${r.status})`);
  return json;
}

// contoh
const { data: rep } = await api('GET', '/analysis');
await api('POST', '/trials', { scenario: 6, predicted: 1 });
```

---

## Catatan sebelum mulai

**Data contoh.** `node scripts/seed.js` mengisi satu perangkat, tiga kontak,
beberapa kejadian, dan 105 trial dengan Recall 88,89 %. Berguna untuk
mengembangkan front end tanpa menunggu data asli. Kosongkan dengan
`node scripts/seed.js --reset` sebelum pengujian lapangan dimulai.

**Jangan tampilkan angka contoh sebagai hasil.** Selama masih data seed,
beri penanda jelas di antarmuka bahwa itu bukan hasil pengukuran.

**Server ini bukan jalur darurat.** Perangkat DriveSafe tidak terhubung ke
sini sama sekali — komunikasi nirkabelnya hanya BLE ke aplikasi mobile
(Tabel 6.1), dan notifikasi kecelakaan dikirim lewat SMS tanpa internet
(Bab 7.3). Data kejadian masuk ke server lewat impor berkas. Hindari
kalimat di antarmuka yang menyiratkan pemantauan real-time.

**Token admin.** Bila server dijalankan dengan `ADMIN_TOKEN=xxx node
src/server.js`, semua permintaan wajib menyertakan header `X-Admin-Token`.
Secara default token tidak aktif dan tidak perlu dipikirkan.
