import http from 'node:http';
import path from 'node:path';
import { CFG } from './config.mjs';
import { state, saveStore, getSession, setSession } from './store.mjs';
import { log } from './log.mjs';
import {
  ensureAccount, handleCreditExhausted, chainLabels, currentAccount,
  rotate, creditSummary, signinStatus,
} from './supervisor.mjs';
import { runExec } from './mcode.mjs';
import {
  sendMessage, editMessageText, sendChatAction, getMe, setWebhook, getWebhookInfo,
} from './telegram.mjs';
import { api as cloudApi, createSession as cloudCreateSession, postMessage as cloudPost } from './minimax.mjs';
import { buildContextBundle } from './context.mjs';

const CONTEXT = buildContextBundle();
const busy = new Map();
const lastError = { message: '', at: 0 };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function opsOk(req) {
  return !CFG.opsToken || req.headers['x-ops-token'] === CFG.opsToken;
}

function workspaceFor(chatId) {
  return path.join(CFG.workspaceDir, 'users', String(chatId));
}

async function keepTyping(chatId) {
  const timer = setInterval(() => {
    sendChatAction(chatId, 'typing').catch(() => {});
  }, 5000);
  timer.unref && timer.unref();
  return () => clearInterval(timer);
}

async function handleRuntimeLocal(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = String((msg && msg.text) || '').trim();
  if (!chatId || !text) return;
  const key = String(chatId);
  if (busy.get(key)) {
    await sendMessage(chatId, '⏳ Masih memproses pesan sebelumnya, sebentar ya.');
    return;
  }
  busy.set(key, true);
  const stopTyping = await keepTyping(chatId);
  let placeholderId = null;
  let progress = '';
  let lastEdit = 0;
  const onEvent = (ev) => {
    if (!ev || ev.type !== 'item.updated') return;
    if (!ev.item || ev.item.type !== 'agent_message') return;
    if (typeof ev.item.contentDelta !== 'string') return;
    progress += ev.item.contentDelta;
    const now = Date.now();
    if (now - lastEdit < 1500) return;
    lastEdit = now;
    if (placeholderId) editMessageText(chatId, placeholderId, progress).catch(() => {});
  };
  try {
    await ensureAccount();
    const cwd = workspaceFor(chatId);
    const prev = getSession(key);
    const sent = await sendMessage(chatId, '⏳ Sedang bekerja...');
    placeholderId = sent[0] || null;
    log('turn mulai untuk chat ' + key + ' (placeholder=' + placeholderId + ')');
    let result = null;
    for (let attempt = 1; attempt <= CFG.maxAttempts; attempt++) {
      result = await runExec({
        cwd,
        sessionId: prev ? prev.sessionId : null,
        prompt: text,
        onEvent,
      });
      if (!result.creditError && !result.authError) break;
      if (result.creditError) {
        log('turn gagal karena kredit (percobaan ' + attempt + ')');
        const act = await handleCreditExhausted();
        log('supervisor: ' + act.action + (act.label ? ' -> ' + act.label : ''));
        progress = '';
        continue;
      }
      if (result.authError) {
        log('token ditolak, refresh ulang');
        await ensureAccount();
        progress = '';
        continue;
      }
    }
    if (!result) throw new Error('tidak ada hasil turn');
    if (result.sessionId) setSession(key, { sessionId: result.sessionId, cwd });
    if (!result.text) {
      lastError.message = 'turn tanpa teks: ' + String(result.stderr || result.status || '').slice(0, 300);
      lastError.at = Date.now();
      await sendMessage(chatId, '⚠️ Saya belum berhasil menyelesaikan itu. Coba ulangi sebentar lagi ya.');
      return;
    }
    const done = placeholderId ? await editMessageText(chatId, placeholderId, result.text) : false;
    if (!done) await sendMessage(chatId, result.text);
    log('chat ' + key + ' selesai (' + Math.round(result.durationMs / 1000) + ' dtk, ' + result.text.length + ' karakter)');
  } catch (e) {
    lastError.message = String((e && e.message) || e).slice(0, 400);
    lastError.at = Date.now();
    log('ERROR chat ' + key + ': ' + lastError.message);
    try {
      await sendMessage(chatId, '⚠️ Gagal memproses: ' + lastError.message.slice(0, 200));
    } catch { /* abaikan */ }
  } finally {
    stopTyping();
    busy.delete(key);
  }
}

