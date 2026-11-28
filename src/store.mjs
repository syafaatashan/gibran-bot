import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';

const FILE = path.join(CFG.dataDir, 'state.json');

export const state = {
  tokens: null,
  accounts: { chain: [], currentIndex: -1, currentLabel: '', lastError: '', rotatedAt: 0 },
  sessions: {},
  updatedAt: 0,
};

export function loadStore() {
  try {
    fs.mkdirSync(CFG.dataDir, { recursive: true });
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && typeof j === 'object') {
      state.tokens = j.tokens || null;
      state.sessions = j.sessions || {};
      if (j.accounts) state.accounts = Object.assign(state.accounts, j.accounts);
    }
  } catch {
    state.tokens = null;
    state.sessions = {};
  }
  // Token tersimpan harus milik agent yang sama; kalau agent berganti, token lama dibuang.
  if (state.tokens && state.tokens.agentId && CFG.mm.agentId && state.tokens.agentId !== CFG.mm.agentId) {
    state.tokens = null;
  }
  // Bootstrap sekali dari env; setelah itu state file yang jadi acuan
  // (refresh token single-use, jadi tidak boleh dipakai dua runtime).
  if (!state.tokens && (CFG.mm.accessToken || CFG.mm.refreshToken)) {
    state.tokens = {
      accessToken: CFG.mm.accessToken,
      refreshToken: CFG.mm.refreshToken,
      expiresAtMs: CFG.mm.expiresAtMs || 0,
      agentId: CFG.mm.agentId,
    };
    saveStore();
  }
}

// Muat otomatis saat modul diimpor agar urutan import tidak jadi sumber bug.
loadStore();

export function saveStore() {
  state.updatedAt = Date.now();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

export function getSession(chatId) {
  return state.sessions[String(chatId)] || null;
}

export function setSession(chatId, info) {
  state.sessions[String(chatId)] = Object.assign({}, state.sessions[String(chatId)], info, { updatedAt: Date.now() });
  saveStore();
}
