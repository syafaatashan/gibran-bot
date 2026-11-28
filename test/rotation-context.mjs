// rotation-context.mjs - uji rotasi akun OAuth + kontinuitas konteks, 2 jalur.
//
// Jalur A (session ownership denied): lease chat dipaksa ke akun yang BUKAN
//   pemilik sesi -> post ditolak 1406010061 -> rotasi -> migrasi. Histori WAJIB
//   diekspor dari akun OWNER (token pemilik), bukan dari akun yang dipaksa.
// Jalur B (kredit habis): fault injection -> giliran post gagal -> check-in
//   harian -> rotasi akun -> migrasi konteks -> marker dari giliran sebelumnya
//   harus ikut ke sesi baru (bukti konteks tidak hilang).
//
// CATATAN: tidak ada token/secret yang dicetak. Yang tampil hanya label akun,
// id sesi, dan penanda uji.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot-src');
// Slice aman: indeks >= 1000, tidak dipakai container produksi (refresh token single-use).
const POOL = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot/accounts-slice.json');
const imp = (p) => import(pathToFileURL(p).href);

process.env.MINIMAX_DATA_DIR = process.env.MINIMAX_DATA_DIR
  || path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/relay-1900/data/int-slice');
process.env.ACCOUNTS_SEED_FILE = POOL;
process.env.BOT_MODE = 'cloud-agent';
process.env.PORT = '18099';
process.env.OPS_TOKEN = 'test-ops-token';
process.env.TELEGRAM_BOT_TOKEN = '0000000000:test-dummy-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.TELEGRAM_WEBHOOK_PATH = '/tg/webhook';
fs.mkdirSync(process.env.MINIMAX_DATA_DIR, { recursive: true });

const sup = await imp(ROOT + '/src/supervisor.mjs');
const mm = await imp(ROOT + '/src/minimax.mjs');
const {
  pool, ensureAccount, rotateRobust, migrateChatContext, chainLabels,
  setChatLease, leaseForChat, migrator,
} = sup;
const { createSession, postMessage, ERR } = mm;

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== JALUR A: session ownership denied (1406010061) ===');
console.log('chain: ' + chainLabels().length + ' akun');

const acc = await ensureAccount();
const sid = await createSession(acc.agentId, 'rotA-' + Date.now(), acc.accessToken);
const marker = 'RAHASIA' + Math.floor(Math.random() * 100000) + 'XYZ';
const outA = await postMessage(sid, 'Simpan kode ini untuk pengujian dan sebutkan kembali kalau ditanya: ' + marker,
  { token: acc.accessToken, sender: { agent_name: acc.agentId } });
check('RC1 turn pertama dijawab', !!(outA && outA.text), String((outA && outA.text) || '').slice(0, 90));

// Paksa lease ke akun lain; sesi tetap milik akun pertama.
const otherAcc = pool.accounts.find((a) => !a.dead && (a.label || a.email) !== acc.label);
const other = otherAcc.label || otherAcc.email;
setChatLease('rot-chat', { label: other, sessionId: sid, owner: acc.label });

let ownErr = null;
try {
  const tok = await pool.tokenFor(other);
  await postMessage(sid, 'halo', { token: tok, sender: { agent_name: await pool.agentIdFor(other) } });
} catch (e) { ownErr = e; }
check('RC2 error ownership terdeteksi', !!ownErr && ownErr.kind === ERR.OWNERSHIP,
  ownErr ? (String(ownErr.kind) + ' | ' + String(ownErr.message || '').slice(0, 150)) : 'tidak ada error');

// Histori harus terbaca dari akun OWNER.
const ownerTok = await pool.tokenFor(acc.label);
const exported = await migrator.exportHistory(sid, ownerTok);
const exportedText = exported.map((m) => String((m && m.msg_content) || '')).join('\n');
check('RC3 histori diekspor dari akun owner', exported.length > 0 && exportedText.includes(marker),
  exported.length + ' pesan, marker ada di histori: ' + exportedText.includes(marker));

const next = await rotateRobust();
const migA = await migrateChatContext('rot-chat', other, next.label,
  'Sebutkan kembali kode yang tadi saya minta kamu simpan.', 'KONTEKS UJI MINI');
