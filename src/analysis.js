import { Trials, SCENARIOS } from './db.js';

export const TARGET_RECALL     = 0.85;
export const TARGET_DETECT_MS  = 10000;
export const TARGET_SMS_MS     = 30000;

export function confusionMatrix(trials) {
  let TP = 0, FP = 0, TN = 0, FN = 0;

  for (const t of trials) {
    const a = t.actual ? 1 : 0;
    const p = t.predicted ? 1 : 0;
    if (a === 1 && p === 1) TP++;
    else if (a === 0 && p === 1) FP++;
    else if (a === 0 && p === 0) TN++;
    else FN++;
  }
  return { TP, FP, TN, FN };
}

function div(num, den) {
  return den === 0 ? null : num / den;
}

export function metrics({ TP, FP, TN, FN }) {
  const precision = div(TP, TP + FP);                
  const recall    = div(TP, TP + FN);                 
  const f1 = (precision === null || recall === null || precision + recall === 0)
    ? null
    : (2 * precision * recall) / (precision + recall); 
  const accuracy    = div(TP + TN, TP + FP + TN + FN);
  const specificity = div(TN, TN + FP);
  const fpr         = div(FP, FP + TN);

  return { precision, recall, f1, accuracy, specificity, fpr };
}

function timing(values) {
  const v = values.filter(x => typeof x === 'number' && Number.isFinite(x))
                  .sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, min: null, avg: null, max: null, p95: null };
  const sum = v.reduce((a, b) => a + b, 0);
  const idx = Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1);
  return {
    n: v.length,
    min: v[0],
    avg: sum / v.length,
    max: v[v.length - 1],
    p95: v[Math.max(0, idx)]
  };
}

export function buildReport() {
  const all = Trials.list();
  const cm  = confusionMatrix(all);
  const m   = metrics(cm);

  const perScenario = SCENARIOS.map(s => {
    const rows = all.filter(t => t.scenario === s.no);
    const correct = rows.filter(t => (t.predicted ? 1 : 0) === s.actual).length;
    const triggered = rows.filter(t => t.predicted).length;
    return {
      no: s.no,
      name: s.name,
      label: s.actual ? 'Kecelakaan' : 'Tidak Kecelakaan',
      actual: s.actual,
      planned: s.planned,
      done: rows.length,
      triggered,
      correct,
      accuracy: rows.length ? correct / rows.length : null,
      errorKind: s.actual ? 'FN' : 'FP',
      errors: rows.length - correct
    };
  });

  const plannedTotal = SCENARIOS.reduce((a, s) => a + s.planned, 0);
  const doneTotal    = all.length;

  const detect = timing(all.filter(t => t.predicted).map(t => t.detect_ms));
  const sms    = timing(all.filter(t => t.predicted).map(t => t.sms_ms));

  const checks = [
    {
      spec: 'Tabel 6.2 no.1',
      name: 'Recall deteksi kecelakaan',
      target: '>= 85 %',
      value: m.recall === null ? null : m.recall * 100,
      unit: '%',
      pass: m.recall === null ? null : m.recall >= TARGET_RECALL
    },
    {
      spec: 'Tabel 6.2 no.3',
      name: 'Waktu deteksi (maks)',
      target: '< 10.000 ms',
      value: detect.max,
      unit: 'ms',
      pass: detect.max === null ? null : detect.max < TARGET_DETECT_MS
    },
    {
      spec: 'Tabel 6.2 no.4',
      name: 'Waktu pengiriman SMS (maks)',
      target: '<= 30.000 ms',
      value: sms.max,
      unit: 'ms',
      pass: sms.max === null ? null : sms.max <= TARGET_SMS_MS
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    progress: {
      done: doneTotal,
      planned: plannedTotal,
      percent: plannedTotal ? (doneTotal / plannedTotal) * 100 : 0,
      complete: doneTotal >= plannedTotal
    },
    confusion: cm,
    metrics: m,
    perScenario,
    timing: { detect, sms },
    checks
  };
}
export function parseEventsCsv(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ['Berkas kosong'] };

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('ts') && header.includes('g_peak');
  const body = hasHeader ? lines.slice(1) : lines;

  const rows = [];
  const errors = [];

  body.forEach((line, i) => {
    const p = line.split(',').map(s => s.trim());
    if (p.length < 12) {
      errors.push(`Baris ${i + (hasHeader ? 2 : 1)}: hanya ${p.length} kolom, butuh 12`);
      return;
    }
    const num = (x, d = 0) => {
      const v = Number(x);
      return Number.isFinite(v) ? v : d;
    };
    const flagStr = p[11];
    const flags = /^0x/i.test(flagStr) ? parseInt(flagStr, 16) : num(flagStr, 0);

    rows.push({
      ts: Math.trunc(num(p[0])),
      g_peak: num(p[1]),
      j_peak: num(p[2]),
      r_peak: num(p[3]),
      lat: p[4] === '' ? null : num(p[4]),
      lon: p[5] === '' ? null : num(p[5]),
      roll_peak: num(p[6]),
      pitch_peak: num(p[7]),
      severity: Math.min(2, Math.max(0, Math.trunc(num(p[8])))),
      crash_type: Math.min(5, Math.max(0, Math.trunc(num(p[9])))),
      profile: ['sepeda', 'motor', 'mobil'][Math.trunc(num(p[10], 1))] ?? 'motor',
      flags: Number.isFinite(flags) ? flags : 0,
      source: 'csv'
    });
  });

  return { rows, errors };
}