async function handleCloudAgent(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = String((msg && msg.text) || '').trim();
  if (!chatId || !text) return;
  const key = String(chatId);
  if (busy.get(key)) {
    await sendMessage(chatId, '⏳ Masih memproses pesan sebelumnya, sebentar ya.');
    return;
  }
  busy.set(key, true);
  const stopTyping = await keepTyping(chatId);
  try {
    const token = await ensureAccount();
    const prev = getSession(key);
    let sid = prev && prev.sessionId;
    let first = false;
    if (!sid) {
      sid = await cloudCreateSession('gibran-bot-' + key);
      first = true;
    }
    const content = first
      ? CONTEXT + '\n\n---\n\n# PESAN PENGGUNA PERTAMA (Telegram)\n\n' + text
      : text;
    const out = await cloudPost(sid, content);
    setSession(key, { sessionId: sid, mode: 'cloud' });
    await sendMessage(chatId, (out.text || '').trim() || 'Maaf, jawaban kosong. Coba ulangi ya.');
  } catch (e) {
    lastError.message = String((e && e.message) || e).slice(0, 400);
    lastError.at = Date.now();
    log('ERROR cloud chat ' + key + ': ' + lastError.message);
    try { await sendMessage(chatId, '⚠️ Gagal memproses: ' + lastError.message.slice(0, 200)); } catch { /* abaikan */ }
  } finally {
    stopTyping();
    busy.delete(key);
  }
}

