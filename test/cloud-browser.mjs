// cloud-browser.mjs - uji relay frame + instruksi browser, OFFLINE (fixture tiruan).
// Tidak ada jaringan: Drive dipalsukan, unduhan frame dipalsukan, fs pakai
// folder sementara. Tidak ada token sungguhan yang dipakai/dicetak.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot-src');
const imp = (p) => import(pathToFileURL(p).href);

process.env.MINIMAX_DATA_DIR = path.join(os.tmpdir(), 'gibran-frame-data');
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'gibran-frame-'));

const { FrameCache } = await imp(ROOT + '/src/frame-cache.mjs');
const { FrameRelay, parseStatus, toMs } = await imp(ROOT + '/src/cloud-browser.mjs');

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}

// Jam palsu supaya TTL bisa diuji tanpa menunggu.
let clock = 1730000000000;
const now = () => clock;

// --- Fixture Drive -----------------------------------------------------
let frameBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
let statusJson = JSON.stringify({
  goal: 'cari lowongan frontend',
  url: 'https://jobs.test/list',
  step: 3,
  caption: 'Halaman daftar lowongan',
  updatedAt: '2026-11-28T14:00:00Z',
});
let nodes = [
  { name: 'frame_latest.png', category: 'images', mime_type: 'image/png', cdn_url: 'https://cdn.uji/frame_latest.png', updated_at: '2026-11-28T14:00:00.000Z' },
  { name: 'frame_status.json', category: 'files', mime_type: 'application/json', cdn_url: 'https://cdn.uji/frame_status.json', updated_at: '2026-11-28T14:00:00.000Z' },
];
const cloud = {
  calls: 0,
  async req({ path: p }) {
    this.calls++;
    if (p === '/minimax-cloud/api/v1/drive/file') return { total: nodes.length, nodes };
    throw new Error('path tak dikenal: ' + p);
  },
};
let fetchCalls = [];
const fakeFetch = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).endsWith('.json')) {
    return { ok: true, status: 200, text: async () => statusJson, arrayBuffer: async () => Uint8Array.from(Buffer.from(statusJson)).buffer };
  }
  return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(frameBytes).buffer };
};

console.log('=== A. FrameCache (fs di folder sementara) ===');
const cache = new FrameCache({ dir: path.join(TMP, 'frames'), now });
await fs.mkdir(path.join(TMP, 'frames'), { recursive: true });

const saved = await cache.putFrame('chat-1', frameBytes, { goal: 'cari lowongan frontend', url: 'https://jobs.test/list', step: 3, caption: 'Halaman daftar lowongan' });
check('CB1 putFrame menulis file jpg', saved.path.endsWith('.jpg') && saved.updatedAt === clock, saved.path);
const onDisk = await fs.readFile(saved.path);
check('CB2 isi file jpg sama dengan buffer', onDisk.length === frameBytes.length && onDisk.equals(frameBytes), onDisk.length + ' byte');

const got = await cache.getFrame('chat-1');
check('CB3 getFrame mengembalikan path+updatedAt+meta', !!got && got.path === saved.path && got.updatedAt === clock && !!got.meta, JSON.stringify(got && got.meta));
const meta = await cache.getMeta('chat-1');
check('CB4 getMeta membaca status', !!meta && meta.goal === 'cari lowongan frontend' && String(meta.step) === '3', JSON.stringify(meta));

check('CB5 frame baru tidak stale', (await cache.isStale('chat-1', 60000)) === false);
clock += 61000;
check('CB6 frame lama jadi stale setelah TTL', (await cache.isStale('chat-1', 60000)) === true);
check('CB7 chat tanpa frame dianggap stale', (await cache.isStale('chat- unexplisit', 60000)) === true);
clock -= 61000;

await cache.putStatus('chat-1', { caption: 'Diperbarui' });
const meta2 = await cache.getMeta('chat-1');
check('CB8 putStatus menggabungkan status lama', meta2.caption === 'Diperbarui' && meta2.goal === 'cari lowongan frontend', JSON.stringify(meta2));

const list = await cache.listFrames();
check('CB9 listFrames meringkas frame', list.length === 1 && list[0].chatId === 'chat-1' && list[0].bytes === frameBytes.length, JSON.stringify(list[0] && { chatId: list[0].chatId, bytes: list[0].bytes }));

console.log('');
console.log('=== B. FrameRelay (polling Drive + instruksi) ===');
const relay = new FrameRelay({
  cloud, cache, pollMs: 50, idleMs: 120000, fetchImpl: fakeFetch, now, log: () => {},
});

check('CB10 toMs membaca epoch ms dan ISO', toMs(1730000000000) === 1730000000000 && toMs('2026-11-28T14:00:00.000Z') === Date.parse('2026-11-28T14:00:00.000Z'));
check('CB11 parseStatus membaca JSON status', (parseStatus(statusJson) || {}).caption === 'Halaman daftar lowongan');

const started = await relay.start('chat-relay', 'token-uji-dummy');
check('CB12 start polling jalan', started.ok === true && relay.getState('chat-relay').running === true);

