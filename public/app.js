/* ============================================================================
 *  DriveSafe - Panel Kendali (CMS web)
 *  Vanilla JavaScript, tanpa framework dan tanpa langkah build.
 * ========================================================================== */

const API = '/api/v1';
const main = document.getElementById('main');
const toastEl = document.getElementById('toast');

let META = null;
let toastTimer = null;

/* ------------------------------------------------------------------ utils */
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = v => v === null || v === undefined ? '—' : (v * 100).toFixed(2);
const num = (v, d = 2) => v === null || v === undefined ? '—' : Number(v).toFixed(d);

function fmtTs(ts) {
  if (!ts) return 'Tanpa GPS';
  const d = new Date(ts * 1000);
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
  }) + ' WIB';
}

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = 'toast' + (isError ? ' err' : '');
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3600);
}

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
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  if (!r.ok) throw new Error(json?.error ?? `Permintaan gagal (${r.status})`);
  return json ?? text;
}

/* Bungkus aksi agar galat selalu tampil ke pengguna, tidak hanya di konsol. */
async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function readFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve({ name: f.name, text: String(fr.result) });
      fr.readAsText(f);
    };
    inp.click();
  });
}

/* ============================================================== RINGKASAN */
async function viewRingkasan() {
  const [{ data: rep }, { data: devices }] = await Promise.all([
    api('GET', '/analysis'),
    api('GET', '/devices')
  ]);

  const m = rep.metrics;
  const c = rep.confusion;
  const hasData = rep.progress.done > 0;
  const recallPct = m.recall === null ? 0 : m.recall * 100;
  const state = m.recall === null ? 'wait' : (m.recall >= 0.85 ? 'pass' : 'fail');

  const verdictNote = m.recall === null
    ? 'Belum ada trial yang tercatat.'
    : `${c.TP} dari ${c.TP + c.FN} percobaan kecelakaan berhasil terdeteksi.`;

  main.innerHTML = `
    <h1>Ringkasan pengujian</h1>
    <p class="lede">Hasil ${rep.progress.done} dari ${rep.progress.planned} percobaan
       yang direncanakan pada Tabel 10.2, diolah menjadi confusion matrix Tabel 4.3.</p>

    <section class="verdict">
      <div>
        <p class="verdict-label">Recall deteksi kecelakaan</p>
        <p class="recall-figure is-${state}">${m.recall === null ? '—' : pct(m.recall) + '%'}</p>
        <p class="recall-sub">${esc(verdictNote)}</p>

        <div class="gauge">
          <div class="gauge-track">
            <div class="gauge-fill is-${state}" style="width:${Math.min(100, recallPct)}%"></div>
            <div class="gauge-target" style="left:85%"></div>
            <div class="gauge-target-note" style="left:85%; top:-22px">target 85%</div>
          </div>
          <div class="gauge-scale"><span>0%</span><span>100%</span></div>
        </div>

        <dl class="metrics">
          <div class="metric">
            <dt>Precision</dt>
            <dd>${m.precision === null ? '—' : pct(m.precision) + '%'}<small>Pers. 4.24</small></dd>
          </div>
          <div class="metric">
            <dt>Recall</dt>
            <dd>${m.recall === null ? '—' : pct(m.recall) + '%'}<small>Pers. 4.25</small></dd>
          </div>
          <div class="metric">
            <dt>F1-Score</dt>
            <dd>${m.f1 === null ? '—' : pct(m.f1) + '%'}<small>Pers. 4.26</small></dd>
          </div>
          <div class="metric">
            <dt>Akurasi</dt>
            <dd>${m.accuracy === null ? '—' : pct(m.accuracy) + '%'}<small>keseluruhan</small></dd>
          </div>
        </dl>
      </div>

      <div>
        <div class="matrix">
          <div class="matrix-corner"></div>
          <div class="matrix-head">Sistem memicu alarm</div>
          <div class="matrix-head">Sistem diam</div>

          <div class="matrix-side">Kecelakaan</div>
          <div class="cell good">
            <span class="cell-tag">TP</span>
            <span class="cell-n">${c.TP}</span>
            <span class="cell-note">terdeteksi benar</span>
          </div>
          <div class="cell bad">
            <span class="cell-tag">FN</span>
            <span class="cell-n">${c.FN}</span>
            <span class="cell-note">kecelakaan terlewat</span>
          </div>

          <div class="matrix-side">Tidak kecelakaan</div>
          <div class="cell bad">
            <span class="cell-tag">FP</span>
            <span class="cell-n">${c.FP}</span>
            <span class="cell-note">alarm palsu</span>
          </div>
          <div class="cell good">
            <span class="cell-tag">TN</span>
            <span class="cell-n">${c.TN}</span>
            <span class="cell-note">diam dengan benar</span>
          </div>
        </div>
        <p class="matrix-caption">Baris menunjukkan keadaan sebenarnya, kolom
           menunjukkan keputusan sistem. Kelas positif adalah kecelakaan.</p>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Verifikasi spesifikasi</h2>
          <p class="hint">Tiga parameter Tabel 6.2 yang hanya bisa dibuktikan lewat uji lapangan.</p>
        </div>
        <div class="actions">
          <a class="btn" href="${API}/analysis.csv">Unduh hasil (CSV)</a>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Spesifikasi</th><th>Parameter</th><th>Target</th>
            <th class="num">Hasil</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${rep.checks.map(ck => {
              const val = ck.value === null ? '—'
                : (ck.unit === '%' ? ck.value.toFixed(2) : Math.round(ck.value)) + ' ' + ck.unit;
              const chip = ck.pass === null
                ? '<span class="chip wait">Belum ada data</span>'
                : ck.pass ? '<span class="chip pass">Lulus</span>'
                          : '<span class="chip fail">Tidak lulus</span>';
              return `<tr>
                <td>${esc(ck.spec)}</td>
                <td class="row-main">${esc(ck.name)}</td>
                <td>${esc(ck.target)}</td>
                <td class="num">${val}</td>
                <td>${chip}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Rincian per skenario</h2>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th class="num">No</th><th>Skenario uji</th><th>Label kelas</th>
            <th class="num">Selesai</th><th class="num">Terpicu</th>
            <th class="num">Benar</th><th class="num">Galat</th><th class="num">Akurasi</th>
          </tr></thead>
          <tbody>
            ${rep.perScenario.map(s => `
              <tr>
                <td class="num">${s.no}</td>
                <td class="row-main">${esc(s.name)}</td>
                <td><span class="chip ${s.actual ? 'fail' : 'mute'}">${esc(s.label)}</span></td>
                <td class="num">${s.done} / ${s.planned}</td>
                <td class="num">${s.triggered}</td>
                <td class="num">${s.correct}</td>
                <td class="num">${s.errors ? `${s.errors} ${s.errorKind}` : '0'}</td>
                <td class="num">${s.accuracy === null ? '—' : pct(s.accuracy) + '%'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${hasData ? '' : `<p class="hint">Mulai mencatat di halaman Pengujian;
         tabel ini terisi sendiri seiring percobaan berjalan.</p>`}
    </section>

    <section>
      <h2>Perangkat terdaftar</h2>
      ${devices.length === 0
        ? `<div class="empty">
             <p>Belum ada perangkat. Daftarkan unit DriveSafe untuk mulai menerima
                event log dan mengelola kontak darurat.</p>
             <a class="btn" href="#/perangkat">Daftarkan perangkat</a>
           </div>`
        : `<div class="table-scroll"><table>
            <thead><tr>
              <th>Perangkat</th><th>Pemilik</th><th>Profil</th>
              <th class="num">Kontak</th><th class="num">Kejadian</th>
            </tr></thead>
            <tbody>${devices.map(d => `
              <tr>
                <td class="row-main">${esc(d.device_id)}</td>
                <td>${esc(d.owner)}</td>
                <td>${esc(d.profile)}</td>
                <td class="num">${d.contact_count} / ${META.max_contacts}</td>
                <td class="num">${d.event_count}</td>
              </tr>`).join('')}
            </tbody></table></div>`}
    </section>
  `;
}

/* ============================================================== PENGUJIAN */
async function viewPengujian() {
  const [{ data: rep }, { data: trials }, { data: devices }] = await Promise.all([
    api('GET', '/analysis'),
    api('GET', '/trials'),
    api('GET', '/devices')
  ]);

  const recent = [...trials].reverse().slice(0, 25);

  main.innerHTML = `
    <h1>Pencatatan pengujian</h1>
    <p class="lede">Pilih skenario, lalu catat apakah sistem memicu alarm. Label kelas
       sudah ditetapkan Tabel 10.2, jadi tidak mungkin tertukar saat mencatat.</p>

    <section>
      <div class="section-head">
        <div>
          <h2>Catat percobaan</h2>
          <p class="hint">Kemajuan: ${rep.progress.done} dari ${rep.progress.planned} trial.</p>
        </div>
        <div class="actions">
          <select id="trial-device" style="width:auto">
            <option value="">Tanpa perangkat</option>
            ${devices.map(d => `<option value="${d.id}">${esc(d.device_id)}</option>`).join('')}
          </select>
          <button id="import-trials">Impor CSV</button>
          <button id="reset-trials" class="danger">Hapus semua</button>
        </div>
      </div>

      <div class="scenario-pick">
        ${rep.perScenario.map(s => `
          <div class="scenario-card" data-label="${s.actual}">
            <div class="scenario-title">${s.no}. ${esc(s.name)}</div>
            <div class="scenario-meta">
              <span class="chip ${s.actual ? 'fail' : 'mute'}">${esc(s.label)}</span>
              <span class="scenario-progress">${s.done} / ${s.planned}</span>
            </div>
            <div class="scenario-buttons">
              <button data-rec="${s.no}" data-pred="1">Alarm memicu</button>
              <button data-rec="${s.no}" data-pred="0">Sistem diam</button>
            </div>
          </div>`).join('')}
      </div>
    </section>

    <section>
      <h2>Percobaan terakhir</h2>
      ${recent.length === 0
        ? `<div class="empty"><p>Belum ada percobaan tercatat. Tombol di atas akan
             mengisi tabel ini sekaligus memperbarui confusion matrix.</p></div>`
        : `<div class="table-scroll"><table>
            <thead><tr>
              <th class="num">#</th><th>Skenario</th><th>Sebenarnya</th>
              <th>Keputusan sistem</th><th>Hasil</th><th>Waktu</th><th></th>
            </tr></thead>
            <tbody>${recent.map(t => {
              const correct = (t.predicted ? 1 : 0) === t.actual;
              const kind = correct ? (t.actual ? 'TP' : 'TN') : (t.actual ? 'FN' : 'FP');
              return `<tr>
                <td class="num">${t.scenario}.${t.repetition ?? '—'}</td>
                <td>${esc(rep.perScenario.find(s => s.no === t.scenario)?.name ?? '')}</td>
                <td>${t.actual ? 'Kecelakaan' : 'Tidak kecelakaan'}</td>
                <td>${t.predicted ? 'Memicu alarm' : 'Diam'}</td>
                <td><span class="chip ${correct ? 'pass' : 'fail'}">${kind}</span></td>
                <td class="row-sub">${esc(t.tested_at)} UTC</td>
                <td><button class="quiet" data-del-trial="${t.id}">Hapus</button></td>
              </tr>`;
            }).join('')}</tbody></table></div>`}
    </section>
  `;

  main.querySelectorAll('[data-rec]').forEach(b => {
    b.onclick = () => run(async () => {
      const dev = document.getElementById('trial-device').value;
      await api('POST', '/trials', {
        scenario: Number(b.dataset.rec),
        predicted: Number(b.dataset.pred),
        device_id: dev ? Number(dev) : null
      });
      await render();
    }, 'Percobaan tercatat');
  });

  main.querySelectorAll('[data-del-trial]').forEach(b => {
    b.onclick = () => run(async () => {
      await api('DELETE', '/trials/' + b.dataset.delTrial);
      await render();
    }, 'Percobaan dihapus');
  });

  document.getElementById('reset-trials').onclick = () => {
    if (!confirm('Hapus seluruh catatan percobaan? Tindakan ini tidak bisa dibatalkan.')) return;
    run(async () => {
      await api('POST', '/trials/reset');
      await render();
    }, 'Catatan percobaan dikosongkan');
  };

  document.getElementById('import-trials').onclick = async () => {
    const f = await readFile('.csv,text/csv');
    if (!f) return;
    run(async () => {
      const r = await api('POST', '/trials/import', f.text);
      await render();
      toast(`${r.inserted} baris terimpor` +
            (r.errors.length ? `, ${r.errors.length} baris dilewati` : ''));
    });
  };
}

/* =============================================================== KEJADIAN */
async function viewKejadian() {
  const [{ data: events }, { data: devices }] = await Promise.all([
    api('GET', '/events?limit=200'),
    api('GET', '/devices')
  ]);

  main.innerHTML = `
    <h1>Riwayat kejadian</h1>
    <p class="lede">Event log yang diimpor dari berkas <code>events.csv</code>
       pada memori flash perangkat (Bab 8.3 poin 4).</p>

    <section>
      <div class="section-head">
        <div><h2>${events.length} kejadian tercatat</h2></div>
        <div class="actions">
          <select id="imp-device" style="width:auto">
            ${devices.map(d => `<option value="${d.id}">${esc(d.device_id)}</option>`).join('')}
          </select>
          <button id="import-events" ${devices.length ? '' : 'disabled'}>Impor events.csv</button>
        </div>
      </div>

      ${events.length === 0
        ? `<div class="empty">
             <p>Belum ada kejadian. Salin berkas <code>events.csv</code> dari memori
                flash perangkat, lalu impor dengan tombol di atas.</p>
           </div>`
        : `<div class="table-scroll"><table>
            <thead><tr>
              <th>Waktu</th><th>Perangkat</th><th class="num">G puncak</th>
              <th class="num">Jerk</th><th>Keparahan</th><th>Jenis</th>
              <th>Pemicu</th><th>Lokasi</th><th></th>
            </tr></thead>
            <tbody>${events.map(e => `
              <tr>
                <td class="row-main">${esc(fmtTs(e.ts))}</td>
                <td>${esc(e.device_code)}<div class="row-sub">${esc(e.owner)}</div></td>
                <td class="num">${num(e.g_peak)} g</td>
                <td class="num">${num(e.j_peak, 0)}</td>
                <td><span class="chip ${e.severity === 2 ? 'fail' : e.severity === 1 ? 'wait' : 'mute'}">${esc(e.severity_name)}</span></td>
                <td>${esc(e.crash_type_name)}</td>
                <td><div class="trigger-list">${e.triggers.map(t =>
                     `<span class="chip mute">${esc(t)}</span>`).join('') || '—'}</div></td>
                <td>${e.maps_url
                      ? `<a href="${esc(e.maps_url)}" target="_blank" rel="noopener">Buka peta</a>`
                      : '<span class="row-sub">Tanpa GPS</span>'}</td>
                <td><button class="quiet" data-del-event="${e.id}">Hapus</button></td>
              </tr>`).join('')}
            </tbody></table></div>`}
    </section>
  `;

  main.querySelectorAll('[data-del-event]').forEach(b => {
    b.onclick = () => run(async () => {
      await api('DELETE', '/events/' + b.dataset.delEvent);
      await render();
    }, 'Kejadian dihapus');
  });

  const imp = document.getElementById('import-events');
  if (imp) imp.onclick = async () => {
    const id = document.getElementById('imp-device').value;
    const f = await readFile('.csv,text/csv');
    if (!f) return;
    run(async () => {
      const r = await api('POST', `/events/import?device_id=${id}`, f.text);
      await render();
      toast(`${r.inserted} kejadian terimpor` +
            (r.duplicate ? `, ${r.duplicate} duplikat dilewati` : ''));
    });
  };
}

/* ============================================================== PERANGKAT */
async function viewPerangkat() {
  const { data: devices } = await api('GET', '/devices');

  const detail = await Promise.all(
    devices.map(d => api('GET', '/devices/' + d.id).then(r => r.data))
  );

  main.innerHTML = `
    <h1>Perangkat dan kontak darurat</h1>
    <p class="lede">Catatan konfigurasi tiap unit DriveSafe. Konfigurasi ini dikirim
       ke perangkat lewat pairing BLE dari aplikasi mobile, sesuai Tabel 6.1.</p>

    <section class="panel">
      <h2>Daftarkan perangkat baru</h2>
      <form class="grid" id="form-device">
        <div>
          <label for="f-id">Nama perangkat</label>
          <input id="f-id" required placeholder="DriveSafe-0078">
        </div>
        <div>
          <label for="f-owner">Pemilik</label>
          <input id="f-owner" placeholder="Lisa Olivia">
        </div>
        <div>
          <label for="f-profile">Profil kendaraan</label>
          <select id="f-profile">
            <option value="sepeda">Sepeda</option>
            <option value="motor" selected>Motor</option>
            <option value="mobil">Mobil</option>
          </select>
        </div>
        <div>
          <label for="f-cd">Hitung mundur (detik)</label>
          <input id="f-cd" type="number" min="5" max="120" value="30">
        </div>
        <div><button class="primary" type="submit">Daftarkan perangkat</button></div>
      </form>
      <p class="hint">Nama perangkat muncul di Serial Monitor saat perangkat menyala,
         pada baris <code>[BLE] Peripheral siap sebagai …</code></p>
    </section>

    ${detail.length === 0 ? '' : detail.map(d => `
      <section class="panel" data-device="${d.id}">
        <div class="section-head">
          <div><h2>${esc(d.device_id)}</h2></div>
          <div class="actions">
            <button class="danger" data-del-device="${d.id}">Hapus perangkat</button>
          </div>
        </div>

        <form class="grid" data-update="${d.id}">
          <div>
            <label>Pemilik</label>
            <input name="owner" value="${esc(d.owner)}">
          </div>
          <div>
            <label>Profil kendaraan</label>
            <select name="profile">
              ${['sepeda', 'motor', 'mobil'].map(p =>
                `<option value="${p}" ${p === d.profile ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Hitung mundur (detik)</label>
            <input name="countdown_s" type="number" min="5" max="120" value="${d.countdown_s}">
          </div>
          <div><button type="submit">Simpan perubahan</button></div>
        </form>

        <h3 style="margin-top:1.5rem">Kontak darurat
          <span class="chip mute">${d.contacts.length} dari ${META.max_contacts}</span></h3>
        ${d.contacts.length === 0
          ? `<p class="hint">Belum ada kontak. Tanpa kontak, perangkat tidak bisa
               mengirim SMS darurat.</p>`
          : `<div class="table-scroll"><table>
              <thead><tr><th class="num">Prioritas</th><th>Nama</th><th>Nomor</th><th></th></tr></thead>
              <tbody>${d.contacts.map((c, i) => `
                <tr>
                  <td class="num">${c.priority}${i === 0
                    ? ' <span class="chip pass">missed call</span>' : ''}</td>
                  <td class="row-main">${esc(c.name)}</td>
                  <td class="num">${esc(c.phone)}</td>
                  <td><button class="quiet" data-del-contact="${c.id}">Hapus</button></td>
                </tr>`).join('')}
              </tbody></table></div>`}

        <form class="grid" data-add-contact="${d.id}" style="margin-top:.9rem">
          <div>
            <label>Nama</label>
            <input name="name" maxlength="15" placeholder="Ayah" required>
          </div>
          <div>
            <label>Nomor telepon</label>
            <input name="phone" maxlength="15" placeholder="+6281234567890" required>
          </div>
          <div>
            <label>Prioritas</label>
            <input name="priority" type="number" min="1" max="5" value="${d.contacts.length + 1}">
          </div>
          <div>
            <button type="submit" ${d.contacts.length >= META.max_contacts ? 'disabled' : ''}>
              Tambah kontak
            </button>
          </div>
        </form>
        ${d.contacts.length >= META.max_contacts
          ? `<p class="hint">Batas ${META.max_contacts} kontak tercapai (Tabel 6.2 no.8).
               Hapus salah satu untuk menambah yang baru.</p>` : ''}
      </section>`).join('')}
  `;

  document.getElementById('form-device').onsubmit = ev => {
    ev.preventDefault();
    run(async () => {
      await api('POST', '/devices', {
        device_id: document.getElementById('f-id').value.trim(),
        owner: document.getElementById('f-owner').value.trim() || 'Pengguna',
        profile: document.getElementById('f-profile').value,
        countdown_s: Number(document.getElementById('f-cd').value)
      });
      await render();
    }, 'Perangkat terdaftar');
  };

  main.querySelectorAll('[data-update]').forEach(f => {
    f.onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(f);
      run(async () => {
        await api('PATCH', '/devices/' + f.dataset.update, {
          owner: fd.get('owner'),
          profile: fd.get('profile'),
          countdown_s: Number(fd.get('countdown_s'))
        });
        await render();
      }, 'Perubahan tersimpan');
    };
  });

  main.querySelectorAll('[data-add-contact]').forEach(f => {
    f.onsubmit = ev => {
      ev.preventDefault();
      const fd = new FormData(f);
      run(async () => {
        await api('POST', `/devices/${f.dataset.addContact}/contacts`, {
          name: fd.get('name'),
          phone: fd.get('phone'),
          priority: Number(fd.get('priority'))
        });
        await render();
      }, 'Kontak ditambahkan');
    };
  });

  main.querySelectorAll('[data-del-contact]').forEach(b => {
    b.onclick = () => run(async () => {
      await api('DELETE', '/contacts/' + b.dataset.delContact);
      await render();
    }, 'Kontak dihapus');
  });

  main.querySelectorAll('[data-del-device]').forEach(b => {
    b.onclick = () => {
      if (!confirm('Hapus perangkat beserta seluruh kontak dan kejadiannya?')) return;
      run(async () => {
        await api('DELETE', '/devices/' + b.dataset.delDevice);
        await render();
      }, 'Perangkat dihapus');
    };
  });
}

/* ================================================================= router */
const VIEWS = {
  ringkasan: viewRingkasan,
  pengujian: viewPengujian,
  kejadian:  viewKejadian,
  perangkat: viewPerangkat
};

function currentView() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return VIEWS[name] ? name : 'ringkasan';
}

async function render() {
  const name = currentView();

  document.querySelectorAll('#nav a').forEach(a => {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    if (!META) META = await api('GET', '/meta');
    await VIEWS[name]();
  } catch (e) {
    main.innerHTML = `<div class="empty">
      <p>Tidak bisa memuat data: ${esc(e.message)}</p>
      <p class="hint">Pastikan server berjalan, lalu muat ulang halaman.</p>
      <button onclick="location.reload()">Muat ulang</button>
    </div>`;
  }

  try {
    const h = await api('GET', '/health');
    document.getElementById('footer-meta').textContent =
      `DriveSafe Backend ${h.version} · Node ${h.node} · Capstone B-06 DTETI UGM`;
  } catch { /* footer tidak kritis */ }
}

window.addEventListener('hashchange', render);
render();
