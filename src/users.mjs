// src/users.mjs - isolasi per pengguna: profil, mode apply, akun cloud sticky.
//
// MASALAH: memory agen MiniMax cloud bersifat per-agen (per akun OAuth). Kalau
// satu akun dipakai beberapa user Telegram, fakta user A bisa bocor ke user B.
// SOLUSI: satu akun pool DEDICATED per user (sticky) + konteks sesi yang
// menyatakan batas data per pengguna.
//
// CATATAN: tidak ada token/secret yang dicetak atau disimpan di sini - hanya
// label akun (mis. "Akun Uji 1000").
import { CFG } from './config.mjs';
import {
  loadProfile, saveProfile, listProfiles, PROFILE_DEFAULTS,
} from './user-store.mjs';

export { listProfiles };

// Template profil default (dipakai users.mjs dan user-store.mjs).
export const DEFAULT_PROFILE = PROFILE_DEFAULTS;

// Mode apply yang sah.
export const MODES = Object.freeze(['confirm', 'auto']);

// Tanggal lokal (timezone konfigurasi) format YYYY-MM-DD.
export function todayISO(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CFG.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function getProfile(chatId) {
  return loadProfile(chatId);
}

// Ubah mode apply. Hanya 'confirm' atau 'auto' yang diterima.
export function setMode(chatId, mode) {
  const m = String(mode === undefined || mode === null ? '' : mode);
  if (!MODES.includes(m)) {
    throw new Error('mode tidak valid: "' + m + '" (harus confirm atau auto)');
  }
  return saveProfile(chatId, { mode: m });
}

// Patch bebas pada profil user (dipakai lapisan Telegram/lead).
export function patchProfile(chatId, patch) {
  return saveProfile(chatId, patch);
}

function findAccount(pool, label) {
  if (!pool || !Array.isArray(pool.accounts)) return null;
  return pool.accounts.find((a) => a && String(a.label || a.email) === String(label)) || null;
}

// Semua label akun yang sudah dipesan user (dari seluruh profil).
export function reservedLabelSet() {
  const set = new Set();
  for (const p of listProfiles()) {
    for (const l of p.reservedAccounts || []) set.add(String(l));
    if (p.accountLabel) set.add(String(p.accountLabel));
  }
  return set;
}

async function agentIdFor(pool, label) {
  if (!pool || typeof pool.agentIdFor !== 'function') return '';
  try {
    return (await pool.agentIdFor(label)) || '';
  } catch {
    // Gagal resolve agent id tidak boleh membatalkan penugasan akun;
    // pemanggil bisa mencoba lagi nanti.
    return '';
  }
}

// Berikan satu akun pool DEDICATED untuk user ini (sticky, tidak berubah).
// - Kalau profil sudah punya accountLabel, pakai itu (idempoten).
// - Kalau belum, pilih satu akun pada indeks >= reserveFrom yang belum dipakai
//   user lain dan tidak dead, tandai reserved, simpan, kembalikan { label, agentId }.
// - Kalau tidak ada akun tersisa, lempar error yang jelas.
export async function assignStickyAccount(chatId, opts = {}) {
  const pool = opts && opts.pool;
  if (!pool || !Array.isArray(pool.accounts) || !pool.accounts.length) {
    throw new Error('pool akun tidak tersedia untuk penugasan akun sticky');
  }
  const key = String(chatId === undefined || chatId === null ? '' : chatId).trim();
  if (!key) throw new Error('chatId wajib');
  const reserveFrom = Number.isFinite(Number(opts.reserveFrom))
    ? Math.max(0, Math.floor(Number(opts.reserveFrom)))
    : 1000;

  const prof = getProfile(key);

  // Sudah punya akun -> pakai akun itu (tidak cari baru).
  if (prof.accountLabel) {
    const acc = findAccount(pool, prof.accountLabel);
    if (acc && !acc.dead) {
      return { label: prof.accountLabel, agentId: await agentIdFor(pool, prof.accountLabel) };
    }
    // Akun lama hilang/mati -> lepas reservasi, lalu pilih yang baru.
    releaseAccount(key, prof.accountLabel);
  }

  const used = reservedLabelSet();
  const start = Math.min(reserveFrom, pool.accounts.length);
  for (let i = start; i < pool.accounts.length; i++) {
    const acc = pool.accounts[i];
    if (!acc || acc.dead) continue;
    const label = String(acc.label || acc.email || '').trim();
    if (!label || used.has(label)) continue;
    const reserved = Array.from(new Set((prof.reservedAccounts || []).concat([label])));
    saveProfile(key, { accountLabel: label, reservedAccounts: reserved });
    return { label, agentId: await agentIdFor(pool, label) };
  }
  throw new Error(
    'tidak ada akun pool tersisa untuk pengguna ' + key
    + ' (butuh akun bebas pada indeks >= ' + reserveFrom + ')',
  );
}

// Lepas akun sticky (dipakai saat akun mati). Profil lain tidak tersentuh.
export function releaseAccount(chatId, label) {
  const l = String(label === undefined || label === null ? '' : label).trim();
  if (!l) throw new Error('label akun wajib untuk release');
  const prof = getProfile(chatId);
  const reserved = (prof.reservedAccounts || []).filter((x) => String(x) !== l);
  const patch = { reservedAccounts: reserved };
  if (String(prof.accountLabel) === l) patch.accountLabel = '';
  return saveProfile(chatId, patch);
}

// Penghitung harian efektif: 0 kalau appliedDate bukan hari ini.
function usedToday(prof) {
  return String(prof.appliedDate) === todayISO() ? Number(prof.appliedToday || 0) : 0;
}

// Boleh applying? mode auto: belum melewati cap harian. mode confirm: boleh
// (menyiapkanCandidates tetap boleh, konfirmasi datang dari user).
export function canApply(chatId) {
  const prof = getProfile(chatId);
  if (prof.mode !== 'auto') return true;
  const cap = Number(prof.applyDailyCap || 0);
  return usedToday(prof) < cap;
}

// Tambah penghitung apply hari ini; reset otomatis kalau tanggal berganti.
export function markApplied(chatId) {
  const prof = getProfile(chatId);
  const today = todayISO();
  const count = String(prof.appliedDate) === today ? Number(prof.appliedToday || 0) + 1 : 1;
  return saveProfile(chatId, { appliedDate: today, appliedToday: count });
}

// Sisa kuota apply hari ini.
export function dailyRemaining(chatId) {
  const prof = getProfile(chatId);
  const cap = Number(prof.applyDailyCap || 0);
  if (prof.mode !== 'auto') return cap;
  return Math.max(0, cap - usedToday(prof));
}

function firstStr(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// Identitas user (nama/email) bila tersedia di profil.
function identityOf(prof) {
  const cv = (prof && prof.cv) || {};
  const prefs = (prof && prof.prefs) || {};
  const user = (prof && prof.user) || {};
  const name = firstStr(prof.name, cv.name, cv.nama, prefs.name, prefs.nama, user.name);
  const email = firstStr(prof.email, cv.email, prefs.email, user.email);
  const parts = [];
  if (name) parts.push(name);
  if (email) parts.push(email);
  return parts.join(' / ');
}

// Blok konteks untuk sesi cloud: batas data per pengguna.
export function userContextBlock(chatId) {
  const prof = getProfile(chatId);
  const ident = identityOf(prof);
  return 'Ini pengguna Telegram ' + prof.chatId + (ident ? ' (' + ident + ')' : '')
    + '. Gunakan HANYA fakta milik pengguna ini. Jangan sebut, menyimpulkan,'
    + ' atau memakai data pengguna lain.';
}

// Ringkasan untuk endpoint /ops/users (tanpa token/secret).
export function exportForOps() {
  return listProfiles().map((p) => ({
    chatId: p.chatId,
    mode: p.mode,
    applyDailyCap: p.applyDailyCap,
    appliedToday: p.appliedToday,
    accountLabel: p.accountLabel,
  }));
}
