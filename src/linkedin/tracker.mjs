// src/linkedin/tracker.mjs - Pelacak status lamaran (CSV ringan, tanpa dependency).
// Semua fungsi murni: input string/array, output array/object baru.

export const STATUS_LIST = ['new', 'reviewing', 'applied', 'interview', 'skipped', 'rejected', 'offer'];

const STATUS_ALIAS = {
  applied: 'applied', apply: 'applied', submitted: 'applied', terkirim: 'applied',
  interview: 'interview', interviewing: 'interview', interview_process: 'interview',
  skipped: 'skipped', skip: 'skipped', dilewati: 'skipped',
  rejected: 'rejected', reject: 'rejected', ditolak: 'rejected',
  new: 'new', reviewing: 'reviewing', offer: 'offer',
};

function clean(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function normKey(v) {
  return clean(v).toLowerCase().replace(/\s+/g, ' ');
}

export function normStatus(status) {
  const s = clean(status).toLowerCase();
  return STATUS_ALIAS[s] || s;
}

// Parser CSV sederhana: header-aware, mendukung kutip dan koma di dalam field.
export function parseCsv(text) {
  const src = String(text === undefined || text === null ? '' : text);
  if (!src.trim()) return [];
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const kept = records.filter((r) => r.some((c) => clean(c) !== ''));
  if (!kept.length) return [];
  const header = kept[0].map((h) => clean(h));
  const out = [];
  for (let i = 1; i < kept.length; i++) {
    const rec = kept[i];
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = rec[idx] === undefined ? '' : clean(rec[idx]);
    });
    out.push(obj);
  }
  return out;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Serialisasi baris jadi CSV (header + baris).
export function toCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const keys = [];
  for (const r of list) {
    for (const k of Object.keys(r || {})) {
      if (keys.indexOf(k) < 0) keys.push(k);
    }
  }
  const lines = [keys.map(csvEscape).join(',')];
  for (const r of list) {
    lines.push(keys.map((k) => csvEscape((r || {})[k])).join(','));
  }
  return lines.join('\n') + '\n';
}

// Tambah baris lowongan; dedupe memakai company+role+url.
export function upsertRow(rows, row) {
  const list = Array.isArray(rows) ? rows.map((r) => Object.assign({}, r)) : [];
  const incoming = Object.assign({}, row || {});
  const keyOf = (r) => [normKey(r.company), normKey(r.role), normKey(r.url)].join('|');
  const inKey = keyOf(incoming);
  const exact = list.findIndex((r) => keyOf(r) === inKey);
  if (exact >= 0) {
    // Lowongan sama persis: gabungkan isian baru tanpa membuat duplikat.
    const target = list[exact];
    for (const k of Object.keys(incoming)) {
      if (clean(incoming[k]) !== '') target[k] = incoming[k];
    }
    return list;
  }
  // company+role sama tapi URL berbeda: tetap tambah, dan segarkan date_found baris lama.
  if (clean(incoming.date_found)) {
    for (const r of list) {
      if (normKey(r.company) === normKey(incoming.company) && normKey(r.role) === normKey(incoming.role)) {
        r.date_found = incoming.date_found;
      }
    }
  }
  list.push(incoming);
  return list;
}

// Ubah status baris (applied/interview/skipped/rejected) berdasarkan company+role.
export function setStatus(rows, company, role, status) {
  const list = Array.isArray(rows) ? rows.map((r) => Object.assign({}, r)) : [];
  const target = normStatus(status);
  const today = new Date().toISOString().slice(0, 10);
  let hit = 0;
  for (const r of list) {
    if (normKey(r.company) === normKey(company) && normKey(r.role) === normKey(role)) {
      r.status = target;
      r.updated_at = today;
      hit++;
    }
  }
  if (!hit) return list;
  return list;
}

function scoreOf(row) {
  const n = Number(clean(row.match_score));
  return Number.isFinite(n) ? n : 0;
}

function activityDate(row) {
  return clean(row.updated_at) || clean(row.date_found);
}

// Ringkasan harian: lowongan baru pada tanggal + status yang terjadi pada tanggal itu.
export function dailySummary(rows, dateISO) {
  const list = Array.isArray(rows) ? rows : [];
  const day = clean(dateISO);
  const found = list.filter((r) => clean(r.date_found) === day);
  const countStatus = (st) => list.filter((r) => normStatus(r.status) === st && activityDate(r) === day).length;
  const applied = countStatus('applied');
  const interview = countStatus('interview');
  const skipped = countStatus('skipped');
  const rejected = countStatus('rejected');
  const top = found
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a) || normKey(a.company).localeCompare(normKey(b.company)))
    .slice(0, 3)
    .map((r) => ({
      company: clean(r.company),
      role: clean(r.role),
      match_score: clean(r.match_score),
      location: clean(r.location),
      url: clean(r.url),
    }));
  let text = 'Harian ' + day + ': ' + found.length + ' lowongan baru, ' + applied + ' dilamar, ' + interview + ' interview, ' + skipped + ' dilewati.';
  if (rejected) text += ' ' + rejected + ' ditolak.';
  if (top.length) {
    text += ' Teratas: ' + top.map((t) => (t.company || '-') + ' - ' + (t.role || '-') + ' (match ' + (t.match_score || '-') + ')').join('; ') + '.';
  }
  return { total: found.length, applied, interview, skipped, rejected, top, text };
}
