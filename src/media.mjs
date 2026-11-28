// Helper media: unduh buffer dari URL, tebak nama file, pilih jenis kiriman.
// Hanya pakai modul bawaan Node, tanpa dependensi.

export const MAX_BYTES = 10 * 1024 * 1024;

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

// unduh file jadi buffer, batasi 10 MB
export async function unduhBuffer(url, opts) {
  const o = opts || {};
  const limit = Number(o.maxBytes || MAX_BYTES);
  const res = await fetch(String(url), { redirect: 'follow' });
  if (!res.ok) throw new Error('gagal unduh media: HTTP ' + res.status);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > limit) throw new Error('media terlalu besar: ' + declared + ' byte');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('media terlalu besar: ' + buf.length + ' byte');
  return buf;
}

// tebak nama file dari URL, lengkapi ekstensi dari mime
export function guessFilename(url, mime, base) {
  const fallback = String(base || 'file');
  let name = '';
  try {
    const u = new URL(String(url || ''));
    name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    name = String(url || '').split('/').filter(Boolean).pop() || '';
  }
  name = name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+/, '').slice(0, 120);
  const ext = MIME_EXT[String(mime || '').toLowerCase().split(';')[0].trim()] || '';
  if (!name) return fallback + ext;
  if (/\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
  return name + ext;
}

// mime gambar -> dikirim sebagai foto, sisanya dokumen
export function pickMediaKind(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (/^image\/(jpeg|jpg|png|webp|gif)$/.test(m)) return 'photo';
  return 'document';
}

// tebak mime dari magic bytes (kalau header server tidak ada)
export function sniffMime(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 6 && (b.slice(0, 6).toString('latin1') === 'GIF89a' || b.slice(0, 6).toString('latin1') === 'GIF87a')) return 'image/gif';
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return '';
}

// tebak mime dari ekstensi URL
export function mimeFromUrl(url) {
  let path = '';
  try {
    path = new URL(String(url || '')).pathname;
  } catch {
    path = String(url || '');
  }
  const ext = (path.match(/\.([A-Za-z0-9]{1,8})$/) || ['', ''])[1].toLowerCase();
  const found = Object.keys(MIME_EXT).find((k) => MIME_EXT[k] === '.' + ext);
  return found || '';
}