export function parseTrialsCsv(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ['Berkas kosong'] };

  const hasHeader = /scenario|skenario/i.test(lines[0]);
  const body = hasHeader ? lines.slice(1) : lines;

  const rows = [];
  const errors = [];

  body.forEach((line, i) => {
    const p = line.split(',').map(s => s.trim());
    const lineNo = i + (hasHeader ? 2 : 1);

    const scenario = Number(p[0]);
    if (!SCENARIOS.some(s => s.no === scenario)) {
      errors.push(`Baris ${lineNo}: skenario "${p[0]}" tidak ada di Tabel 10.2 (1-7)`);
      return;
    }
    const predRaw = String(p[1] ?? '').toLowerCase();
    const predicted = ['1', 'true', 'ya', 'y', 'terpicu', 'detect'].includes(predRaw) ? 1
                    : ['0', 'false', 'tidak', 'n', 'no'].includes(predRaw) ? 0 : null;
    if (predicted === null) {
      errors.push(`Baris ${lineNo}: kolom predicted "${p[1]}" tidak dikenali (pakai 1/0)`);
      return;
    }

    const optNum = x => {
      if (x === undefined || x === '') return null;
      const v = Number(x);
      return Number.isFinite(v) ? v : null;
    };

    rows.push({
      scenario,
      predicted,
      detect_ms: optNum(p[2]),
      sms_ms: optNum(p[3]),
      g_peak: optNum(p[4]),
      note: p[5] || null
    });
  });

  return { rows, errors };
}

export function reportToCsv(report) {
  const pct = v => (v === null ? '-' : (v * 100).toFixed(2));
  const L = [];

  L.push('DriveSafe - Hasil Pengujian (Dokumen C-251, Tabel 10.2)');
  L.push(`Dibuat,${report.generated_at}`);
  L.push(`Trial selesai,${report.progress.done} dari ${report.progress.planned}`);
  L.push('');
  L.push('CONFUSION MATRIX (Tabel 4.3)');
  L.push(',Prediksi: Kecelakaan,Prediksi: Tidak');
  L.push(`Aktual: Kecelakaan,${report.confusion.TP},${report.confusion.FN}`);
  L.push(`Aktual: Tidak,${report.confusion.FP},${report.confusion.TN}`);
  L.push('');
  L.push('METRIK EVALUASI');
  L.push('Metrik,Nilai (%),Persamaan');
  L.push(`Precision,${pct(report.metrics.precision)},Pers. 4.24`);
  L.push(`Recall,${pct(report.metrics.recall)},Pers. 4.25`);
  L.push(`F1-Score,${pct(report.metrics.f1)},Pers. 4.26`);
  L.push(`Accuracy,${pct(report.metrics.accuracy)},-`);
  L.push(`Specificity,${pct(report.metrics.specificity)},-`);
  L.push('');
  L.push('RINCIAN PER SKENARIO');
  L.push('No,Skenario,Label,Rencana,Selesai,Terpicu,Benar,Akurasi (%),Jenis Galat,Galat');
  for (const s of report.perScenario) {
    L.push([s.no, `"${s.name}"`, s.label, s.planned, s.done, s.triggered,
            s.correct, pct(s.accuracy), s.errorKind, s.errors].join(','));
  }
  L.push('');
  L.push('VERIFIKASI SPESIFIKASI (Tabel 6.2)');
  L.push('Spesifikasi,Parameter,Target,Hasil,Status');
  for (const c of report.checks) {
    const val = c.value === null ? '-' :
      (c.unit === '%' ? c.value.toFixed(2) : Math.round(c.value)) + ' ' + c.unit;
    const st = c.pass === null ? 'Belum ada data' : (c.pass ? 'LULUS' : 'TIDAK LULUS');
    L.push(`${c.spec},"${c.name}",${c.target},${val},${st}`);
  }

  return L.join('\n');
}