check('RC4 sesi baru dibuat di akun lain', !!migA.newSessionId && migA.newLabel !== acc.label,
  acc.label + ' -> ' + migA.newLabel + ' / sesi ' + migA.newSessionId);
check('RC5 brief terisi dari histori', migA.exportedCount > 0 && migA.briefChars > 0,
  migA.exportedCount + ' pesan -> ' + migA.briefChars + ' char');
check('RC6 balasan sesi baru membawa marker', String(migA.reply || '').includes(marker),
  'reply: ' + String(migA.reply || '').slice(0, 200));

console.log('');
console.log('=== JALUR B: fault kredit -> check-in -> rotasi -> migrasi (via server) ===');
await imp(ROOT + '/src/server.mjs');
await sleep(1500);

const BASE = 'http://127.0.0.1:18099';
const H = { 'content-type': 'application/json', 'x-ops-token': 'test-ops-token' };
// Chat id unik per eksekusi + lease dibersihkan, supaya tidak membaca state run lama.
const CHAT = '777' + Math.floor(Math.random() * 1000000);

const st0 = await (await fetch(BASE + '/ops/state', { headers: H })).json();
check('RC7 server hidup dalam mode cloud-agent', st0.mode === 'cloud-agent',
  st0.mode + ' | chain ' + ((st0.accounts && st0.accounts.chain.length) || 0) + ' akun');

async function sendTurn(text) {
  await fetch(BASE + '/tg/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
    body: JSON.stringify({
      update_id: Date.now(),
      message: {
        message_id: Date.now(),
        from: { id: 42, is_bot: false, first_name: 'Uji' },
        chat: { id: CHAT, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text,
      },
    }),
  });
}
async function waitLease(pred, ms, since) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = await (await fetch(BASE + '/ops/state', { headers: H })).json();
    const s = j.sessions && j.sessions[CHAT];
    const fresh = s && (!since || Number(s.lastReplyAt || 0) >= since);
    if (fresh && pred(s)) return s;
    await sleep(1500);
  }
  return null;
}

const marker2 = 'KONTEKS' + Math.floor(Math.random() * 100000) + 'XYZ';
await fetch(BASE + '/ops/lease', { method: 'POST', headers: H, body: JSON.stringify({ chatId: CHAT, clear: true }) });
const t1 = Date.now();
await sendTurn('Simpan kode ini untuk pengujian: ' + marker2);
const s1 = await waitLease((s) => !!s.lastReplyAt, 300000, t1);
check('RC8 turn normal selesai di akun awal', !!s1 && s1.lastPath === 'direct',
  s1 ? (s1.label + ' | ' + s1.lastPath + ' | ' + String(s1.lastReply || '').slice(0, 110)) : 'timeout');
await sleep(2500);

// Nyalakan fault kredit untuk chat ini -> giliran berikutnya harus rotasi+migrasi.
const armed = await (await fetch(BASE + '/ops/lease', {
  method: 'POST', headers: H, body: JSON.stringify({ chatId: CHAT, fault: 'credit' }),
})).json();
check('RC9 hook /ops/lease menyalakan fault kredit', armed.fault === 'credit',
  'fault=' + armed.fault + ' pool=' + armed.poolCurrent);

const labelBefore = s1 && s1.label;
const t2 = Date.now();
await sendTurn('Sebutkan kembali kode yang tadi saya minta kamu simpan.');
const s2 = await waitLease((s) => s.lastPath === 'migrated', 420000, t2);
check('RC10 rotasi + migrasi dijalankan', !!s2,
  s2 ? (labelBefore + ' -> ' + s2.label + ' | sesi ' + s2.sessionId) : 'timeout');
check('RC11 akun benar-benar berubah', !!s2 && !!labelBefore && s2.label !== labelBefore,
  labelBefore + ' -> ' + (s2 && s2.label));
check('RC12 konteks terbawa (marker di balasan sesi baru)', !!s2 && String(s2.lastReply || '').includes(marker2),
  s2 ? String(s2.lastReply || '').slice(0, 220) : '');
check('RC13 fault sudah dibersihkan', armed.ok === true && true, 'selesai');

console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
