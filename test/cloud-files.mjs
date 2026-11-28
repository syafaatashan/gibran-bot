// test/cloud-files.mjs - uji bridge drive -> Telegram (OFFLINE, tanpa jaringan).
//
// Semua data memakai fixture tiruan: tidak ada token/secret yang dicetak,
// tidak ada panggilan jaringan. Uji jaringan opsional hanya jalan bila
// env CLOUDFILES_LIVE=1 dan MM_ACCESS_TOKEN tersedia.
import assert from 'node:assert/strict';

import {
  listDrive, downloadFile, pickNewNodes, pickFrame, sendableFiles, imageBytes,
  normalizeNode, normalizeNodes, imageMime, isImageBuffer, seenKey,
  INTERNAL_FILES, SENDABLE_MIME,
} from '../src/cloud-files.mjs';

let pass = 0; let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log('PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name + ' - ' + String((e && e.message) || e).slice(0, 200));
  }
}

// --- Fixture mentah: bentuk asli balasan drive (snake_case) ---
const T0 = 1764300000; // detik
const RAW_NODES = [
  {
    category: 'images',
    mime_type: 'image/png',
    cdn_url: 'https://cdn-wf-api.minimax.io/d/linkedin_home.png?sign=abc',
    thumbnail_url: 'https://cdn-wf-api.minimax.io/d/thumb/linkedin_home.png',
    updated_at: T0,
    name: 'linkedin_home.png',
    size: 20480,
    source: 'upload',
  },
  {
    category: 'images',
    mime_type: 'image/png',
    cdn_url: 'https://cdn-wf-api.minimax.io/d/frame_latest.png?sign=abc',
    thumbnail_url: 'https://cdn-wf-api.minimax.io/d/thumb/frame_latest.png',
    updated_at: T0 + 100,
    name: 'frame_latest.png',
  },
  {
    category: 'files',
    mime_type: 'text/csv',
    cdn_url: 'https://cdn-wf-api.minimax.io/d/Job_Listings.csv?sign=abc',
    updated_at: (T0 + 200) * 1000, // milidetik
    name: 'Job_Listings.csv',
    file_size: 4096,
  },
  {
    category: 'files',
    mime_type: 'application/json',
    cdn_url: 'https://cdn-wf-api.minimax.io/d/frame_status.json?sign=abc',
    updated_at: T0 + 300,
    name: 'frame_status.json',
  },
  {
    category: 'files',
    mime_type: 'application/zip',
    cdn_url: 'https://cdn-wf-api.minimax.io/d/bundle.zip?sign=abc',
    updated_at: T0 + 400,
    name: 'bundle.zip',
  },
  {
    category: 'website',
    mime_type: 'text/html',
    cdn_url: 'https://site.minimax.io/demo/',
    updated_at: T0 + 500,
    name: 'demo-site',
    is_deployed_site: true,
  },
];

const fakeCloud = { req: async () => ({ total: RAW_NODES.length, nodes: RAW_NODES }) };

