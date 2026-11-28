// src/linkedin/search.mjs - Rencana pencarian lowongan LinkedIn untuk agen cloud.
// Modul ini TIDAK memanggil LinkedIn dan TIDAK menjalankan browser.
// Yang dihasilkan: rencana (URL, query, instruksi, guardrail) untuk agen cloud MiniMax.

export const COLUMNS = [
  'company', 'role', 'type', 'location', 'url', 'contact',
  'salary', 'match_score', 'notes', 'date_found', 'status',
];

export const OUTPUT_FILE = '/workspace/output/Job_Listings.csv';
export const FRAME_DIR = '/workspace/output';
export const FRAME_IMAGE = FRAME_DIR + '/frame_latest.png';
export const FRAME_STATUS = FRAME_DIR + '/frame_status.json';
export const VIEWPORT = { width: 1280, height: 900 };
export const SEARCH_URL_BASE = 'https://www.linkedin.com/jobs/search/';
export const STOP_SIGNALS = ['captcha', 'challenge', '999', '429', '403', 'forbidden', 'verifikasi identitas'];
export const FALLBACK_SOURCES = ['Indeed', 'Glassdoor'];

function clean(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

// Terima array atau string yang dipisah koma/pipe/semicolon.
export function toList(input) {
  if (Array.isArray(input)) return input.map(clean).filter(Boolean);
  const s = clean(input);
  if (!s) return '';
  return s.split(/[,;|]/).map(clean).filter(Boolean);
}

// Susun variasi query singkat (1-6 kata), minimal 5 maksimal 10.
function buildQueries(roles, city, inds, comps) {
  const out = [];
  const add = (q) => {
    const s = clean(q).replace(/\s+/g, ' ');
    if (!s) return;
    if (s.split(' ').length > 6) return;
    if (out.indexOf(s) >= 0) return;
    out.push(s);
  };
  for (const r of roles) {
    add(r);
    if (city) add(r + ' ' + city);
    add(r + ' remote');
    if (inds[0]) add(r + ' ' + inds[0]);
    if (comps[0]) add(comps[0] + ' ' + r);
  }
  const base = roles[0] || 'lowongan';
  add(base + ' jobs');
  add(base + ' hiring');
  add('lowongan ' + base);
  if (city) add(city + ' ' + base + ' jobs');
  if (inds[0]) add(inds[0] + ' jobs ' + (city || base));
  if (comps[0]) add(comps[0] + ' careers ' + base);
  return out.slice(0, 10);
}

// Rencana pencarian: URL target + query cadangan + instruksi agen + guardrail.
export function buildSearchPlan({ keywords, location = '', limit = 10, industries = '', companies = '' } = {}) {
  const roles = toList(keywords);
  const loc = clean(location);
  const city = loc ? loc.split(',')[0].trim() : '';
  const inds = toList(industries);
  const comps = toList(companies);
  const kw = roles.length ? roles.join(' ') : 'lowongan';
  const maxItems = Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
  const url = SEARCH_URL_BASE + '?keywords=' + encodeURIComponent(kw) + '&location=' + encodeURIComponent(loc);
  const queries = buildQueries(roles.length ? roles : [kw], city, inds, comps);

  const instructions = [
    'Buka ' + url + ' lewat BROWSER cloud (Playwright Chromium). JANGAN fetch mentah ke linkedin.com - fetch mentah kena kode 999 anti-bot.',
    'Set viewport ' + VIEWPORT.width + 'x' + VIEWPORT.height + ' sebelum memuat halaman.',
    'Pakai storage state milik akun pengguna sendiri bila sudah tersedia. Kalau belum login, berhenti dan minta user login. Jangan memakai akun orang lain.',
    'Jalankan query di bawah satu per satu lewat kotak pencarian, ambil maksimal ' + maxItems + ' lowongan per sesi.',
    'Setelah tiap langkah penting, tulis ' + FRAME_IMAGE + ' dan ' + FRAME_STATUS + ' (goal, url, step, caption).',
    'Kumpulkan per lowongan: company, role, type (remote/hybrid/in-person), location, url, contact, salary, match_score (1-5), notes.',
    'Simpan hasil ke ' + OUTPUT_FILE + ' dengan header: ' + COLUMNS.join(',') + '.',
    'Baris baru: status = new, date_found = tanggal ISO hari ini. contact dan salary yang tidak ditemukan dikosongkan, jangan ditebak.',
    'Dedup: satu baris per company+role+url. Kalau company+role sama tapi URL berbeda, tambah baris baru dan perbarui date_found baris lama.',
    'Sumber cadangan bila hasil LinkedIn kurang: ' + FALLBACK_SOURCES.join(' lalu ') + '. Aturan browser dan guardrail yang sama tetap berlaku.',
    'Kalau muncul captcha, challenge, 999, 429, 403, atau verifikasi identitas: hentikan, tulis frame_status.json dengan step = "blocked", lalu tanya user.',
    'Tutup dengan ringkasan singkat: jumlah lowongan baru dan daftar perusahaan teratas.',
  ];

  const guardrails = [
    'Jangan fetch mentah ke linkedin.com (kode 999 anti-bot) - selalu lewat browser cloud.',
    'Jangan bypass atau solving captcha/challenge; hentikan dan minta user.',
    'Jangan mengarang data lowongan, kontak, gaji, atau URL; data kosong lebih baik daripada data palsu.',
    'Jangan apply atau mengirim lamaran tanpa konfirmasi user saat mode confirm.',
    'Jangan memakai akun, cookie, atau storage state milik pihak lain.',
    'Jangan menulis atau menimpa file di luar folder output milik pengguna.',
  ];

  return {
    source: 'linkedin',
    url,
    queries,
    instructions,
    outputFile: OUTPUT_FILE,
    columns: COLUMNS.slice(),
    guardrails,
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    frameImage: FRAME_IMAGE,
    frameStatus: FRAME_STATUS,
    frameStatusFields: ['goal', 'url', 'step', 'caption'],
    maxListings: maxItems,
    fallbackSources: FALLBACK_SOURCES.slice(),
    stopSignals: STOP_SIGNALS.slice(),
  };
}

const URL_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/jobs\/(?:view\/)?[A-Za-z0-9\-_]+(?:\?[^\s]*)?/i;
const LABEL_RE = /^(?:title|judul|perusahaan|company|organisasi|lokasi|location|tipe|type|url|company name|role|posisi)\s*[:\-]\s*/i;
const CITY_HINT = /^(jakarta|bandung|surabaya|makassar|medan|semarang|yogyakarta|denpasar|bali|jawa|jawa barat|jawa timur|jawa tengah|dki jakarta|sumatera|kalimantan|sulawesi|papua|malaysia|singapore|indonesia|asia|europe|united states|remote|hybrid|on-?site|in-?office)$/i;
const REGION_HINT = /^(indonesia|jawa barat|jawa timur|jawa tengah|dki jakarta|sumatera|kalimantan|sulawesi|papua|malaysia|singapore|asia|europe|united states|remote|hybrid|on-?site)$/i;
const COMPANY_HINT = /\b(pt|cv|tbk|inc|ltd|llc|corp|corporation|group|holdings|bank|university|hospital|laboratories|technologies|solutions|ventures|enterprise|consulting)\b/i;

function stripLabels(line) {
  let s = clean(line);
  s = s.replace(/^[\u2022\u25cf\u00b7*\-\u2013\u2014]+\s*/, '');
  s = s.replace(/^\d+[.)]\s*/, '');
  s = s.replace(LABEL_RE, '');
  s = s.replace(/[|\u2022]\s*$/, '');
  return s.trim();
}

