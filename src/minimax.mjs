// src/minimax.mjs - adapter klien MiniMax Code Cloud (mode cloud-agent).
//
// PENTING: MiniMax membalas HTTP 200 dengan error di body.base_resp.
// Kalau hanya cek status HTTP, 'session ownership denied' terbaca sebagai
// 'histori kosong' -> konteks hilang DIAM-DIAM. Semua jalur wajib cek base_resp.
import { MiniMaxCloud, ERR, DEFAULTS, redact, classifyError } from './lib/minimax-client.mjs';
import { CFG } from './config.mjs';

export { ERR, redact, classifyError };

export const cloud = new MiniMaxCloud({
  base: CFG.mm.base,
  salt: CFG.mm.salt,
  timezone: CFG.timezone,
  // Fallback token untuk panggilan tanpa token eksplisit. Import dinamis dipakai
  // supaya modul ini tetap bebas siklus import dengan supervisor.
  getAccessToken: async () => {
    const sup = await import('./supervisor.mjs');
    const acc = await sup.ensureAccount();
    return acc.accessToken;
  },
  log: (m) => console.log(String(m)),
});

export async function api(path, opts = {}) {
  return cloud.req(Object.assign({ path }, opts));
}

export async function createSession(agentId, title, token) {
  return cloud.createSession(agentId, title, token);
}

export async function postMessage(sid, content, opts = {}) {
  return cloud.postMessage(sid, content, opts);
}

export async function listMessages(sid, opts = {}) {
  const q = {};
  if (opts.limit) q.limit = opts.limit;
  if (opts.before) q.before = opts.before;
  return cloud.listMessages(sid, q, opts.token);
}
