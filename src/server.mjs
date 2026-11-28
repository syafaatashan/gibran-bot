import http from 'node:http';
import { CFG } from './config.mjs';
import { loadStore, state, saveStore } from './store.mjs';
import { log } from './log.mjs';
import { api, createSession, postMessage } from './minimax.mjs';
import { sendMessage, getMe, setWebhook, getWebhookInfo } from './telegram.mjs';
import { buildContextBundle } from './context.mjs';

loadStore();
const CONTEXT = buildContextBundle();
log('konteks dimuat: ' + CONTEXT.length + ' karakter');
if (!CFG.mm.agentId) log('PERINGATAN: MM_AGENT_ID kosong');
if (!CFG.telegram.token) log('PERINGATAN: TELEGRAM_BOT_TOKEN kosong');

const busy = new Map();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function askCloud(sessionId, content) {
  try {
    return await postMessage(sessionId, content);
  } catch (e) {
    if (e && e.status === 401) {
      log('token ditolak (401), refresh lalu ulangi');
      await api('/minimax-cloud/api/v1/agent'); // paksa refresh internal
      return postMessage(sessionId, content);
    }
    throw e;
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;
  const text = String(msg.text || '').trim();
  if (!text) return;
  const key = String(chatId);

  if (busy.get(key)) {
    await sendMessage(chatId, '⏳ Masih memproses pesan sebelumnya. Sebentar ya.');
    return;
  }
  busy.set(key, true);
  const t0 = Date.now();
  try {
    let sid = state.sessions[key];
    let first = false;
    if (!sid) {
      sid = await createSession('gibran-bot-' + key);
      state.sessions[key] = sid;
      saveStore();
      first = true;
      log('sesi cloud baru ' + sid + ' untuk chat ' + key);
    }
    const content = first
      ? CONTEXT + '\n\n---\n\n# PESAN PENGGUNA PERTAMA (lewat Telegram)\n\n' + text
      : text;
    const out = await askCloud(sid, content);
    const reply = (out.text || '').trim() ||
      'Maaf, jawaban kosong. Coba kirim ulang pertanyaanmu ya.';
    await sendMessage(chatId, reply);
    log('chat ' + key + ' selesai dalam ' + ((Date.now() - t0) / 1000).toFixed(1) + 's (' + reply.length + ' karakter)');
  } catch (e) {
    const msgErr = String((e && e.message) || e).slice(0, 250);
    log('ERROR chat ' + key + ': ' + msgErr);
    try {
      await sendMessage(chatId, '⚠️ Gagal memproses: ' + msgErr);
    } catch { /* diamkan */ }
  } finally {
    busy.delete(key);
  }
}

async function handleUpdate(update) {
  if (update.message) await handleMessage(update.message);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, {
      ok: true,
      service: 'gibran-bot',
      agentId: CFG.mm.agentId,
      hasToken: !!state.tokens,
      tokenValidUntil: state.tokens ? new Date(state.tokens.expiresAtMs || 0).toISOString() : null,
      contextChars: CONTEXT.length,
      chats: Object.keys(state.sessions).length,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (req.method === 'GET' && p === '/ready') {
    return (async () => {
      const out = { ok: false, cloud: false, telegram: false, agentId: CFG.mm.agentId };
      try {
        const j = await api('/minimax-cloud/api/v1/agent');
        out.cloud = Array.isArray(j.agents) && j.agents.length > 0;
        out.agentName = j.agents && j.agents[0] && j.agents[0].name;
      } catch (e) {
        out.cloudError = String(e.message || e).slice(0, 160);
      }
      try {
        const me = await getMe();
        out.telegram = true;
        out.bot = me.username ? '@' + me.username : me.first_name;
      } catch (e) {
        out.telegramError = String(e.message || e).slice(0, 160);
      }
      out.ok = out.cloud && out.telegram;
      return send(res, out.ok ? 200 : 503, out);
    })();
  }

  if (req.method === 'GET' && p === '/ops/webhook') {
    if (CFG.opsToken && req.headers['x-ops-token'] !== CFG.opsToken) {
      return send(res, 401, { ok: false, error: 'token ops salah' });
    }
    return (async () => {
      try {
        return send(res, 200, { ok: true, info: await getWebhookInfo() });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e.message || e).slice(0, 200) });
      }
    })();
  }

  if (req.method === 'POST' && p === '/ops/set-webhook') {
    if (CFG.opsToken && req.headers['x-ops-token'] !== CFG.opsToken) {
      return send(res, 401, { ok: false, error: 'token ops salah' });
    }
    return (async () => {
      const target = CFG.publicUrl + CFG.telegram.webhookPath;
      try {
        const r = await setWebhook(target, CFG.telegram.webhookSecret);
        return send(res, 200, { ok: true, url: target, result: r });
      } catch (e) {
        return send(res, 500, { ok: false, url: target, error: String(e.message || e).slice(0, 250) });
      }
    })();
  }

  if (req.method === 'GET' && p === '/ops/sessions') {
    if (CFG.opsToken && req.headers['x-ops-token'] !== CFG.opsToken) {
      return send(res, 401, { ok: false, error: 'token ops salah' });
    }
    return send(res, 200, { ok: true, sessions: state.sessions });
  }

  if (req.method === 'POST' && p === CFG.telegram.webhookPath) {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (CFG.telegram.webhookSecret && secret !== CFG.telegram.webhookSecret) {
      return send(res, 401, { ok: false, error: 'secret webhook salah' });
    }
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      let update = {};
      try { update = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      handleUpdate(update).catch((e) => log('handleUpdate error: ' + String(e.message || e)));
      // Balas cepat supaya Telegram tidak retry.
      return send(res, 200, { ok: true });
    });
    return undefined;
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(CFG.port, '0.0.0.0', () => {
  log('gibran-bot listening di :' + CFG.port + ' (public ' + (CFG.publicUrl || '-') + ')');
});

process.on('SIGTERM', () => { log('SIGTERM, keluar'); server.close(() => process.exit(0)); });
process.on('uncaughtException', (e) => log('uncaught: ' + String(e && e.stack || e)));
process.on('unhandledRejection', (e) => log('unhandled: ' + String((e && e.stack) || e)));
