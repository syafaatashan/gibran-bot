import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';
import { state, saveStore } from './store.mjs';
import { log } from './log.mjs';

const AUTH_HOME = path.join(CFG.dataDir, 'auth');
const NS_DIR = path.join(AUTH_HOME, 'prod', 'en', 'mcode-public');
const SALT = CFG.mm.salt;

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

// accountId = base64url_nopad(sha256(authHome + NUL + clientId)) -> nilainya per mesin
export function accountId() {
  return crypto
    .createHash('sha256')
    .update(AUTH_HOME + String.fromCharCode(0) + CFG.mm.clientId)
    .digest('base64url')
    .replace(/=+$/, '');
}

export function recordKey() {
  return 'com.minimax.mcode.oauth.prod.en' + String.fromCharCode(0) + accountId();
}

const CHAIN_FILE = path.join(CFG.dataDir, 'accounts.json');

// Chain akun disimpan di volume (bukan hanya env) karena refresh token
// single-use: setiap hasil refresh harus langsung ditulis balik, kalau tidak
// token lama jadi invalid_grant dan akun tidak bisa dipakai lagi.
export function loadChain() {
  let raw = '';
  try { raw = fs.readFileSync(CHAIN_FILE, 'utf8'); } catch { raw = ''; }
  if (!raw) {
    raw = CFG.accountsJson || '';
    if (raw) {
      try { fs.writeFileSync(CHAIN_FILE, raw); } catch { /* abaikan */ }
    }
  }
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    const list = Array.isArray(j) ? j : j.accounts || [];
    return list.filter((a) => a && (a.refreshToken || a.accessToken));
  } catch (e) {
    log('gagal parse chain akun: ' + String(e.message || e));
    return [];
  }
}

export function saveChain(chain) {
  try {
    fs.writeFileSync(CHAIN_FILE, JSON.stringify({ generatedAtMs: Date.now(), accounts: chain }, null, 2));
  } catch (e) {
    log('gagal simpan chain akun: ' + String(e.message || e));
  }
}

function persistAccount(label, cred) {
  const chain = loadChain();
  for (const a of chain) {
    if ((a.label || '') === label) {
      a.accessToken = cred.accessToken;
      a.refreshToken = cred.refreshToken;
      a.expiresAtMs = cred.expiresAtMs;
    }
  }
  saveChain(chain);
}

export function chainLabels() {
  return loadChain().map((a) => a.label || a.email || 'akun');
}

export function currentAccount() {
  const chain = loadChain();
  if (!chain.length) return null;
  const idx = state.accounts.currentIndex >= 0 ? state.accounts.currentIndex : 0;
  return chain[Math.min(idx, chain.length - 1)] || null;
}

export async function refreshOAuth(refreshToken) {
  const body = new URLSearchParams({
    client_id: CFG.mm.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: CFG.mm.scope,
    audience: CFG.mm.audience,
  });
  const res = await fetch(CFG.mm.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'MiniMax Code/3.1.17' },
    body,
  });
  const txt = await res.text();
  let t = {};
  try { t = JSON.parse(txt); } catch { /* biarkan */ }
  if (!res.ok || !t.access_token) {
    throw new Error('refresh OAuth gagal HTTP ' + res.status + ' ' + txt.slice(0, 160));
  }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || refreshToken,
    expiresAtMs: Date.now() + Number(t.expires_in || 43200) * 1000,
  };
}

