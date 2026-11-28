// lib/minimax-client.mjs - Klien API MiniMax Code Cloud (mode cloud-agent).
// Zero dependency. Semua nilai rahasia TIDAK pernah dicetak: logger接受 redactor.
import crypto from 'node:crypto';

export const DEFAULTS = {
  base: 'https://agent.minimax.io',
  clientId: 'mcode-public',
  scope: 'agent.default',
  audience: 'agent-backend',
  tokenUrl: 'https://account.minimax.io/oauth2/token',
  salt: 'I*7Cf%WZ#S&%1RlZJ&C2',
  timezone: 'Asia/Makassar',
};

export const ERR = {
  CREDIT: 'credit_exhausted',
  AUTH: 'auth_invalid',
  OWNERSHIP: 'session_ownership_denied',
  SESSION_BUSY: 'session_not_idle',
  RATE: 'rate_limited',
  HTTP: 'http_error',
};

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// --- Redaksi: papan pengaman agar token tidak pernah bocor ke log/stdout. ---
const SECRET_KEY_RE = /^(.*_)?(access_?token|refresh_?token|token|secret|password|authorization|api_?key|device_?token|source_device_token|pairing_code)$/i;
export function redact(value, key) {
  if (key && SECRET_KEY_RE.test(String(key))) {
    const s = value == null ? '' : String(value);
    return s.length ? `<REDACTED len=${s.length}>` : '';
  }
  if (typeof value === 'string') {
    return value.replace(/[A-Za-z0-9_\-]{40,}/g, (m) => `<REDACTED len=${m.length}>`);
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = redact(v, k);
    return o;
  }
  return value;
}

// MiniMax menjawab HTTP 200 dengan error di body.base_resp (bukan HTTP error).
// Kalau tidak diperiksa, 'session ownership denied' akan terlihat seperti 'histori kosong'.
export function baseStatus(json) {
  const b = json && json.base_resp;
  if (!b) return 0;
  const n = Number(b.status_code || 0);
  return Number.isFinite(n) ? n : 0;
}
export function baseMessage(json) {
  const b = json && json.base_resp;
  return b ? String(b.status_msg || '') : '';
}
export function assertBaseOk(json, where) {
  const code = baseStatus(json);
  if (code === 0) return json;
  const msg = baseMessage(json);
  const e = new Error('MM ' + (where || 'api') + ' base_resp ' + code + ' ' + msg);
  e.kind = classifyError(200, JSON.stringify(json));
  e.baseCode = code;
  e.baseMsg = msg;
  e.body = json;
  throw e;
}
export function classifyError(status, body) {
  const txt = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 401 || /invalid access token|token expired|unauthorized/i.test(txt)) return ERR.AUTH;
  if (/1406010061/i.test(txt) || /session ownership denied/i.test(txt)) return ERR.OWNERSHIP;
  if (/1406010091/i.test(txt) || /session[_ ]not[_ ]idle/i.test(txt)) return ERR.SESSION_BUSY;
  if (/50110|insufficient balance|1008/i.test(txt)) return ERR.CREDIT;
  if (status === 429) return ERR.RATE;
  return ERR.HTTP;
}

export class MiniMaxCloud {
  constructor(opts = {}) {
    this.base = (opts.base || DEFAULTS.base).replace(/\/+$/, '');
    this.salt = opts.salt || DEFAULTS.salt;
    this.timezone = opts.timezone || DEFAULTS.timezone;
    this.getAccessToken = opts.getAccessToken; // async () => string
    this.log = opts.log || (() => {});
  }

  headers(token, raw) {
    const ts = String(Math.floor(Date.now() / 1000));
    return {
      Authorization: 'Bearer ' + token,
      'x-timestamp': ts,
      'x-signature': md5(ts + this.salt + (raw || '')),
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    };
  }