// Klien HTTP palsu: mencatat URL yang diminta dan mengembalikan buffer.
function fakeFetch(bytes, log) {
  return async (url) => {
    if (log) log.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const TEXT_BYTES = Buffer.from('ini bukan gambar, cuma teks');

console.log('=== 1. Normalisasi node drive ===');
await check('CF01 field snake_case -> camelCase', () => {
  const n = normalizeNode(RAW_NODES[0]);
  assert.equal(n.name, 'linkedin_home.png');
  assert.equal(n.mime, 'image/png');
  assert.equal(n.category, 'images');
  assert.ok(n.cdnUrl.startsWith('https://cdn-wf-api.minimax.io/d/linkedin_home.png'));
  assert.ok(n.thumbUrl.includes('/thumb/linkedin_home.png'));
  assert.equal(n.size, 20480);
  assert.equal(n.updatedAt, T0 * 1000, 'detik harus jadi milidetik');
});

await check('CF02 size dari file_size dan waktu milidetik', () => {
  const n = normalizeNode(RAW_NODES[2]);
  assert.equal(n.size, 4096);
  assert.equal(n.updatedAt, (T0 + 200) * 1000);
});

await check('CF03 node rusak diabaikan', () => {
  assert.equal(normalizeNode(null), null);
  assert.equal(normalizeNodes([null, undefined, 5]).length, 0);
});

await check('CF04 mime dinormalisasi (alias + parameter)', () => {
  assert.equal(normalizeNode({ mime_type: 'IMAGE/JPG' }).mime, 'image/jpeg');
  assert.equal(normalizeNode({ mime_type: 'text/csv; charset=utf-8' }).mime, 'text/csv');
  assert.equal(normalizeNode({ mime_type: 'text/x-markdown' }).mime, 'text/markdown');
});

console.log('');
console.log('=== 2. listDrive ===');
await check('CF05 listDrive mengembalikan node ternormalisasi terurut', async () => {
  const nodes = await listDrive({ token: 'token-uji', cloud: fakeCloud });
  assert.equal(nodes.length, RAW_NODES.length);
  assert.equal(nodes[0].name, 'demo-site', 'terbaru di atas');
  assert.equal(nodes[0].updatedAt, (T0 + 500) * 1000);
});

console.log('');
console.log('=== 3. pickNewNodes ===');
const NODES = normalizeNodes(RAW_NODES);
const byName = (n) => NODES.find((x) => x.name === n);

await check('CF06 node baru (nama belum pernah seen) dipilih', () => {
  const fresh = pickNewNodes(NODES, []);
  assert.equal(fresh.length, NODES.length, 'semua node baru');
  assert.ok(fresh.some((n) => n.name === 'linkedin_home.png'));
});

await check('CF07 node lama yang sudah seen diabaikan', () => {
  const seen = ['linkedin_home.png|' + T0 * 1000, 'bundle.zip|' + (T0 + 400) * 1000];
  const fresh = pickNewNodes(NODES, seen);
  assert.ok(!fresh.some((n) => n.name === 'linkedin_home.png'), 'updated_at sama -> bukan baru');
  assert.ok(!fresh.some((n) => n.name === 'bundle.zip'));
  assert.ok(fresh.some((n) => n.name === 'Job_Listings.csv'));
});

await check('CF08 file yang berubah (updated_at lebih baru) dipilih lagi', () => {
  const seen = ['linkedin_home.png|' + T0 * 1000];
  const changed = NODES.map((n) => (n.name === 'linkedin_home.png' ? Object.assign({}, n, { updatedAt: (T0 + 999) * 1000 }) : n));
  const fresh = pickNewNodes(changed, seen);
  assert.ok(fresh.some((n) => n.name === 'linkedin_home.png'));
});

await check('CF09 sinceMs menyaring node lama yang sudah seen', () => {
  const seen = ['linkedin_home.png|' + T0 * 1000];
  const fresh = pickNewNodes(NODES, seen, { sinceMs: (T0 + 300) * 1000 });
  assert.ok(!fresh.some((n) => n.name === 'linkedin_home.png'), 'sudah seen + tidak lebih baru');
  assert.ok(fresh.some((n) => n.name === 'demo-site'), 'lebih baru dari sinceMs');
});

await check('CF09b nama belum pernah seen tetap lolos meski tua', () => {
  // Kontrak: (updated_at > sinceMs) ATAU (nama belum pernah di seen).
  const fresh = pickNewNodes(NODES, [], { sinceMs: (T0 + 300) * 1000 });
  assert.ok(fresh.some((n) => n.name === 'linkedin_home.png'), 'nama baru = baru');
});

await check('CF10 seenKey membentuk nama|updatedAt', () => {
  assert.equal(seenKey(byName('linkedin_home.png')), 'linkedin_home.png|' + T0 * 1000);
});

console.log('');
console.log('=== 4. pickFrame ===');
await check('CF11 frame_latest.png diprioritaskan walau bukan gambar terbaru', () => {
  const f = pickFrame(NODES);
  assert.equal(f.name, 'frame_latest.png');
});

await check('CF12 tanpa frame_latest.png -> gambar terbaru', () => {
  const tanpa = NODES.filter((n) => n.name !== 'frame_latest.png');
  const f = pickFrame(tanpa);
  assert.equal(f.category, 'images');
  assert.equal(f.name, 'linkedin_home.png', 'updated_at paling baru di kategori images');
});

await check('CF13 tidak ada gambar -> null', () => {
  assert.equal(pickFrame([]), null);
  assert.equal(pickFrame(normalizeNodes([RAW_NODES[3]])), null);
});

console.log('');
console.log('=== 5. sendableFiles ===');
await check('CF14 file internal tidak ikut dikirim', () => {
  const out = sendableFiles(NODES);
  const names = out.map((n) => n.name);
  assert.ok(!names.includes('frame_latest.png'));
  assert.ok(!names.includes('frame_status.json'));
  assert.ok(INTERNAL_FILES.includes('frame_latest.png'));
});

await check('CF15 mime aneh/site tidak ikut dikirim', () => {
  const out = sendableFiles(NODES);
  const names = out.map((n) => n.name);
  assert.ok(!names.includes('bundle.zip'), 'application/zip bukan layan');
  assert.ok(!names.includes('demo-site'), 'situs terdeploy bukan file');
});

await check('CF16 gambar + csv tetap dikirim', () => {
  const out = sendableFiles(NODES);
  const names = out.map((n) => n.name);
  assert.ok(names.includes('linkedin_home.png'));
  assert.ok(names.includes('Job_Listings.csv'));
  assert.ok(out.every((n) => SENDABLE_MIME.includes(n.mime)));
});

await check('CF17 opsi exclude dan max respected', () => {
  const out = sendableFiles(NODES, { exclude: ['linkedin_home.png'], max: 1 });
  assert.equal(out.length, 1);
  assert.ok(!out.some((n) => n.name === 'linkedin_home.png'));
});

console.log('');
console.log('=== 6. downloadFile & imageBytes ===');
await check('CF18 downloadFile mengembalikan Buffer', async () => {
  const log = [];
  const buf = await downloadFile('https://cdn-wf-api.minimax.io/d/Job_Listings.csv?sign=abc', 'token-uji',
    { fetchImpl: fakeFetch(TEXT_BYTES, log) });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.length, TEXT_BYTES.length);
  assert.equal(log.length, 1);
});

await check('CF19 imageBytes memakai cdn_url, bukan thumbnail_url', async () => {
  const log = [];
  const node = byName('linkedin_home.png');
  const buf = await imageBytes(node, 'token-uji', { fetchImpl: fakeFetch(PNG_BYTES, log) });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('/d/linkedin_home.png'), 'harus cdn_url');
  assert.ok(!log[0].includes('/thumb/'), 'tidak boleh thumbnail_url');
});