function extractJobUrl(line) {
  const m = String(line || '').match(URL_RE);
  if (!m) return '';
  let u = m[0];
  if (!/^https?:/i.test(u)) u = 'https://' + u.replace(/^\/\//, '');
  return u.replace(/[),.;]+$/, '');
}

// Deteksi baris yang berisi lokasi (kota, wilayah, remote/hybrid).
function looksLikeLocation(v) {
  const s = clean(v).toLowerCase();
  if (!s) return false;
  if (/^(remote|hybrid|on-?site|in-?office|work from home)/.test(s)) return true;
  if (CITY_HINT.test(s)) return true;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) return REGION_HINT.test(parts[1]);
  if (parts.length >= 3) return CITY_HINT.test(parts[parts.length - 1]);
  return false;
}

function cleanLocation(v) {
  const s = clean(v).replace(/[\u2022|]+$/, '').trim();
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 1];
  return s;
}

// Pecah baris jadi segmen: pemisah '|' memisahkan field, koma memisahkan title/company/location.
function flattenSegments(lines) {
  const out = [];
  for (const line of lines) {
    const segs = String(line).split(/\s*\|\s*/).filter(Boolean);
    for (const seg of segs) {
      const parts = seg.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) out.push(...parts);
      else out.push(seg.trim());
    }
  }
  return out;
}

function splitSingleLine(v) {
  const at = v.split(/\s+(?:at|@|di)\s+/i);
  if (at.length >= 2) return { title: at[0].trim(), company: at.slice(1).join(' ').trim() };
  const dash = v.split(/\s+[-\u2013\u2014]\s+/);
  if (dash.length >= 2) {
    const first = dash[0].trim();
    const second = dash.slice(1).join(' - ').trim();
    if (COMPANY_HINT.test(first)) return { title: second, company: first };
    return { title: first, company: second };
  }
  return { title: v, company: '' };
}

function buildItem(lines, url) {
  const segs = flattenSegments(lines).map(clean).filter(Boolean);
  if (!segs.length) return url ? { title: '', company: '', location: '', url } : null;
  let location = '';
  const removed = new Set();
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!looksLikeLocation(segs[i])) continue;
    // dua segmen berurutan yang sama-sama wilayah digabung: "Jakarta, Indonesia"
    if (i > 0 && CITY_HINT.test(segs[i]) && CITY_HINT.test(segs[i - 1])) {
      location = segs[i - 1] + ', ' + segs[i];
      removed.add(i - 1);
    } else {
      location = cleanLocation(segs[i]);
    }
    removed.add(i);
    break;
  }
  const rest = segs.filter((v, i) => !removed.has(i));
  let title = '';
  let company = '';
  if (rest.length >= 2) {
    title = rest[0];
    company = rest[1];
  } else if (rest.length === 1) {
    const parsed = splitSingleLine(rest[0]);
    title = parsed.title;
    company = parsed.company;
  }
  if (!title && !company && !url) return null;
  return { title, company, location, url: url || '' };
}

// Parsir teks hasil ekstraksi browser (blok teks kartu lowongan) menjadi daftar lowongan.
export function parseListingCards(cardsText) {
  const text = String(cardsText === undefined || cardsText === null ? '' : cardsText);
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map((l) => stripLabels(l)).filter(Boolean);
  const items = [];
  let block = [];
  const close = (url) => {
    const item = buildItem(block, url);
    if (item) items.push(item);
    block = [];
  };
  for (const line of lines) {
    const url = extractJobUrl(line);
    if (url) {
      const rest = stripLabels(line.replace(URL_RE, ' '));
      if (rest) block.push(rest);
      close(url);
      continue;
    }
    block.push(line);
  }
  if (block.length) close('');
  return items;
}
