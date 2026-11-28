// src/user-store.mjs - penyimpanan profil per pengguna (satu folder per chatId).
//
// Isolasi data: tiap user Telegram punya folder sendiri di <dataDir>/users/<chatId>/
// sehingga profil, mode apply, dan akun sticky tidak pernah tercampur.
// Penulisan atomik (tmp + rename) supaya file tidak korup saat container restart.
// CATATAN: profil TIDAK PERNAH menyimpan token/secret - hanya label akun.
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';

// Override untuk uji (folder produksi /data tidak boleh disentuh).
export const PROFILE_DIR = process.env.PROFILE_DIR
  ? path.resolve(process.env.PROFILE_DIR)
  : path.join(CFG.dataDir, 'users');

// Nilai default profil. Satu sumber kebenaran, dipakai users.mjs juga.
export const PROFILE_DEFAULTS = Object.freeze({
  chatId: '',
  mode: 'confirm',
  applyDailyCap: 5,
  accountLabel: '',
  cv: {},
  prefs: {},
  seenDriveNodes: [],
  appliedToday: 0,
  appliedDate: '',
  lastAction: '',
  manual: false,
  reservedAccounts: [],
});

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export function defaultProfile(chatId) {
  return Object.assign(clone(PROFILE_DEFAULTS), { chatId: String(chatId) });
}

export function profileDir(chatId) {
  return path.join(PROFILE_DIR, String(chatId));
}

export function profilePath(chatId) {
  return path.join(profileDir(chatId), 'profile.json');
}

// Samakan bentuk data agar file rusak / versi lama tidak bikin crash.
function normalizeProfile(chatId, raw) {
  const out = defaultProfile(chatId);
  const j = (raw && typeof raw === 'object') ? raw : {};
  if (j.mode === 'auto' || j.mode === 'confirm') out.mode = j.mode;
  const cap = Number(j.applyDailyCap);
  if (Number.isFinite(cap) && cap >= 0) out.applyDailyCap = Math.floor(cap);
  if (typeof j.accountLabel === 'string') out.accountLabel = j.accountLabel;
  if (j.cv && typeof j.cv === 'object') out.cv = clone(j.cv);
  if (j.prefs && typeof j.prefs === 'object') out.prefs = clone(j.prefs);
  if (Array.isArray(j.seenDriveNodes)) out.seenDriveNodes = clone(j.seenDriveNodes);
  const at = Number(j.appliedToday);
  out.appliedToday = Number.isFinite(at) && at > 0 ? Math.floor(at) : 0;
  if (typeof j.appliedDate === 'string') out.appliedDate = j.appliedDate;
  if (typeof j.lastAction === 'string') out.lastAction = j.lastAction;
  out.manual = !!j.manual;
  if (Array.isArray(j.reservedAccounts)) {
    out.reservedAccounts = Array.from(new Set(
      j.reservedAccounts.map((x) => String(x)).filter((x) => x),
    ));
  }
  return out;
}

// Baca profil satu user. File tak ada -> profil default (bukan error).
export function loadProfile(chatId) {
  const key = String(chatId === undefined || chatId === null ? '' : chatId).trim();
  if (!key) throw new Error('chatId wajib');
  try {
    const raw = fs.readFileSync(profilePath(key), 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return defaultProfile(key);
    return normalizeProfile(key, j);
  } catch {
    return defaultProfile(key);
  }
}

// Simpan profil (patch digabung ke profil lama), tulis atomik: tmp + rename.
export function saveProfile(chatId, patch) {
  const key = String(chatId === undefined || chatId === null ? '' : chatId).trim();
  if (!key) throw new Error('chatId wajib');
  const cur = loadProfile(key);
  const p = (patch && typeof patch === 'object') ? patch : {};
  const merged = Object.assign({}, cur, p);
  // Objek profil (cv/prefs) digabung, bukan ditimpa, supaya patch kecil
  // tidak menghapus field milik user yang lain.
  if (p.cv && typeof p.cv === 'object') merged.cv = Object.assign({}, cur.cv, clone(p.cv));
  if (p.prefs && typeof p.prefs === 'object') merged.prefs = Object.assign({}, cur.prefs, clone(p.prefs));
  merged.chatId = key;

  const next = normalizeProfile(key, merged);
  const dir = profileDir(key);
  fs.mkdirSync(dir, { recursive: true });
  const file = profilePath(key);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

// Daftar semua profil yang tersimpan (ringkasan, tanpa token).
export function listProfiles() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(PROFILE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return out;
  }
  for (const name of entries) {
    try {
      const p = loadProfile(name);
      out.push({
        chatId: p.chatId,
        mode: p.mode,
        applyDailyCap: p.applyDailyCap,
        appliedToday: p.appliedToday,
        appliedDate: p.appliedDate,
        accountLabel: p.accountLabel,
        lastAction: p.lastAction,
        manual: p.manual,
        reservedAccounts: p.reservedAccounts.slice(),
      });
    } catch {
      // Folder tanpa profil.json / rusak -> lewati, jangan gagalkan semua.
    }
  }
  return out;
}