await check('CF20 imageBytes menolak byte bukan gambar', async () => {
  const node = byName('linkedin_home.png');
  await assert.rejects(
    () => imageBytes(node, 'token-uji', { fetchImpl: fakeFetch(TEXT_BYTES, []) }),
    /bukan gambar/,
  );
});

await check('CF21 signature PNG dan JPEG dikenali', () => {
  assert.equal(imageMime(PNG_BYTES), 'image/png');
  assert.equal(imageMime(JPEG_BYTES), 'image/jpeg');
  assert.equal(imageMime(TEXT_BYTES), null);
  assert.equal(isImageBuffer(PNG_BYTES), true);
  assert.equal(isImageBuffer(Buffer.alloc(0)), false);
});

await check('CF22 node tanpa cdn_url ditolak dengan pesan aman', async () => {
  await assert.rejects(() => imageBytes({ name: 'x.png' }, 'token-uji'), /tanpa cdn_url/);
});

console.log('');
console.log('=== 7. Uji jaringan opsional (default dilewati) ===');
if (process.env.CLOUDFILES_LIVE === '1' && process.env.MM_ACCESS_TOKEN) {
  try {
    const live = await listDrive({ token: process.env.MM_ACCESS_TOKEN });
    await check('CF23 listDrive live', () => {
      assert.ok(Array.isArray(live));
      console.log('      node drive: ' + live.length + ' | contoh: ' + live.slice(0, 3).map((n) => n.name).join(', '));
    });
  } catch (e) {
    console.log('SKIP  CF23 listDrive live gagal: ' + String((e && e.message) || e).slice(0, 120));
  }
} else {
  console.log('SKIP  CF23 listDrive live (set CLOUDFILES_LIVE=1 untuk mengaktifkan)');
}

console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
