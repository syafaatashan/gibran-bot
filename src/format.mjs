// Formatter jawaban agen -> pesan Telegram yang ringkas dan enak dibaca di HP.
// Aturan: heading markdown jadi bold, tabel jadi bullet, kode panjang diringkas,
// blok meta (niat kerja agen) dibuang, sisanya dipotong pada batas kata.

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_MAX_BLOCKS = 3;
const DEFAULT_CODE_LINES = 15;
const DEFAULT_TABLE_ROWS = 8;

const EMPTY_TEXT = 'Maaf, jawaban kosong. Coba ulangi ya.';
const TAIL_NOTE = '_… ada detail lain, tanya saya untuk sisanya._';

// label meta: dibuang, isi setelahnya tetap dipakai
const META_LABEL = /^(ringkasan\s+(factual|faktual)|rangkuman\s+(factual|faktual)|factual\s+summary|rencana(?:\s+kerja)?|plan|langkah\s+berikutnya|next\s+steps|catatan\s+aja)\s*[:\-–.]?\s*$/i;
// niat kerja agen: satu paragraf penuh dibuang
const META_INTENT = /^\s*(saya\s+(akan|sudah|sedang|mau|ingin|perlu)|i\s+(will|am\s+going\s+to|need\s+to))\b/i;

export function formatAnswer(text, opts) {
  const o = Object.assign({
    maxChars: DEFAULT_MAX_CHARS,
    maxBlocks: DEFAULT_MAX_BLOCKS,
    codeLines: DEFAULT_CODE_LINES,
    tableRows: DEFAULT_TABLE_ROWS,
  }, opts || {});
  const conv = convert(text, o);
  if (!conv.units.length) {
    return { text: EMPTY_TEXT, truncated: false, hadTable: conv.hadTable, longDetail: false };
  }
  const budget = Math.max(60, o.maxChars - TAIL_NOTE.length - 2);
  const parts = [];
  let used = 0;
  let dropped = false;
  for (const u of conv.units) {
    if (parts.length >= o.maxBlocks) { dropped = true; break; }
    const add = (parts.length ? 2 : 0) + u.text.length;
    if (used + add > budget) { dropped = true; break; }
    parts.push(u);
    used += add;
  }
  let out = parts.map((u) => u.text).join('\n\n');
  if (!parts.length) {
    out = cutAtWord(conv.units[0].text, budget);
    dropped = true;
  } else if (dropped) {
    out = cutAtWord(out, budget);
  }
  if (dropped || conv.summarized) out = out + '\n\n' + TAIL_NOTE;
  out = sanitize(out);
  if (out.length > o.maxChars) out = cutAtWord(out, o.maxChars);
  return {
    text: out,
    truncated: dropped,
    hadTable: conv.hadTable,
    longDetail: dropped || conv.summarized,
  };
}

// potong teks panjang pada batas kata (kalau tidak ada kata, potong paksa)
export function chunkText(text, limit) {
  const max = Math.max(1, Number(limit) || 3900);
  const src = normalize(text).trim();
  if (!src) return [];
  const chunks = [];
  let rest = src;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < Math.floor(max * 0.5)) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).replace(/\s+$/, ''));
    rest = rest.slice(cut).replace(/^\n+/, '').replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// markdown agen -> format Telegram (tanpa pemotongan panjang)
export function toTelegram(text, opts) {
  const o = Object.assign({ codeLines: DEFAULT_CODE_LINES, tableRows: DEFAULT_TABLE_ROWS }, opts || {});
  const conv = convert(text, o);
  let out = conv.units.map((u) => u.text).join('\n\n');
  out = sanitize(out);
  return out;
}

// potong pada batas kata, sisa dipotong paksa kalau tidak ada kata
function cutAtWord(s, limit) {
  const max = Math.max(1, Number(limit) || 1);
  const str = String(s || '');
  if (str.length <= max) return str;
  const slice = str.slice(0, max - 1);
  const sp = slice.lastIndexOf(' ');
  const cut = sp > Math.floor((max - 1) * 0.5) ? slice.slice(0, sp) : slice;
  return cut.replace(/\s+$/, '') + '…';
}

// ---------- internals ----------

function convert(text, opts) {
  const blocks = parseBlocks(normalize(text));
  const units = [];
  let hadTable = false;
  let summarized = false;
  for (const b of blocks) {
    if (b.type === 'table') {
      hadTable = true;
      const r = renderTable(b, opts);
      if (r.cut) summarized = true;
      if (r.text) units.push({ text: r.text, heading: false });
      continue;
    }
    if (b.type === 'code') {
      const r = renderCode(b, opts);
      if (r.cut) summarized = true;
      if (r.text) units.push({ text: r.text, heading: false });
      continue;
    }
    if (b.type === 'heading') {
      const label = renderInline(b.text);
      if (label) units.push({ text: '*' + label + '*', heading: true });
      continue;
    }
    if (b.type === 'list') {
      const lines = b.items.map(renderListItem).filter(Boolean);
      if (lines.length) units.push({ text: lines.join('\n'), heading: false });
      continue;
    }
    // paragraf: buang label meta, buang paragraf niat kerja
    if (META_INTENT.test(b.text)) continue;
    const kept = b.text.split('\n').filter((l) => !META_LABEL.test(l.trim()));
    const body = kept.join('\n').trim();
    if (!body) continue;
    units.push({ text: renderInline(body), heading: false });
  }
  return { units: mergeHeadings(units), hadTable, summarized };
}