const frame1 = await relay.getFrame('chat-relay');
check('CB13 frame terdeteksi dari node frame_latest.png', !!frame1 && frame1.updatedAt === clock && frame1.path.endsWith('.jpg'), JSON.stringify(frame1));
const status1 = await relay.getStatus('chat-relay');
check('CB14 status terparse dari frame_status.json', !!status1 && status1.goal === 'cari lowongan frontend' && status1.url === 'https://jobs.test/list' && String(status1.step) === '3' && status1.caption === 'Halaman daftar lowongan', JSON.stringify(status1));
check('CB15 frame yang diunduh benar', (await fs.readFile(frame1.path)).equals(frameBytes));

// Frame baru: updated_at berubah -> relay harus mengambil ulang.
frameBytes = Buffer.from([137, 80, 78, 71, 9, 9, 9]);
statusJson = JSON.stringify({ goal: 'cari lowongan backend', url: 'https://jobs.test/backend', step: 7, caption: 'Filter backend', updatedAt: '2026-11-28T14:00:20Z' });
nodes = [
  { name: 'frame_latest.png', category: 'images', cdn_url: 'https://cdn.uji/frame_latest.png', updated_at: '2026-11-28T14:00:20.000Z' },
  { name: 'frame_status.json', category: 'files', cdn_url: 'https://cdn.uji/frame_status.json', updated_at: '2026-11-28T14:00:20.000Z' },
];
const poll2 = await relay.pollOnce('chat-relay');
check('CB16 frame baru terdeteksi via updated_at', poll2.newFrame === true && poll2.newStatus === true, JSON.stringify({ f: poll2.newFrame, s: poll2.newStatus }));
const frame2 = await relay.getFrame('chat-relay');
check('CB17 isi frame terupdate', (await fs.readFile(frame2.path)).equals(frameBytes), frame2.path);
const status2 = await relay.getStatus('chat-relay');
check('CB18 status terupdate', status2.caption === 'Filter backend' && String(status2.step) === '7', JSON.stringify(status2));

// updated_at sama -> tidak ada unduhan ulang.
const before = fetchCalls.length;
const poll3 = await relay.pollOnce('chat-relay');
check('CB19 node dengan updated_at sama tidak diunduh ulang', poll3.newFrame === false && fetchCalls.length === before, 'fetch ' + before + ' -> ' + fetchCalls.length);

console.log('');
console.log('=== C. sendInstruction (pesan Bahasa Indonesia) ===');
const cases = [
  [{ type: 'click', x: 512, y: 340 }, 'INSTRUKSI USER (live view): klik di x=512 y=340 pada viewport 1280x900'],
  [{ type: 'type', text: 'frontend dev' }, 'INSTRUKSI USER (live view): ketik teks: frontend dev'],
  [{ type: 'scroll', direction: 'down' }, 'INSTRUKSI USER (live view): scroll ke bawah'],
  [{ type: 'scroll', direction: 'up' }, 'INSTRUKSI USER (live view): scroll ke atas'],
  [{ type: 'back' }, 'INSTRUKSI USER (live view): kembali ke halaman sebelumnya'],
  [{ type: 'reload' }, 'INSTRUKSI USER (live view): muat ulang halaman'],
  [{ type: 'navigate', url: 'https://jobs.test/detail' }, 'INSTRUKSI USER (live view): buka url https://jobs.test/detail'],
  [{ type: 'text', text: 'cari lowongan senior frontend di Jakarta' }, 'INSTRUKSI USER (chat): cari lowongan senior frontend di Jakarta'],
];
let idx = 20;
for (const [action, expect] of cases) {
  const r = relay.sendInstruction('chat-relay', action);
  check('CB' + idx + ' pesan ' + action.type + ' tepat', r.ok === true && r.message === expect, r.message);
  idx++;
  relay.releaseManual('chat-relay');
}
const bad = relay.sendInstruction('chat-relay', { type: 'click' });
check('CB' + idx + ' klik tanpa koordinat ditolak', bad.ok === false && /koordinat/.test(bad.message), bad.message);
idx++;
const badType = relay.sendInstruction('chat-relay', { type: 'ngawur' });
check('CB' + idx + ' tipe asing ditolak', badType.ok === false, badType.message);
idx++;

console.log('');
console.log('=== D. Single-flight (user memegang kontrol) ===');
check('CB' + idx + ' belum ada instruksi manual -> tidak busy', relay.isManualBusy('chat-relay') === false);
idx++;
const one = relay.sendInstruction('chat-relay', { type: 'click', x: 10, y: 20 });
check('CB' + idx + ' instruksi manual terkirim', one.ok === true);
idx++;
check('CB' + idx + ' isManualBusy true setelah instruksi', relay.isManualBusy('chat-relay') === true);
idx++;
const two = relay.sendInstruction('chat-relay', { type: 'click', x: 30, y: 40 });
check('CB' + idx + ' instruksi kedua ditolak (single-flight)', two.ok === false, two.message);
idx++;
relay.releaseManual('chat-relay');
check('CB' + idx + ' isManualBusy false setelah releaseManual', relay.isManualBusy('chat-relay') === false);
idx++;

relay.stop('chat-relay');
check('CB' + idx + ' stop menghentikan polling', relay.getState('chat-relay').running === false);
idx++;

await fs.rm(TMP, { recursive: true, force: true });
console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
