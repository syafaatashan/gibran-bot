// src/cloud-files.mjs - bridge file/gambar MiniMax Cloud Drive -> Telegram.
//
// Zero dependency. Semua request lewat klien MiniMaxCloud yang sudah ada
// (src/minimax.mjs) supaya penandaan x-timestamp/x-signature tidak ditulis ulang.
// ATURAN: token/secret TIDAK PERNAH dicetak; pesan error hanya menyebut nama file.
import { cloud as sharedCloud } from './minimax.mjs'

// Endpoint drive (req() menambah query client=desktop dengan sendirinya).
export const DRIVE_PATH = '/minimax-cloud/api/v1/drive/file';

// Nama file internal bot: dipakai untuk live view, tidak dikirim ke user.
export const INTERNAL_FILES = Object.freeze(['frame_latest.png', 'frame_status.json']);

// Mime yang boleh dikirim ke user.
export const SENDABLE_MIME = Object.freeze([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'text/csv', 'text/markdown', 'application/pdf',
]);

// Alias mime -> mime baku.
const MIME_ALIAS = Object.freeze({
  'image/jpg': 'image/jpeg',
  'text/x-markdown': 'text/markdown',
  'application/markdown': 'text/markdown',
  'text/x-csv': 'text/csv',
});

// Batas unduhan default (biar file raksasa tidak meledakkan memori).
const MAX_BYTES = 32 * 1024 * 1024;

// Ubah waktu drive (detik/milidetik/string ISO) ke milidetik.
export function toMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    // < 1e11 = detik, >= 1e11 = milidetik.
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return 0;
    if (/^-?\d+(\.\d+)?$/.test(s)) return toMs(Number(s));
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// Ambil basename URL tanpa query (query bisa berisi token bertanda tangan).
function urlName(url) {
  const s = String(url || '').split('#')[0].split('?')[0];
  const parts = s.split('/').filter(Boolean);
  return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
}

// Host URL untuk deciding apakah header Authorization aman dipasang.
function hostOf(url) {
  try { return new URL(String(url)).host.toLowerCase(); } catch { return ''; }
}

// Normalisasi mime: lowercase, buang parameter charset, terapkan alias.
export function normalizeMime(value) {
  const raw = String(value || '').trim().toLowerCase().split(';')[0].trim();
  return MIME_ALIAS[raw] || raw;
}

// Ubah satu node mentah (snake_case) menjadi node ternormalisasi (camelCase).
export function normalizeNode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cdnUrl = String(raw.cdn_url ?? raw.cdnUrl ?? raw.url ?? raw.download_url ?? '').trim();
  const thumbUrl = String(raw.thumbnail_url ?? raw.thumbUrl ?? raw.thumbnail ?? raw.preview_url ?? '').trim();
  const name = String(raw.name ?? raw.file_name ?? raw.fileName ?? raw.title ?? urlName(cdnUrl) ?? '').trim();
  const sizeRaw = raw.size ?? raw.file_size ?? raw.fileSize ?? raw.size_bytes ?? raw.bytes ?? 0;
  const size = Number(sizeRaw) || 0;
  return {
    id: String(raw.id ?? raw.node_id ?? raw.nodeId ?? ''),
    name,
    mime: normalizeMime(raw.mime_type ?? raw.mimeType ?? raw.mime ?? raw.content_type),
    category: String(raw.category ?? raw.type ?? '').trim().toLowerCase(),
    cdnUrl,
    thumbUrl,
    updatedAt: toMs(raw.updated_at ?? raw.updatedAt ?? raw.modified_at ?? raw.modifiedAt ?? raw.create_time),
    size,
    source: String(raw.source ?? ''),
    isDeployedSite: !!(raw.is_deployed_site ?? raw.isDeployedSite),
  };
}

// Normalisasi seluruh daftar node mentah; buang yang tidak valid.
export function normalizeNodes(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const raw of arr) {
    const n = normalizeNode(raw);
    if (n && n.name) out.push(n);
  }
  return out;
}

// Ambil array node dari berbagai bentuk balasan drive.
function nodesFrom(json) {
  const arr = json?.nodes ?? json?.data?.nodes ?? json?.files ?? json?.data?.files ?? json?.data ?? [];
  return Array.isArray(arr) ? arr : [];
}

// Daftar file drive yang sudah dinormalisasi.
// sinceMs > 0 -> hanya node yang lebih baru dari batas waktu (node tanpa waktu tetap dipakai).
export async function listDrive({ token, sinceMs = 0, cloud = sharedCloud, keepOld = false } = {}) {
  const json = await cloud.req({ method: 'GET', path: DRIVE_PATH, token });
  let nodes = normalizeNodes(nodesFrom(json));
  nodes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const since = Number(sinceMs) || 0;
  if (since > 0 && !keepOld) {
    nodes = nodes.filter((n) => !n.updatedAt || n.updatedAt > since);
  }
  return nodes;
}

// Unduh file dari URL drive -> Buffer. Isi file tidak pernah dicetak.
export async function downloadFile(url, token, opts = {}) {
  const target = String(url || '').trim();
  if (!target) throw new Error('downloadFile: URL kosong');
  const timeoutMs = Number(opts.timeoutMs) || 60000;
  const maxBytes = Number(opts.maxBytes) || MAX_BYTES;
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const headers = {};
  // Token hanya dikirim ke host MiniMax; CDN publik tidak boleh slowed.
  if (token && hostOf(target).includes('minimax')) headers.Authorization = 'Bearer ' + token;
  const res = await doFetch(target, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error('downloadFile HTTP ' + res.status + ' untuk ' + urlName(target));
  }
  const declared = Number(res.headers?.get?.('content-length') || 0);
  if (declared && declared > maxBytes) {
    throw new Error('downloadFile: file terlalu besar untuk ' + urlName(target) + ' (' + declared + ' bytes)');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error('downloadFile: file terlalu besar untuk ' + urlName(target) + ' (' + buf.length + ' bytes)');
  }
  return buf;
}