export function writeAuthStore(cred) {
  fs.mkdirSync(NS_DIR, { recursive: true });
  const key = recordKey();
  fs.writeFileSync(
    path.join(NS_DIR, 'auth.json'),
    JSON.stringify({
      schemaVersion: 1,
      records: {
        [key]: {
          schemaVersion: 1,
          accessToken: cred.accessToken,
          refreshToken: cred.refreshToken || '',
          tokenType: 'Bearer',
          clientId: CFG.mm.clientId,
          scopes: [CFG.mm.scope],
          audience: CFG.mm.audience,
          expiresAtMs: cred.expiresAtMs,
          generation: Number(cred.generation || 1),
          loginEpoch: cred.loginEpoch || 'nf-' + Date.now(),
        },
      },
    }, null, 2),
  );
  const prev = readJson(path.join(NS_DIR, 'auth-state.json')) || {};
  fs.writeFileSync(
    path.join(NS_DIR, 'auth-state.json'),
    JSON.stringify(Object.assign({}, prev, {
      schemaVersion: 2,
      status: 'authenticated',
      storeKind: 'file',
      clientId: CFG.mm.clientId,
      scopes: [CFG.mm.scope],
      audience: CFG.mm.audience,
      buildEnv: 'prod',
      region: 'en',
      generation: Number(cred.generation || 1),
      expiresAtMs: cred.expiresAtMs,
    }), null, 2),
  );
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readAuthStoreRecord() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(NS_DIR, 'auth.json'), 'utf8'));
    const recs = Object.values(j.records || {});
    return recs.length ? recs[0] : null;
  } catch {
    return null;
  }
}
// Pastikan akun aktif punya access token yang valid dan sudah ditulis ke auth store.
export async function ensureAccount() {
  const acc = currentAccount();
  if (!acc) {
    throw new Error('chain akun kosong (ACCOUNTS_JSON / accounts file belum diisi)');
  }
  const expiresAtMs = Number(acc.expiresAtMs || 0);
  let cred = null;
  // Auth store selalu memegang token terbaru untuk akun aktif. Jika chain basi
  // (mis. setelah refresh di runtime lain), ambil dari sana lalu selaraskan.
  const storeRec = readAuthStoreRecord();
  if (storeRec && storeRec.accessToken && Number(storeRec.expiresAtMs || 0) - Date.now() > 5 * 60 * 1000) {
    cred = {
      accessToken: storeRec.accessToken,
      refreshToken: storeRec.refreshToken,
      expiresAtMs: Number(storeRec.expiresAtMs),
      generation: storeRec.generation || 1,
    };
    acc.accessToken = cred.accessToken;
    acc.refreshToken = cred.refreshToken;
    acc.expiresAtMs = cred.expiresAtMs;
  } else if (acc.accessToken && expiresAtMs - Date.now() > 5 * 60 * 1000) {
    cred = { accessToken: acc.accessToken, refreshToken: acc.refreshToken, expiresAtMs, generation: acc.generation || 1 };
  } else if (acc.refreshToken) {
    log('refresh OAuth untuk akun ' + (acc.label || acc.email));
    cred = await refreshOAuth(acc.refreshToken);
    acc.accessToken = cred.accessToken;
    acc.refreshToken = cred.refreshToken;
    acc.expiresAtMs = cred.expiresAtMs;
  } else {
    throw new Error('akun ' + (acc.label || acc.email) + ' tidak punya token sama sekali');
  }
  writeAuthStore(cred);
  persistAccount(acc.label || acc.email || '', cred);
  state.accounts.currentLabel = acc.label || acc.email || '';
  saveStore();
  return Object.assign({ label: acc.label, agentId: acc.agentId }, cred);
}

function eligible(acc) {
  // Akun pool hanya bisa dipakai di mode cloud-agent. Mode runtime-local butuh
  // akun yang sudah sign-in penuh (content review auth), ditandai runtime: true.
  if (CFG.mode !== 'runtime-local') return true;
  return acc.runtime !== false;
}

export async function rotate(targetIndex) {
  const chain = loadChain();
  if (!chain.length) throw new Error('chain akun kosong');
  let next;
  if (typeof targetIndex === 'number' && targetIndex >= 0) {
    next = targetIndex % chain.length;
  } else {
    next = (state.accounts.currentIndex + 1) % chain.length;
    for (let i = 0; i < chain.length && !eligible(chain[next]); i++) {
      next = (next + 1) % chain.length;
    }
    if (!eligible(chain[next])) {
      // Tidak ada akun runtime lain: tetap di akun sekarang (check-in sudah dicoba).
      next = state.accounts.currentIndex >= 0 ? state.accounts.currentIndex : 0;
      log('tidak ada akun runtime lain yang eligible, tetap di akun sekarang');
    }
  }
  state.accounts.currentIndex = next;
  state.accounts.rotatedAt = Date.now();
  saveStore();
  const acc = chain[next];
  let cred;
  if (acc.refreshToken) {
    cred = await refreshOAuth(acc.refreshToken);
    acc.accessToken = cred.accessToken;
    acc.refreshToken = cred.refreshToken;
    acc.expiresAtMs = cred.expiresAtMs;
  } else {
    cred = { accessToken: acc.accessToken, refreshToken: '', expiresAtMs: Number(acc.expiresAtMs || 0) };
  }
  writeAuthStore(cred);
  persistAccount(acc.label || acc.email || '', cred);
  state.accounts.currentLabel = acc.label || acc.email || '';
  saveStore();
  log('rotasi akun -> ' + state.accounts.currentLabel);
  return Object.assign({ label: state.accounts.currentLabel, agentId: acc.agentId }, cred);
}