  // req({ method, path, query, body, token, headers, timeoutMs })
  async req({ method = 'GET', path, query, body, token, headers: extra, timeoutMs = 60000, raw = false, strictBase = true }) {
    const tok = token || await this.getAccessToken();
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries({ ...(query || {}), client: 'desktop' })) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers = { ...this.headers(tok, rawBody), ...(extra || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url.toString(), {
      method, headers,
      body: body === undefined ? undefined : rawBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    if (res.ok && json !== undefined && baseStatus(json) !== 0 && strictBase !== false) {
      // HTTP 200 tapiisi error: lempar agarOwnership/credit terdeteksi.
      const e = new Error('MM ' + method + ' ' + path + ' base_resp ' + baseStatus(json) + ' ' + baseMessage(json));
      e.kind = classifyError(200, text);
      e.baseCode = baseStatus(json);
      e.baseMsg = baseMessage(json);
      e.body = json;
      e.status = res.status;
      throw e;
    }
    if (!res.ok) {
      const e = new Error('MM ' + method + ' ' + path + ' HTTP ' + res.status + ' ' + text.slice(0, 200));
      e.status = res.status; e.kind = classifyError(res.status, text); e.body = json || text; e.path = path;
      throw e;
    }
    return raw ? text : json;
  }

  // --- Session & agent ---
  async listAgents(token) {
    const j = await this.req({ method: 'GET', path: '/minimax-cloud/api/v1/agent', token });
    const agents = j && (j.agents || j.data?.agents) || [];
    return Array.isArray(agents) ? agents : [];
  }
  // Agent id milik akun: GET /agent -> field 'name' = agent id numerik (role mavis/chat).
  // Bukti live 2026-11-28: /agent membalas { agents:[{name:'460834954912003', agent_role:'mavis', ...}] }.
  async resolveAgentId(token) {
    const agents = await this.listAgents(token);
    const pick = agents.find((a) => a.agent_role === 'mavis')
      || agents.find((a) => a.agent_role === 'chat')
      || agents.find((a) => a.name && String(a.name).length > 3)
      || agents[0];
    if (!pick) return null;
    const id = pick.name ?? pick.agent_id ?? pick.id ?? '';
    return { agentId: String(id), name: pick.name ?? '', agentRole: pick.agent_role ?? '', displayName: pick.display_name ?? '', raw: pick };
  }
  // Daftar sesi milik agen (GET, read-only) - dipakai broker untuk memetakan session->owner.
  async listSessions(agentId, { limit = 50, before } = {}, token) {
    const j = await this.req({ method: 'GET', path: '/minimax-cloud/api/v1/agent/' + encodeURIComponent(agentId) + '/session', query: { limit, before }, token });
    const sessions = (j && (j.sessions || (j.data && j.data.sessions))) || [];
    return Array.isArray(sessions) ? sessions : [];
  }
  async createSession(agentId, title, token) {
    const j = await this.req({ method: 'POST', path: '/minimax-cloud/api/v1/agent/' + encodeURIComponent(agentId) + '/session', body: { title: title || 'gibran-bot' }, token });
    const sid = j && (j.session_id ?? j.sessionId ?? j.data?.session_id);
    if (!sid) { const e = new Error('createSession tanpa session_id: ' + JSON.stringify(redact(j)).slice(0, 200)); e.kind = ERR.HTTP; throw e; }
    return String(sid);
  }
  // Akhiri/arsipkan sesi (best effort). Dipakai saat sesi macet dengan turn aktif.
  async archiveSession(sid, token) {
    try {
      await this.req({ method: 'POST', path: '/minimax-cloud/api/v1/session/' + encodeURIComponent(sid) + '/archive', token });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).slice(0, 140) };
    }
  }
  async getSession(sid, token) {
    return this.req({ method: 'GET', path: '/minimax-cloud/api/v1/session/' + encodeURIComponent(sid), token });
  }
  async listMessages(sid, { limit = 50, before } = {}, token) {
    return this.req({ method: 'GET', path: '/minimax-cloud/api/v1/session/' + encodeURIComponent(sid) + '/message', query: { limit, before, include_attachment_read_urls: 'false' }, token });
  }
  // Kirim pesan; SSE. Return { text, streamed, turnId, rawFrames }.
  async postMessage(sid, content, { sender = {}, token, timeoutMs = 900000 } = {}) {
    const raw = JSON.stringify({
      content,
      sender: {
        session_id: sid,
        device_name: sender.device_name || 'gibran-bot',
        agent_name: sender.agent_name || 'gibran-bot',
        title: sender.title || 'telegram',
      },
    });
    const url = new URL(this.base + '/minimax-cloud/api/v1/session/' + encodeURIComponent(sid) + '/message');
    url.searchParams.set('client', 'desktop');
    const tok = token || await this.getAccessToken();
    const headers = { ...this.headers(tok, raw), 'Content-Type': 'application/json' };
    const res = await fetch(url.toString(), { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      const e = new Error('postMessage HTTP ' + res.status + ' ' + t.slice(0, 200));
      e.status = res.status; e.kind = classifyError(res.status, t); e.body = t;
      throw e;
    }
    let buf = ''; let rawAll = ''; let streamed = ''; let final = ''; let turnId = ''; const frames = [];
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      const piece = dec.decode(chunk, { stream: true });
      rawAll += piece;
      buf += piece;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        let o; try { o = JSON.parse(line.slice(5).trim()); } catch { continue; }
        frames.push(o);
        if (o && o.base_resp && Number(o.base_resp.status_code || 0) !== 0) {
          const ee = new Error('MM SSE base_resp ' + Number(o.base_resp.status_code) + ' ' + String(o.base_resp.status_msg || ''));
          ee.kind = classifyError(200, JSON.stringify(o));
          ee.baseCode = Number(o.base_resp.status_code);
          ee.body = o;
          throw ee;
        }
        if (o.type === 6 && o.agent_message_chunk && typeof o.agent_message_chunk.msg_content === 'string') streamed += o.agent_message_chunk.msg_content;
        if (o.type === 2 && o.agent_message) {
          if (o.agent_message.role === 'assistant') final = o.agent_message.msg_content || final;
          if (o.agent_message.turn_id) turnId = String(o.agent_message.turn_id);
        }
        if (o.turn_id) turnId = String(o.turn_id);
      }
    }
    // Server kadang membalas JSON biasa (bukan SSE) berisi base_resp error, mis.
    // sesi dimiliki akun lain (1406010061) atau kredit habis. Tanpa cek ini
    // error hilang diam-diam dan jawabannya kosong tanpa rotasi.
    if (!frames.length) {
      const trimmed = rawAll.trim();
      if (trimmed && !trimmed.startsWith('data:')) {
        let j = null;
        try { j = JSON.parse(trimmed); } catch { j = null; }
        if (j && baseStatus(j) !== 0) {
          const e = new Error('MM POST message base_resp ' + baseStatus(j) + ' ' + baseMessage(j));
          e.kind = classifyError(200, trimmed);
          e.baseCode = baseStatus(j);
          e.baseMsg = baseMessage(j);
          e.body = j;
          throw e;
        }
      }
    }
    return { text: (final || streamed).trim(), streamed: streamed.trim(), turnId, frameTypes: frames.map((f) => f && f.type) };
  }

  // --- Credit & check-in ---
  async credit(token) {
    const j = await this.req({ method: 'GET', path: '/minimax-cloud/api/v1/credit/details', token });
    const details = (j && j.details) || [];
    const num = (x) => Number(x || 0);
    return {
      remaining: details.reduce((s, d) => s + num(d.remaining_amount), 0),
      granted: details.reduce((s, d) => s + num(d.granted_amount), 0),
      consumed: details.reduce((s, d) => s + num(d.consumed_amount), 0),
      entries: details.length, raw: details,
    };
  }
  async signinStatus(token) {
    const j = await this.req({ method: 'GET', path: '/minimax-cloud/api/v1/signin/status', query: { timezone_id: this.timezone }, token });
    const days = (j && j.data && j.data.days) || [];
    const today = days.find((d) => d.is_today) || null;
    return { claimedToday: !!(today && today.status === 3), today, days };
  }
  // Query lengkap check-in (dibuktikan live 2026-11-28: claim_result=1, points=400).
  claimQuery(extra = {}) {
    return Object.assign({
      device_platform: 'web', biz_id: 'mcode', app_id: 'mcode', version_code: '1',
      unix: String(Math.floor(Date.now() / 1000)), timezone_offset: '480',
      timezone_id: this.timezone, lang: 'id', sys_language: 'id',
      uuid: 'gibran-relay-1900', device_id: 'gibran-relay-1900',
      os_name: 'Windows', browser_name: 'Chrome', device_memory: '8', cpu_core_num: '6',
      browser_language: 'id-ID', browser_platform: 'Win32',
      screen_width: '1920', screen_height: '1080', client: 'desktop',
    }, extra);
  }
  async claimSignin(token, extra = {}) {
    const j = await this.req({ method: 'POST', path: '/minimax-cloud/api/v1/signin/claim', body: {}, query: this.claimQuery(extra), token });
    const d = (j && j.data) || {};
    return { claimResult: Number(d.claim_result || 0), points: Number(d.points || 0), dayNo: d.day_no };
  }
}

export async function refreshOAuth({ tokenUrl, clientId, scope, audience, refreshToken, timeoutMs = 20000 }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: clientId, scope, audience,
  });
  // Timeout WAJIB: refresh yang menggantung akan membekukan giliran bot
  // (rotasi BERHENTI di akun itu, chat jadi macet).
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'MiniMax Code/3.1.17' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const txt = await res.text();
  let t = {}; try { t = JSON.parse(txt); } catch { /* biarkan */ }
  if (!res.ok || !t.access_token) {
    const e = new Error('refresh OAuth gagal HTTP ' + res.status + ' ' + txt.slice(0, 160));
    e.kind = /invalid_grant/.test(txt) ? 'invalid_grant' : 'refresh_error';
    e.status = res.status;
    throw e;
  }
  return { accessToken: t.access_token, refreshToken: t.refresh_token || refreshToken, expiresAtMs: Date.now() + Number(t.expires_in || 43200) * 1000 };
}