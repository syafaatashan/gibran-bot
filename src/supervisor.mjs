// src/supervisor.mjs - supervisor kredensial, rotasi akun & migrasi konteks.
//
// Semua account management dipegang AccountPool (terbukti 19/19 uji terima).
// Refresh token OAuth = single-use -> hasil refresh langsung ditulis balik ke
// file chain (tmp+rename, atomik). Token invalid_grant ditandai dead.
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';
import { state, saveStore, getSession, setSession } from './store.mjs';
import { log } from './log.mjs';
import { AccountPool } from './lib/account-pool.mjs';
import { MiniMaxCloud, ERR } from './lib/minimax-client.mjs';
import { SessionMigrator } from './lib/session-migrator.mjs';

const CHAIN_FILE = path.join(CFG.dataDir, 'accounts.json');
const SEED_FILE = CFG.accountsSeedFile;

export const cloud = new MiniMaxCloud({
  base: CFG.mm.base,
  salt: CFG.mm.salt,
  timezone: CFG.timezone,
  log: (m) => log(String(m)),
});

// Seed chain: env ACCOUNTS_JSON dulu, lalu file seed di volume.
function seedChainFile() {
  if (fs.existsSync(CHAIN_FILE)) return;
  let raw = CFG.accountsJson || '';
  if (!raw) {
    try { raw = fs.readFileSync(SEED_FILE, 'utf8'); } catch { raw = ''; }
  }
  if (!raw) return;
  try {
    fs.writeFileSync(CHAIN_FILE, raw);
    log('chain akun di-seed (' + Math.round(raw.length / 1024) + ' KB)');
  } catch (e) {
    log('gagal seed chain: ' + String(e.message || e).slice(0, 120));
  }
}

export const pool = new AccountPool({
  accountsFile: CHAIN_FILE,
  stateFile: CHAIN_FILE,
  cloud,
  timezone: CFG.timezone,
  log: (m) => log(String(m)),
});
seedChainFile();
try {
  pool.load();
} catch (e) {
  log('chain akun belum ada: ' + String(e.message || e).slice(0, 120));
}

export const migrator = new SessionMigrator({ cloud, pool, log: (m) => log(String(m)) });

// Fault injection untuk menguji jalur rotasi (hanya dinyalakan lewat /ops/lease).
// 'credit' -> post ke sesi gagal seolah-olah kredit habis (meniru error 50110).
const FAULTS = new Map();
export function armFault(chatId, kind) { FAULTS.set(String(chatId), String(kind || 'credit')); }
export function faultFor(chatId) { return FAULTS.get(String(chatId)) || ''; }
export function clearFault(chatId) { FAULTS.delete(String(chatId)); }

export function chainLabels() {
  return pool.labels();
}

export function currentAccount() {
  const idx = pool.currentIndex >= 0 ? pool.currentIndex : 0;
  return pool.accounts[idx] || null;
}

export async function tokenForLabel(label) {
  return pool.tokenFor(label);
}

export async function agentIdForLabel(label) {
  return pool.agentIdFor(label);
}

export async function ensureAccount() {
  // Self-healing: token bisa ditolak虽然 belum kedaluwarsa (mis. sudah dipakai
  // runtime lain). Coba paksa refresh; kalau invalid_grant -> tandai dead & rotasi.
  for (let attempt = 0; attempt < 25; attempt++) {
    const acc = currentAccount();
    if (!acc) throw new Error('chain akun kosong');
    const label = acc.label || acc.email;
    if (acc.dead) {
      try { await rotateRobust(); } catch (e) { break; }
      continue;
    }
    let token = null;
    let agentId = null;
    try {
      token = await pool.tokenFor(label);
      agentId = await pool.agentIdFor(label);
    } catch (e) {
      log('akun ' + label + ' token ditolak -> paksa refresh');
      try {
        const r = await pool.refresh(label);
        token = r.accessToken;
        agentId = await pool.agentIdFor(label);
      } catch (e2) {
        acc.dead = true;
        acc.deadReason = 'invalid_grant';
        pool.persist();
        log('akun ' + label + ' mati -> rotasi');
        try { await rotateRobust(); } catch (e3) { break; }
        continue;
      }
    }
    state.accounts.currentIndex = pool.currentIndex >= 0 ? pool.currentIndex : 0;
    state.accounts.currentLabel = label;
    saveStore();
    return { label, agentId, accessToken: token, account: acc };
  }
  throw new Error('tidak ada akun yang bisa dipakai');
}