function cloudHeaders(token, raw) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    Authorization: 'Bearer ' + token,
    'x-timestamp': ts,
    'x-signature': md5(ts + SALT + (raw || '')),
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/156.0.0.0 Safari/537.36',
  };
}

export async function signinStatus(token) {
  const url = CFG.mm.base + '/minimax-cloud/api/v1/signin/status?client=desktop&timezone_id=' + encodeURIComponent(CFG.timezone);
  const res = await fetch(url, { headers: cloudHeaders(token) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('signin/status HTTP ' + res.status);
  const data = j.data || {};
  const days = Array.isArray(data.days) ? data.days : [];
  const today = days.find((d) => d.is_today) || null;
  return { today, claimedToday: !!(today && today.status === 3), days };
}

export async function claimSignin(token) {
  const body = '{}';
  const url = CFG.mm.base + '/minimax-cloud/api/v1/signin/claim?client=desktop&timezone_id=' + encodeURIComponent(CFG.timezone);
  const res = await fetch(url, { method: 'POST', headers: cloudHeaders(token, body), body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('signin/claim HTTP ' + res.status);
  const data = j.data || {};
  return { claimResult: Number(data.claim_result || 0), points: Number(data.points || 0), dayNo: data.day_no };
}

export async function creditSummary(token) {
  const url = CFG.mm.base + '/minimax-cloud/api/v1/credit/details?client=desktop';
  const res = await fetch(url, { headers: cloudHeaders(token) });
  const j = await res.json().catch(() => ({}));
  const details = Array.isArray(j.details) ? j.details : [];
  const remaining = details.reduce((sum, d) => sum + Number(d.remaining_amount || 0), 0);
  const granted = details.reduce((sum, d) => sum + Number(d.granted_amount || 0), 0);
  return { remaining, granted, entries: details.length };
}

// Klaim check-in harian untuk akun aktif (dipakai supervisor dan endpoint ops).
export async function claimCheckin() {
  const acc = currentAccount();
  if (!acc || !acc.accessToken) throw new Error('akun aktif tidak punya access token');
  const st = await signinStatus(acc.accessToken);
  if (st.claimedToday) return { action: 'already-claimed', today: st.today };
  const claim = await claimSignin(acc.accessToken);
  log('check-in diklaim: claim_result=' + claim.claimResult + ' points=' + claim.points);
  return { action: 'claimed', claimResult: claim.claimResult, points: claim.points, dayNo: claim.dayNo };
}

// Dipanggil saat turn gagal karena kredit habis: coba klaim check-in dulu, lalu rotasi.
export async function handleCreditExhausted() {
  const acc = currentAccount();
  if (acc && acc.accessToken) {
    try {
      const st = await signinStatus(acc.accessToken);
      if (!st.claimedToday) {
        const claim = await claimSignin(acc.accessToken);
        log('check-in harian diklaim, claim_result=' + claim.claimResult + ' points=' + claim.points);
        if (claim.claimResult === 1 || claim.claimResult === 2) {
          return { action: 'claimed', points: claim.points };
        }
      } else {
        log('check-in hari ini sudah diklaim, kredit tetap habis -> rotasi');
      }
    } catch (e) {
      log('gagal cek check-in: ' + String(e.message || e));
    }
  }
  let rotated;
  try {
    rotated = await rotate();
  } catch (e) {
    log('rotasi gagal: ' + String((e && e.message) || e).slice(0, 160));
    return { action: 'rotate-failed', error: String((e && e.message) || e).slice(0, 200) };
  }
  return { action: 'rotated', label: rotated.label };
}
