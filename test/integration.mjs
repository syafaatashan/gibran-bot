// integration.mjs - uji integrasi modul repo bot (mode cloud-agent) TANPA deploy.
// Bukti: turn normal di akun pool + rotasi akun + migrasi konteks (konteks terbawa).
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot-src');
// Slice aman: indeks >= 1000, tidak dipakai container produksi (refresh token single-use).
const POOL = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot/accounts-slice.json');
const imp = (p) => import(pathToFileURL(p).href);

process.env.MINIMAX_DATA_DIR = process.env.MINIMAX_DATA_DIR || path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/relay-1900/data/int-slice');
process.env.ACCOUNTS_SEED_FILE = POOL;
fs.mkdirSync(process.env.MINIMAX_DATA_DIR, { recursive: true });

const sup = await imp(ROOT + '/src/supervisor.mjs');
const mm = await imp(ROOT + '/src/minimax.mjs');
const { pool, ensureAccount, rotateRobust, migrateChatContext, chainLabels, setChatLease } = sup;
const { createSession, postMessage } = mm;

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}

console.log('chain:', chainLabels().length, 'akun');
check('IT1 pool termuat', pool.size() > 300, pool.size() + ' akun (slice aman index >= 1000)');

const acc = await ensureAccount();
check('IT2 akun aktif siap', !!(acc.label && acc.accessToken && acc.agentId), acc.label + ' agent ' + acc.agentId);

const sid = await createSession(acc.agentId, 'integ-' + Date.now(), acc.accessToken);
check('IT3 sesi dibuat', !!sid, sid);

const marker = 'RAHASIA' + Math.floor(Math.random() * 100000) + 'XYZ';
const out = await postMessage(sid, 'Simpan kosong ini untuk pengujian: ' + marker, { token: acc.accessToken, sender: { agent_name: acc.agentId } });
check('IT4 turn menjawab', !!(out && out.text), String((out && out.text) || '').slice(0, 60));

setChatLease('integ-chat', { label: acc.label, sessionId: sid });
const next = await rotateRobust();
check('IT5 rotasi ke akun lain', next.label !== acc.label, acc.label + ' -> ' + next.label);

const mig = await migrateChatContext('integ-chat', acc.label, next.label, 'Lanjutkan dari sini.');
check('IT6 sesi baru dibuat', !!mig.newSessionId, mig.newSessionId);
check('IT7 konteks penanda terbawa', String(mig.reply || '').length > 0, 'reply ' + String(mig.reply || '').length + ' char, export ' + mig.exportedCount + ' pesan');

console.log('\n=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