async function handleUpdate(update) {
  log('handleUpdate dipanggil, message=' + !!(update && update.message));
  if (!update || !update.message) return;
  const msg = update.message;
  const text = String(msg.text || '').trim();
  if (text.startsWith('/start')) {
    await sendMessage(msg.chat.id,
      'Halo! Saya Gibran.ai 🤖\n\nSaya membantu kamu mencari kerja: bikin CV, cari lowongan, cocokkan CV dengan lowongan, dan menyiapkan bahan lamaran.\n\nMulai dengan: email kamu + CV master (paste atau upload).');
    return;
  }
  if (CFG.mode === 'cloud-agent') return handleCloudAgent(msg);
  return handleRuntimeLocal(msg);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, {
      ok: true,
      service: 'gibran-bot',
      mode: CFG.mode,
      mcode: CFG.mcodeBin,
      accounts: chainLabels().length,
      currentAccount: state.accounts.currentLabel,
      sessions: Object.keys(state.sessions).length,
      contextChars: CONTEXT.length,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (req.method === 'GET' && p === '/ready') {
    return (async () => {
      const out = { ok: false, mode: CFG.mode, cloud: false, telegram: false, mcode: false };
      try {
        const j = await cloudApi('/minimax-cloud/api/v1/agent');
        out.cloud = !!(j && Array.isArray(j.agents) && j.agents.length);
        out.agentCount = (j && j.agents && j.agents.length) || 0;
      } catch (e) {
        out.cloudError = String((e && e.message) || e).slice(0, 160);
      }
      try {
        const me = await getMe();
        out.telegram = true;
        out.bot = me.username ? '@' + me.username : me.first_name;
      } catch (e) {
        out.telegramError = String((e && e.message) || e).slice(0, 160);
      }
      if (CFG.mode === 'runtime-local') {
        try {
          await ensureAccount();
          out.mcode = true;
          out.account = state.accounts.currentLabel;
        } catch (e) {
          out.accountError = String((e && e.message) || e).slice(0, 160);
        }
      } else {
        out.mcode = true;
      }
      out.ok = out.cloud && out.telegram && out.mcode;
      return send(res, out.ok ? 200 : 503, out);
    })();
  }

  if (req.method === 'GET' && p === '/ops/state') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return send(res, 200, {
      ok: true,
      mode: CFG.mode,
      accounts: {
        current: state.accounts.currentLabel,
        index: state.accounts.currentIndex,
        chain: chainLabels(),
        rotatedAt: state.accounts.rotatedAt,
      },
      sessions: state.sessions,
      lastError,
      updatedAt: state.updatedAt,
    });
  }

  if (req.method === 'GET' && p === '/ops/accounts') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      const out = { ok: true, current: state.accounts.currentLabel, chain: chainLabels() };
      try {
        const acc = currentAccount();
        if (acc && acc.accessToken) {
          out.credit = await creditSummary(acc.accessToken);
          out.signin = await signinStatus(acc.accessToken);
        }
      } catch (e) {
        out.error = String((e && e.message) || e).slice(0, 200);
      }
      return send(res, 200, out);
    })();
  }

  if (req.method === 'POST' && p === '/ops/rotate') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      try {
        const r = await rotate();
        return send(res, 200, { ok: true, current: r.label, chain: chainLabels() });
      } catch (e) {
        return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 250) });
      }
    })();
  }

  if (req.method === 'POST' && p === '/ops/exec') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      (async () => {
        try {
          await ensureAccount();
          const cwd = body.cwd || workspaceFor(body.chatId || 'ops');
          const r = await runExec({
            cwd,
            sessionId: body.sessionId || null,
            prompt: String(body.prompt || 'Balas tepat: PING-OK'),
          });
          return send(res, r.ok ? 200 : 500, {
            ok: r.ok,
            text: r.text,
            sessionId: r.sessionId,
            status: r.status,
            code: r.code,
            creditError: r.creditError,
            authError: r.authError,
            stderr: String(r.stderr || '').slice(-800),
            rawStdout: String(r.rawStdout || '').slice(-4000),
            events: r.events || [],
            durationMs: r.durationMs,
          });
        } catch (e) {
          return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
        }
      })();
    });
    return undefined;
  }

  if (req.method === 'GET' && p === '/ops/webhook') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      try { return send(res, 200, { ok: true, info: await getWebhookInfo() }); }
      catch (e) { return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
    })();
  }

  if (req.method === 'POST' && p === '/ops/set-webhook') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      const target = CFG.publicUrl + CFG.telegram.webhookPath;
      try { return send(res, 200, { ok: true, url: target, result: await setWebhook(target, CFG.telegram.webhookSecret) }); }
      catch (e) { return send(res, 500, { ok: false, url: target, error: String((e && e.message) || e).slice(0, 250) }); }
    })();
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
      let parseError = '';
      try { update = JSON.parse(raw || '{}'); } catch (e) { parseError = String((e && e.message) || e); }
      log('webhook masuk: ' + raw.length + ' byte, parse=' + (parseError ? 'GAGAL ' + parseError : 'ok') + ', adaMessage=' + !!update.message);
      handleUpdate(update).catch((e) => log('handleUpdate error: ' + String((e && e.message) || e)));
      return send(res, 200, { ok: true });
    });
    return undefined;
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(CFG.port, '0.0.0.0', async () => {
  log('gibran-bot listening di :' + CFG.port + ' mode=' + CFG.mode);
  log('konteks dimuat: ' + CONTEXT.length + ' karakter | chain akun: ' + chainLabels().length);
  if (CFG.mode === 'runtime-local') {
    try {
      const acc = await ensureAccount();
      log('akun aktif: ' + acc.label + ' (agent ' + acc.agentId + ')');
    } catch (e) {
      log('PERINGATAN: akun belum siap: ' + String((e && e.message) || e).slice(0, 200));
    }
  }
});

process.on('SIGTERM', () => { log('SIGTERM, keluar'); server.close(() => process.exit(0)); });
process.on('uncaughtException', (e) => log('uncaught: ' + String((e && e.stack) || e)));
process.on('unhandledRejection', (e) => log('unhandled: ' + String((e && e.stack) || e)));