function normalize(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\t/g, '    ');
}

function isTableRow(line) {
  return line.indexOf('|') !== -1 && (line.split('|').length - 1) >= 2;
}

function isSeparator(line) {
  return /^[|\s:\-]+$/.test(line) && line.indexOf('-') !== -1;
}

function isListLine(line) {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

// info code fence (pembuka/penutup) -> { lang } atau null
function fenceInfo(line) {
  const m = String(line).match(/^\s*`{3,}\s*([A-Za-z0-9_+-]*)\s*$/);
  return m ? { lang: m[1] || '' } : null;
}

// deteksi tipe blok di baris i (butuh lookahead untuk tabel)
function blockTypeAt(lines, i) {
  const line = lines[i];
  if (fenceInfo(line)) return 'code';
  if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) return 'table';
  if (/^\s*#{1,6}\s+/.test(line)) return 'heading';
  if (isListLine(line)) return 'list';
  return 'text';
}

function parseBlocks(src) {
  const lines = src.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const type = blockTypeAt(lines, i);
    if (type === 'code') {
      const fence = fenceInfo(lines[i]) || { lang: '' };
      const body = [];
      i++;
      while (i < lines.length && !/^\s*`{3,}\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang: fence.lang, lines: body });
      continue;
    }
    if (type === 'table') {
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i]) && !isSeparator(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (type === 'heading') {
      const h = lines[i].match(/^\s*#{1,6}\s+(.*)$/);
      blocks.push({ type: 'heading', text: (h ? h[1] : '').trim() });
      i++;
      continue;
    }
    if (type === 'list') {
      const items = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    // paragraf: berhenti saat baris kosong atau blok baru mulai
    const para = [];
    while (i < lines.length && lines[i].trim() && blockTypeAt(lines, i) === 'text') {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) blocks.push({ type: 'text', text: para.join('\n') });
  }
  return blocks;
}

function splitRow(line) {
  let s = String(line).trim();
  if (s.indexOf('|') === 0) s = s.slice(1);
  if (s.lastIndexOf('|') === s.length - 1) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function renderTable(b, opts) {
  const head = (b.header || []).map((h) => h.trim()).filter(Boolean);
  const rows = b.rows || [];
  const lines = [];
  if (head.length) lines.push('*' + head.map((h) => renderInline(h)).join(' · ') + '*');
  const limit = Math.max(1, Number(opts.tableRows) || DEFAULT_TABLE_ROWS);
  let shown = 0;
  for (const row of rows) {
    if (shown >= limit) break;
    const cells = row.map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    lines.push('• ' + cells.map((c) => renderInline(c)).join(' — '));
    shown++;
  }
  const rest = rows.length - shown;
  if (rest > 0) lines.push('_… ' + rest + ' baris lagi._');
  return { text: lines.join('\n'), cut: rest > 0 };
}

function renderCode(b, opts) {
  const body = b.lines || [];
  const limit = Math.max(3, Number(opts.codeLines) || DEFAULT_CODE_LINES);
  if (body.length > limit) {
    const lang = b.lang ? ' ' + b.lang : '';
    return { text: '_[kode' + lang + ' ' + body.length + ' baris diringkas]_', cut: true };
  }
  return { text: body.map((l) => escapeMd(l)).join('\n'), cut: false };
}

function renderListItem(raw) {
  const m = raw.match(/^(\d+)[.)]\s+(.*)$/);
  if (m) return m[1] + '. ' + renderInline(m[2]);
  return '• ' + renderInline(raw.replace(/^\s*(?:[-*+])\s+/, ''));
}

// teks inline -> markdown Telegram: tebal jadi *tebal*, tautan jadi teks (url)
function renderInline(text) {
  let s = String(text === undefined || text === null ? '' : text);
  s = s.replace(/`([^`\n]{1,200})`/g, '$1');
  s = s.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
  s = s.replace(/\*\*([^*\n]{1,300})\*\*/g, '@@B@@$1@@E@@');
  s = s.replace(/~~([^~\n]{1,300})~~/g, '$1');
  s = s.replace(/(^|[^\w*])\*([^*\n]{1,300})\*/g, '$1$2');
  s = s.replace(/(^|[^\w_])_([^_\n]{1,300})_/g, '$1$2');
  s = escapeMd(s);
  s = s.replace(/@@B@@([^@@]*)@@E@@/g, (m, t) => '*' + t + '*');
  return s;
}

// escape karakter khusus parse_mode Markdown Telegram
function escapeMd(s) {
  return String(s).replace(/([\\_*`\[])/g, '\\$1');
}

function mergeHeadings(units) {
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.heading && i + 1 < units.length) {
      out.push({ text: u.text + '\n' + units[i + 1].text, heading: false });
      i++;
      continue;
    }
    out.push(u);
  }
  return out;
}

// buang sisa markdown mentah yang mungkin bocor
function sanitize(s) {
  return String(s)
    .replace(/`{3,}/g, '')
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1')
    .replace(/\*\*/g, '*');
}