// Kunci 'nama|updatedAt' untuk daftar 'sudah dikirim'.
export function seenKey(node) {
  const n = typeof node === 'string' ? node : (node && node.name) || '';
  const ts = typeof node === 'string' ? 0 : toMs(node && node.updatedAt);
  return String(n) + '|' + ts;
}

// Node yang belum pernah dikirim: nama tak ada di seen, atau updated_at lebih baru.
export function pickNewNodes(nodes, seen, opts = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const seenList = Array.isArray(seen) ? seen : [];
  // seen berisi 'nama|updatedAt' -> peta nama ke waktu terakhir yang terkirim.
  const lastSeen = new Map();
  for (const entry of seenList) {
    const raw = typeof entry === 'string'
      ? entry
      : String((entry && (entry.key || (entry.name + '|' + toMs(entry.updatedAt)))) || '');
    if (!raw) continue;
    const cut = raw.lastIndexOf('|');
    const name = cut >= 0 ? raw.slice(0, cut) : raw;
    const ts = cut >= 0 ? toMs(raw.slice(cut + 1)) : 0;
    if (ts > (lastSeen.get(name) || 0)) lastSeen.set(name, ts);
  }
  const since = Number(opts.sinceMs) || 0;
  const out = [];
  for (const n of list) {
    if (!n || !n.name) continue;
    const last = lastSeen.get(n.name);
    const neverSeen = last === undefined;
    const changed = !neverSeen && toMs(n.updatedAt) > last;
    const fresh = since > 0 && toMs(n.updatedAt) > since;
    if (neverSeen || changed || fresh) out.push(n);
  }
  out.sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  return out;
}

// Frame terbaru untuk live view: 'frame_latest.png' dulu, lalu gambar terbaru.
export function pickFrame(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.cdnUrl);
  const exact = list.find((n) => String(n.name || '').toLowerCase() === 'frame_latest.png');
  if (exact) return exact;
  let images = list.filter((n) => String(n.category || '').toLowerCase() === 'images');
  if (!images.length) images = list.filter((n) => String(n.mime || '').startsWith('image/'));
  if (!images.length) return null;
  return images.reduce((best, n) => (toMs(n.updatedAt) > toMs(best.updatedAt) ? n : best), images[0]);
}

// File yang layak dikirim ke user (gambar/csv/md/pdf), tanpa file internal.
export function sendableFiles(nodes, opts = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const blocked = new Set(INTERNAL_FILES.map((n) => n.toLowerCase()));
  for (const extra of (opts.exclude || [])) blocked.add(String(extra).toLowerCase());
  const allow = opts.include ? new Set((opts.include || []).map((m) => normalizeMime(m))) : null;
  const max = Number(opts.max) || 0;
  const out = [];
  for (const n of list) {
    if (!n || !n.name || !n.cdnUrl) continue;
    if (n.isDeployedSite) continue;
    if (blocked.has(String(n.name).toLowerCase())) continue;
    const mime = normalizeMime(n.mime);
    if (allow) {
      if (!allow.has(mime)) continue;
    } else if (!SENDABLE_MIME.includes(mime)) {
      continue;
    }
    out.push(n);
  }
  out.sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  return max > 0 ? out.slice(0, max) : out;
}

// Deteksi signature PNG / JPEG pada buffer.
export function imageMime(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

// True kalau byte benar-benar gambar.
export function isImageBuffer(buf) {
  return !!imageMime(buf);
}

// Unduh cdn_url (BUKAN thumbnail_url) sebagai Buffer gambar.
export async function imageBytes(node, token, opts = {}) {
  if (!node) throw new Error('imageBytes: node kosong');
  const url = node.cdnUrl || node.url || '';
  if (!url) throw new Error('imageBytes: node tanpa cdn_url (' + String(node.name || '?') + ')');
  const buf = await downloadFile(url, token, opts);
  if (!isImageBuffer(buf)) {
    throw new Error('imageBytes: byte bukan gambar (' + String(node.name || '?') + ', ' + buf.length + ' bytes)');
  }
  return buf;
}

// Ambil frame terbaru + byte gambarnya (untuk live view browser).
export async function fetchFrame(nodes, token, opts = {}) {
  const node = pickFrame(nodes);
  if (!node) return null;
  const bytes = await imageBytes(node, token, opts);
  return { name: node.name, mime: imageMime(bytes), bytes, updatedAt: node.updatedAt };
}

// Ringkasan daftar file tanpa membocorkan URL bertanda tangan.
export function describeNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((n) => ({
    name: n.name, mime: n.mime, category: n.category, size: n.size, updatedAt: n.updatedAt,
  }));
}

export default {
  listDrive, downloadFile, pickNewNodes, pickFrame, sendableFiles, imageBytes, fetchFrame,
  normalizeNode, normalizeNodes, imageMime, isImageBuffer, seenKey, toMs, describeNodes,
  INTERNAL_FILES, SENDABLE_MIME, DRIVE_PATH,
};