export async function rotateRobust(targetIndex) {
  const n = pool.size();
  if (!n) throw new Error('chain akun kosong');
  const start = (typeof targetIndex === 'number' && targetIndex >= 0)
    ? targetIndex % n
    : (pool.currentIndex + 1 + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    const acc = pool.accounts[idx];
    if (!acc || acc.dead) continue;
    const label = acc.label || acc.email;
    try {
      const c = await pool.credit(label);
      if (c.remaining > 0) {
        pool.currentIndex = idx;
        state.accounts.currentIndex = idx;
        state.accounts.currentLabel = label;
        state.accounts.rotatedAt = Date.now();
        pool.persist();
        saveStore();
        log('rotasi akun -> ' + label + ' (kredit ' + Math.round(c.remaining) + ')');
        return { label, agentId: await pool.agentIdFor(label) };
      }
    } catch (e) {
      if (e && (e.kind === ERR.AUTH || /invalid_grant/.test(String(e.message || e)))) {
        acc.dead = true;
        acc.deadReason = 'invalid_grant';
        pool.persist();
      }
    }
  }
  throw new Error('tidak ada akun dengan kredit');
}

export async function handleCreditExhausted() {
  const acc = currentAccount();
  if (acc) {
    try {
      const claim = await pool.claimCheckin(acc.label || acc.email);
      log('check-in harian: ' + claim.action + (claim.points ? ' (+' + claim.points + ')' : ''));
      if (claim.action === 'claimed') return { action: 'claimed', points: claim.points };
    } catch (e) {
      log('cek check-in gagal: ' + String(e.message || e).slice(0, 140));
    }
  }
  try {
    const r = await rotateRobust();
    return { action: 'rotated', label: r.label };
  } catch (e) {
    return { action: 'rotate-failed', error: String(e.message || e).slice(0, 200) };
  }
}

export async function creditSummary() {
  const acc = currentAccount();
  if (!acc) return { remaining: 0, granted: 0, entries: 0 };
  return pool.credit(acc.label || acc.email);
}

export async function signinStatus() {
  const acc = currentAccount();
  if (!acc) return { claimedToday: false, today: null };
  return cloud.signinStatus(await pool.tokenFor(acc.label || acc.email));
}

export async function claimCheckin() {
  const acc = currentAccount();
  if (!acc) throw new Error('tidak ada akun aktif');
  return pool.claimCheckin(acc.label || acc.email);
}

export async function rotate(targetIndex) {
  return rotateRobust(targetIndex);
}

export function leaseForChat(chatId) {
  return getSession(chatId);
}

export function setChatLease(chatId, info) {
  setSession(chatId, info);
}

export function clearChatLease(chatId) {
  setSession(chatId, { label: '', sessionId: '' });
}

// Migrasi konteks: export histori (token akun PEMILIK) -> sesi baru di akun
// tujuan -> inject brief + pesan lanjutan. Bukti: penanda dari akun A masuk ke
// sesi akun B, dan A lalu ditolak di sesi baru.
export async function migrateChatContext(chatId, oldLabel, newLabel, userText, contextBundle) {
  const lease = getSession(chatId) || {};
  // Ekspor histori WAJIB pakai token akun PEMILIK sesi. Kalau label lease
  // menyimpang dari owner (mis. lease dipaksa pindah akun), owner yang benar.
  const owner = lease.owner || oldLabel;
  const r = await migrator.migrateViaHistory({
    sessionId: lease.sessionId,
    oldLabel: owner,
    newLabel,
    userText,
    contextBundle,
  });
  setChatLease(chatId, { label: newLabel, sessionId: r.newSessionId, agentId: '', owner: newLabel, migrated: true });
  return r;
}

export function importChainFromEnv() {
  if (!CFG.accountsJson) return 0;
  try {
    const j = JSON.parse(CFG.accountsJson);
    const list = Array.isArray(j) ? j : j.accounts || [];
    fs.writeFileSync(CHAIN_FILE, JSON.stringify({ accounts: list }, null, 2));
    pool.load();
    state.accounts.currentIndex = -1;
    saveStore();
    return list.length;
  } catch (e) {
    log('gagal import chain dari env: ' + String(e.message || e).slice(0, 140));
    return 0;
  }
}

export function mergeChainFromBody(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const chain = pool.accounts.slice();
  const byLabel = new Map();
  for (const a of chain) byLabel.set(a.label || a.email, a);
  for (const a of list) {
    if (!a || !(a.refreshToken || a.accessToken)) continue;
    const key = a.label || a.email;
    if (!key) continue;
    byLabel.set(key, Object.assign({}, byLabel.get(key) || {}, a));
  }
  const merged = Array.from(byLabel.values());
  fs.writeFileSync(CHAIN_FILE, JSON.stringify({ accounts: merged }, null, 2));
  pool.load();
  state.accounts.currentIndex = -1;
  saveStore();
  return merged.length;
}
