import crypto from 'node:crypto';
import { CFG } from './config.mjs';
import { state, saveStore } from './store.mjs';
import { log } from './log.mjs';

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

async function refreshTokens() {
  const rt = state.tokens && state.tokens.refreshToken;
  if (!rt) throw new Error('tidak ada refresh token MiniMax');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: CFG.mm.clientId,
    scope: CFG.mm.scope,
    audience: CFG.mm.audience,
  });
  const res = await fetch(CFG.mm.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const txt = await res.text();
  let t = {};
  try { t = JSON.parse(txt); } catch { /* biarkan */ }
  if (!res.ok || !t.access_token) {
    throw new Error('refresh token gagal HTTP ' + res.status + ' ' + txt.slice(0, 180));
  }
  state.tokens = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || rt,
    expiresAtMs: Date.now() + Number(t.expires_in || 43200) * 1000,
    agentId: CFG.mm.agentId,
  };
  saveStore();
  log('access token di-refresh, berlaku s/d ' + new Date(state.tokens.expiresAtMs).toISOString());
  return state.tokens.accessToken;
}

export async function accessToken() {
  const t = state.tokens;
  if (t && t.accessToken && t.expiresAtMs - Date.now() > 5 * 60 * 1000) return t.accessToken;
  return refreshTokens();
}

function signedHeaders(raw) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    Authorization: 'Bearer ' + 'PENDING',
    'x-timestamp': ts,
    'x-signature': md5(ts + CFG.mm.salt + (raw || '')),
    Accept: 'application/json',
    'User-Agent': 'MiniMax Code/3.1.17',
  };
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const url = new URL(CFG.mm.base + path);
  for (const [k, v] of Object.entries({ ...(query || {}), client: 'desktop' })) {
    url.searchParams.set(k, String(v));
  }
  const headers = signedHeaders(raw);
  headers.Authorization = 'Bearer ' + (await accessToken());
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : raw });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error('cloud ' + path + ' HTTP ' + res.status + ' ' + text.slice(0, 200));
    e.status = res.status;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('cloud ' + path + ': balasan bukan JSON: ' + text.slice(0, 160));
  }
}

export async function createSession(title, attempt) {
  const n = attempt || 0;
  const j = await api('/minimax-cloud/api/v1/agent/' + encodeURIComponent(CFG.mm.agentId) + '/session', {
    method: 'POST',
    body: { title: title || 'gibran-bot' },
  });
  const sid = j && j.session_id;
  if (!sid) {
    const msg = String((j && j.base_resp && j.base_resp.status_msg) || JSON.stringify(j)).slice(0, 160);
    // "session ownership denied" pernah muncul sebagai galat transient -> coba lagi.
    if (n < 3) {
      log('buat sesi gagal (' + msg + '), coba lagi #' + (n + 2));
      await new Promise((r) => setTimeout(r, 1500 * (n + 1)));
      return createSession(title, n + 1);
    }
    throw new Error('gagal membuat sesi cloud: ' + msg);
  }
  return sid;
}

/**
 * Kirim pesan ke sesi cloud dan kembalikan teks jawaban final.
 * Protokol: SSE, event type=6 (chunk msg_content) dan type=2 (pesan final).
 */
export async function postMessage(sessionId, content) {
  const raw = JSON.stringify({
    content,
    sender: {
      session_id: sessionId,
      agent_name: CFG.mm.agentId,
      device_name: 'gibran-bot',
      title: 'telegram',
    },
  });
  const url = new URL(CFG.mm.base + '/minimax-cloud/api/v1/session/' + encodeURIComponent(sessionId) + '/message');
  url.searchParams.set('client', 'desktop');
  const headers = signedHeaders(raw);
  headers.Authorization = 'Bearer ' + (await accessToken());
  headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: raw,
    signal: AbortSignal.timeout(CFG.mm.turnTimeoutMs),
  });
  if (!res.ok || !res.body) {
    const t = res.body ? await res.text().catch(() => '') : '';
    const e = new Error('kirim pesan HTTP ' + res.status + ' ' + String(t).slice(0, 200));
    e.status = res.status;
    throw e;
  }
  let buf = '';
  let streamed = '';
  let final = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      let o;
      try { o = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (o.type === 6 && o.agent_message_chunk && typeof o.agent_message_chunk.msg_content === 'string') {
        streamed += o.agent_message_chunk.msg_content;
      } else if (o.type === 2 && o.agent_message && o.agent_message.role === 'assistant') {
        final = o.agent_message.msg_content || final;
      }
    }
  }
  return { text: (final || streamed).trim(), streamed: streamed.trim() };
}
