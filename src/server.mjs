import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CFG } from './config.mjs';
import { state, saveStore, getSession, setSession } from './store.mjs';
import { log, recentLogs } from './log.mjs';
import {
  pool, ensureAccount, handleCreditExhausted, chainLabels, currentAccount,
  rotate, rotateRobust, creditSummary, signinStatus, claimCheckin, importChainFromEnv, mergeChainFromBody,
  leaseForChat, setChatLease, clearChatLease, migrateChatContext, tokenForLabel, agentIdForLabel,
  armFault, clearFault, faultFor,
} from './supervisor.mjs';
import { runExec } from './mcode.mjs';
import {
  sendMessage, editMessageText, sendChatAction, getMe, setWebhook, getWebhookInfo,
  sendPhoto, sendDocument, answerCallbackQuery, setMyCommands,
} from './telegram.mjs';
import { api as cloudApi, createSession as cloudCreateSession, postMessage as cloudPost, ERR, cloud as cloudClient } from './minimax.mjs';
import { buildContextBundle } from './context.mjs';
import { buildContextBrief } from './session-context.mjs';
import { formatAnswer, chunkText } from './format.mjs';
import {
  MAIN_MENU, APPLY_CONFIRM, MODE_MENU, BROWSER_MENU, toInlineKeyboard,
  CB_SCAN, CB_CV, CB_APPLY, CB_STATUS, CB_BROWSER, CB_MODE_CONFIRM, CB_MODE_AUTO,
  CB_APPLY_YES, CB_APPLY_NO, CB_REMOTE, CB_TAKEOVER, CB_RESUME, CB_BACK, CB_RELOAD,
} from './keyboard.mjs';
import { listDrive, pickNewNodes, sendableFiles, imageBytes, downloadFile, seenKey } from './cloud-files.mjs';
import { FrameRelay } from './cloud-browser.mjs';
import { FrameCache } from './frame-cache.mjs';
import { renderLiveView, renderRemoteHelp } from './live-view.mjs';
import {
  getProfile, setMode, patchProfile, assignStickyAccount,
  canApply, markApplied, userContextBlock, exportForOps,
} from './users.mjs';
import { listProfiles, loadProfile } from './user-store.mjs';
import { buildSearchPlan } from './linkedin/search.mjs';
import { buildApplyPlan, buildApplyMessage, shouldStop } from './linkedin/apply.mjs';
import * as orch from './orchestrator.mjs';

const CONTEXT = buildContextBundle();
const busy = new Map();
const lastError = { message: '', at: 0 };

// --- Permukaan baru: tombol, berkas, live view browser ----------------------
const frameCache = new FrameCache({ dir: path.join(CFG.dataDir, 'frames') });
const frameRelay = new FrameRelay({ cloud: cloudClient, cache: frameCache });

// Token live view per user: tautannya hanya dikirim ke chat user itu.
function viewTokenFor(chatId) {
  const p = getProfile(chatId);
  if (p && p.viewToken) return p.viewToken;
  const t = crypto.randomBytes(16).toString('hex');
  try { patchProfile(chatId, { viewToken: t }); } catch { /* abaikan */ }
  return t;
}

function chatByToken(token) {
  if (!token) return null;
  let list = [];
  try { list = listProfiles() || []; } catch { list = []; }
  for (const p of list) {
    const chatId = String((p && p.chatId) || '');
    if (!chatId) continue;
    try {
      // listProfiles hanya mengembalikan ringkasan, jadi profilnya dibaca penuh.
      const full = loadProfile(chatId);
      if (full && full.viewToken && full.viewToken === token) return chatId;
    } catch { /* abaikan */ }
  }
  return null;
}

function liveUrlFor(chatId) {
  const base = CFG.publicUrl ? CFG.publicUrl : '';
  return base + '/browser/view?token=' + encodeURIComponent(viewTokenFor(chatId));
}

// Kirim berkas baru dari drive ke user (foto/dokumen).
async function deliverFiles(chatId, token, seen) {
  let nodes = [];
  try {
    nodes = await listDrive({ token, keepOld: true });
  } catch (e) {
    log('gagal baca drive: ' + String((e && e.message) || e).slice(0, 120));
    return 0;
  }
  const fresh = pickNewNodes(nodes, seen || []);
  const files = sendableFiles(fresh);
  let sent = 0;
  for (const node of files) {
    if (sent >= orch.TURN.maxFiles) break;
    try {
      if (/^image\//.test(node.mime)) {
        const buf = await imageBytes(node, token);
        await sendPhoto(chatId, buf, node.name);
      } else {
        const buf = await downloadFile(node.cdnUrl, token);
        await sendDocument(chatId, buf, node.name, '');
      }
      sent += 1;
    } catch (e) {
      log('gagal kirim berkas ' + node.name + ': ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  if (sent) {
    const next = (seen || []).slice();
    for (const node of fresh) next.push(seenKey(node));
    try { patchProfile(chatId, { seenDriveNodes: next.slice(-80) }); } catch { /* abaikan */ }
  }
  return sent;
}

// Instruksi live view user -> diteruskan ke sesi cloud yang sama.
async function relayInstruction(chatId, action) {
  const lease = leaseForChat(chatId);
  if (!lease || !lease.sessionId) return { ok: false, error: 'belum ada sesi browser' };
  const built = frameRelay.sendInstruction(chatId, action);
  if (!built || !built.ok) return { ok: false, error: 'aksi tidak dikenal' };
  try {
    const token = await tokenForLabel(lease.label);
    const agentId = await agentIdForLabel(lease.label);
    const out = await cloudPost(lease.sessionId, built.message, { token, sender: { agent_name: agentId } });
    return { ok: true, reply: (out && out.text) || '' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
  }
}

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
    let sessionId = prev ? prev.sessionId : null;
    let prompt = text;
    for (let attempt = 1; attempt <= CFG.maxAttempts; attempt++) {
      result = await runExec({
        cwd,
        sessionId: sessionId,
        prompt: prompt,
        onEvent,
      });
      if (!result.creditError && !result.authError) break;
      if (result.creditError) {
        log('turn gagal karena kredit (percobaan ' + attempt + ')');
        const act = await handleCreditExhausted();
        log('supervisor: ' + act.action + (act.label ? ' -> ' + act.label : ''));
        if (act.action === 'rotated' || act.action === 'rotate-failed') {
          const brief = buildContextBrief(sessionId);
          if (brief) { sessionId = null; prompt = brief + text; log('akun ganti -> sesi baru, konteks dipindah (' + brief.length + ' karakter)'); }
        }
        progress = '';
        continue;
      }
      if (result.authError) {
        log('token ditolak -> rotasi ke akun lain');
        let rotated = false;
        try {
          const r = await rotateRobust();
          log('rotasi setelah auth error -> ' + r.label);
          rotated = true;
        } catch (e) {
          log('rotasi gagal: ' + String((e && e.message) || e).slice(0, 140));
          await ensureAccount();
        }
        if (rotated) {
          // Sesi MCode terikat akun pembuatnya -> setelah rotasi harus pakai sesi baru.
          const brief = buildContextBrief(sessionId);
          if (brief) { sessionId = null; prompt = brief + text; log('akun ganti -> sesi baru, konteks dipindah (' + brief.length + ' karakter)'); }
        }
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

// Kirim satu giliran ke agen cloud, kembalikan balasan + konteks.
async function cloudTurn(chatId, text) {
  const key = String(chatId);
  // 1) lease: chat -> {label akun, sessionId}. Sesi milik akun pembuatnya.
  const lease = leaseForChat(key);
  let label = lease && lease.label;
  let sid = lease && lease.sessionId;
  let first = false;
  let token = null;
  if (!label || !sid) {
    // Akun sticky per user: memisahkan memori agen antar pengguna.
    let acc = null;
    try {
      const sticky = await assignStickyAccount(key, { pool });
      acc = { label: sticky.label, agentId: sticky.agentId, accessToken: await tokenForLabel(sticky.label) };
    } catch (e) {
      log('gagal ambil akun sticky: ' + String((e && e.message) || e).slice(0, 120));
    }
    if (!acc) {
      const fb = await ensureAccount();
      acc = { label: fb.label, agentId: fb.agentId, accessToken: fb.accessToken };
    }
    label = acc.label;
    token = acc.accessToken;
    sid = await cloudCreateSession(acc.agentId, 'gibran-bot-' + key, acc.accessToken);
    first = true;
    setChatLease(key, { label, sessionId: sid, agentId: acc.agentId, owner: label, mode: 'cloud' });
  }
  const content = first
    ? CONTEXT + '\n\n' + userContextBlock(key) + '\n\n---\n\n# PESAN PENGGUNA PERTAMA (Telegram)\n\n' + text
    : text;
  let reply = '';
  let path = 'direct';
  try {
    // Fault injection (hanya aktif lewat /ops/lease) untuk menguji rotasi kredit.
    const injected = faultFor(key);
    if (injected) {
      const fe = new Error('fault injection: ' + injected);
      fe.kind = injected === 'credit' ? ERR.CREDIT : ERR.OWNERSHIP;
      throw fe;
    }
    const tok = token || await tokenForLabel(label);
    const out = await cloudPost(sid, content, { token: tok, sender: { agent_name: await agentIdForLabel(label) } });
    reply = (out && out.text) || '';
  } catch (e) {
    const kind = e && e.kind;
    if (kind !== ERR.OWNERSHIP && kind !== ERR.CREDIT && kind !== ERR.AUTH && kind !== ERR.SESSION_BUSY) throw e;
    log('turn gagal (' + kind + ') -> check-in / rotasi / migrasi konteks');
    let rotatedLabel = '';
    // Sesi macet (turn lama masih jalan / sesi dari deploy sebelumnya):
    // buat sesi BARU di akun yang sama dan pindahkan konteks. Akun tidak
    // perlu diganti, jadi tidak ada rotasi kredit.
    if (kind === ERR.SESSION_BUSY) {
      const r = await migrateChatContext(key, label, label, content, CONTEXT);
      reply = (r && r.reply) || '';
      path = 'resumed';
      log('sesi tidak idle -> sesi baru ' + r.newSessionId + ' di ' + label
        + ' (' + r.exportedCount + ' pesan, brief ' + r.briefChars + ' char)');
      try { await cloudApi('/minimax-cloud/api/v1/session/' + encodeURIComponent(sid) + '/archive', { method: 'POST', token: await tokenForLabel(label) }); } catch { /* abaikan */ }
    }
    // a) kredit habis -> klaim check-in harian lalu ulangi di akun yang sama
    if (kind === ERR.CREDIT) {
      const act = await handleCreditExhausted();
      log('supervisor: ' + act.action + (act.label ? ' -> ' + act.label : ''));
      if (act.action === 'rotated') rotatedLabel = act.label;
      if (act.action === 'claimed') {
        try {
          const tok = token || await tokenForLabel(label);
          const out = await cloudPost(sid, content, { token: tok, sender: { agent_name: await agentIdForLabel(label) } });
          reply = (out && out.text) || '';
        } catch { /* tetap lanjut ke rotasi */ }
      }
    }
    // b) masih gagal -> rotasi akun + pindahkan konteks (export -> sesi baru -> inject)
    if (!reply) {
      // Kalau rotasi sudah dilakukan di atas (kredit habis), pakai akun itu
      // sebagai target migrasi - jangan rotasi lagi, satu akun jadi terbuang.
      const next = rotatedLabel ? { label: rotatedLabel } : await rotateRobust();
      const r = await migrateChatContext(key, label, next.label, content, CONTEXT);
      reply = (r && r.reply) || '';
      path = 'migrated';
      log('konteks dipindah ' + label + ' -> ' + next.label + ' (' + r.exportedCount + ' pesan, brief ' + r.briefChars + ' char)');
    }
  }
  return { reply, path, label, sid, token: token || await tokenForLabel(label) };
}

// Format jawaban, kirim ke Telegram, lalu berkas dan frame browser.
async function deliverTurn(chatId, text) {
  const key = String(chatId);
  const r = await cloudTurn(chatId, text);
  const formatted = formatAnswer(r.reply);
  const body = (formatted.text || '').trim() || 'Maaf, jawaban kosong. Coba ulangi ya.';
  setChatLease(key, {
    lastReply: body.slice(0, 900),
    lastReplyAt: Date.now(),
    lastPath: r.path,
    lastAction: 'text',
  });
  const chunks = chunkText(body, CFG.telegram.maxChars);
  const list = Array.isArray(chunks) ? chunks : [String(chunks || body)];
  await sendMessage(chatId, list[0] || body, { reply_markup: toInlineKeyboard(MAIN_MENU) });
  for (const extra of list.slice(1)) await sendMessage(chatId, extra);
  if (formatted.truncated && String(r.reply || '').length > 1500) {
    try {
      await sendDocument(chatId, Buffer.from(String(r.reply), 'utf8'), 'jawaban-lengkap.txt', 'Jawaban lengkap');
    } catch { /* abaikan */ }
  }
  try {
    await deliverFiles(key, r.token, getProfile(key).seenDriveNodes);
  } catch (e) {
    log('gagal kirim berkas: ' + String((e && e.message) || e).slice(0, 120));
  }
  if (orch.needsBrowser(text)) {
    try {
      await frameRelay.start(key, r.token);
      const fr = await frameRelay.getFrame(key);
      const file = fr && (fr.path || fr.filePath);
      if (file && fs.existsSync(file)) {
        const step = (fr.meta && fr.meta.step) || 'sedang berjalan';
        await sendPhoto(chatId, fs.readFileSync(file), 'Browser live - ' + step + '\n' + liveUrlFor(key));
      }
    } catch (e) {
      log('relay frame gagal: ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  return r;
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
  // Deklarasi di luar try: finally tidak bisa melihat variabel di dalam blok try.
  let path = 'direct';
  let recorded = false;
  try {
    const r = await deliverTurn(chatId, text);
    path = r.path;
    recorded = true;
  } catch (e) {
    lastError.message = String((e && e.message) || e).slice(0, 400);
    lastError.at = Date.now();
    const lease = leaseForChat(key);
    if (!lease || !lease.lastReplyAt) path = 'error';
    log('ERROR cloud chat ' + key + ': ' + lastError.message);
    try {
      await sendMessage(chatId, '⚠️ Gagal memproses: ' + lastError.message.slice(0, 200));
    } catch { /* abaikan */ }
  } finally {
    clearFault(key);
    if (!recorded) { try { setChatLease(key, { lastPath: path }); } catch { /* abaikan */ } }
    stopTyping();
    busy.delete(key);
  }
}

const BOT_COMMANDS = [
  { command: 'help', description: 'Bisa apa saja dan pintasan cepat' },
  { command: 'resume', description: 'Lengkapi CV master' },
  { command: 'scan', description: 'Cari lowongan baru' },
  { command: 'apply', description: 'Siapkan bahan lamaran' },
  { command: 'dream', description: 'Kelola dream companies' },
  { command: 'summary', description: 'Ringkasan progres' },
  { command: 'status', description: 'Status pencarian' },
  { command: 'browser', description: 'Live view browser' },
  { command: 'mode', description: 'Mode kirim lamaran' },
  { command: 'stop', description: 'Hentikan aksi yang sedang jalan' },
];

const HELP_TEXT = [
  'Saya Gibran.ai, asisten cari kerja. Yang bisa kamu pakai:',
  '',
  'Cari lowongan - saya buka LinkedIn, kumpulkan lowongan yang cocok, simpan jadi CSV.',
  'Apply - saya siapkan CV tailor dan cover letter, lalu kirim setelah kamu setuju.',
  'CV - lengkapi CV master satu per satu.',
  'Status - ringkasan progres lamaran.',
  'Browser live - lihat dan ambil alih browser yang saya jalankan.',
  'Mode - pilih konfirmasi dulu atau auto submit.',
  '',
  'Perintah: /help /resume /scan /apply /dream /summary /status /browser /mode /stop',
].join('\n');

const PROMPT_SCAN = 'Cari lowongan baru sesuai preferensi saya. Ikuti protokol frame browser: tulis frame_latest.png dan frame_status.json setiap langkah penting, simpan hasil ke /workspace/output/Job_Listings.csv, lalu ringkas temuan dalam pesan pendek.';
const PROMPT_CV = 'Lengkapi CV master saya. Tanya satu data per giliran, jangan menggila.';
const PROMPT_APPLY = 'Siapkan bahan lamaran untuk lowongan yang saya pilih: resume_tailored.md, cover_letter.md, followup_email.md, isi formulir di browser, tampilkan ringkasan plus screenshot, dan tunggu persetujuan saya sebelum submit.';

async function handleCommand(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = String((msg && msg.text) || '').trim();
  if (!chatId || !text.startsWith('/')) return false;
  const key = String(chatId);
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');
  if (cmd === '/start') {
    await sendMessage(chatId,
      'Halo! Saya Gibran.ai.\n\nSaya bantu kamu mencari kerja: bikin CV, cari lowongan di LinkedIn, cocokkan CV dengan lowongan, dan menyiapkan bahan lamaran sampai dikirim.\n\nMulai dari sini:',
      { reply_markup: toInlineKeyboard(MAIN_MENU) });
    return true;
  }
  if (cmd === '/help') {
    await sendMessage(chatId, HELP_TEXT, { reply_markup: toInlineKeyboard(MAIN_MENU) });
    return true;
  }
  if (cmd === '/browser') {
    await sendMessage(chatId,
      'Live view browser:\n' + liveUrlFor(key) + '\n\nBuka tautannya untuk melihat browser yang saya jalankan. Di halaman itu ada tombol Ambil alih, Kembali ke bot, Back, dan Reload.',
      { reply_markup: toInlineKeyboard(BROWSER_MENU) });
    return true;
  }
  if (cmd === '/mode') {
    const p = getProfile(key);
    await sendMessage(chatId,
      'Mode sekarang: ' + (p.mode === 'auto' ? 'auto submit' : 'konfirmasi') + '.\n\n'
      + '- Konfirmasi: saya siapkan, kamu setuju sekali ketuk baru terkirim.\n'
      + '- Auto submit: saya kirim sendiri, batas ' + p.applyDailyCap + ' per hari, berhenti kalau ada captcha.',
      { reply_markup: toInlineKeyboard(MODE_MENU) });
    return true;
  }
  if (cmd === '/stop') {
    frameRelay.releaseManual(key);
    frameRelay.stop(key);
    patchProfile(key, { manual: false });
    await sendMessage(chatId, 'Selesai. Aksi browser yang sedang jalan saya hentikan.');
    return true;
  }
  const prompts = {
    '/resume': PROMPT_CV,
    '/scan': PROMPT_SCAN,
    '/apply': PROMPT_APPLY,
    '/dream': 'Kelola dream companies saya: careers page, kontak, berita tiga bulan terakhir, arah perusahaan.',
    '/summary': 'Beri ringkasan progres pencarian kerja saya dan simpan ringkasannya.',
    '/status': 'Beri ringkasan status: lowongan aktif, yang sudah dilamar, dan langkah berikutnya.',
  };
  if (prompts[cmd]) {
    await deliverTurn(chatId, prompts[cmd] + (rest ? ' (' + rest + ')' : ''));
    return true;
  }
  return false;
}

async function handleCallbackQuery(update) {
  const cq = update && update.callback_query;
  if (!cq) return;
  const data = String(cq.data || '');
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  if (!chatId) return;
  const key = String(chatId);
  try { await answerCallbackQuery(cq.id, ''); } catch { /* abaikan */ }
  const say = async (text, keyboard) => {
    await sendMessage(chatId, text, keyboard ? { reply_markup: toInlineKeyboard(keyboard) } : undefined);
  };
  if (data === CB_MODE_CONFIRM || data === CB_MODE_AUTO) {
    const mode = data === CB_MODE_AUTO ? 'auto' : 'confirm';
    setMode(key, mode);
    const p = getProfile(key);
    await say(mode === 'auto'
      ? 'Mode auto submit aktif. Saya boleh mengirim lamaran sendiri, batas ' + p.applyDailyCap + ' per hari. Kalau captcha muncul, saya berhenti dan melapor.'
      : 'Mode konfirmasi aktif. Saya siapkan lamaran dan menampilkan ringkasan plus screenshot, kamu tinggal satu ketuk untuk mengizinkan kirim.', MODE_MENU);
    return;
  }
  if (data === CB_BROWSER) {
    await say('Live view browser:\n' + liveUrlFor(key) + '\n\nBuka untuk melihat dan mengambil alih browser yang saya jalankan.', BROWSER_MENU);
    return;
  }
  if (data === CB_REMOTE) {
    await say(renderRemoteHelp('https://agent.minimax.io'), BROWSER_MENU);
    return;
  }
  if (data === CB_TAKEOVER) {
    patchProfile(key, { manual: true });
    await say('Siap, kamu memegang kontrol. Klik atau ketik di halaman live view, lalu tekan Kembali ke bot kalau selesai.');
    return;
  }
  if (data === CB_RESUME) {
    patchProfile(key, { manual: false });
    frameRelay.releaseManual(key);
    await say('Oke, saya lanjut lagi.');
    return;
  }
  if (data === CB_BACK || data === CB_RELOAD) {
    const r = await relayInstruction(key, { type: data === CB_BACK ? 'back' : 'reload' });
    await say(r.ok ? 'Selesai: ' + (r.reply || 'aksi dijalankan') : 'Gagal: ' + (r.error || 'tidak ada sesi aktif'));
    return;
  }
  if (data === CB_APPLY_YES) {
    await deliverTurn(chatId, 'Setujui: kirim lamaran yang sudah saya siapkan sekarang. Isi dan submit formulirnya.');
    return;
  }
  if (data === CB_APPLY_NO) {
    await deliverTurn(chatId, 'Batalkan lamaran ini. Jangan kirim apa pun, tapi simpan bahan lamaran yang sudah dibuat.');
    return;
  }
  const actions = {
    [CB_SCAN]: PROMPT_SCAN,
    [CB_CV]: PROMPT_CV,
    [CB_APPLY]: PROMPT_APPLY,
    [CB_STATUS]: 'Beri ringkasan status: lowongan aktif, yang sudah dilamar, dan langkah berikutnya.',
  };
  if (actions[data]) {
    await deliverTurn(chatId, actions[data]);
    return;
  }
  log('callback tidak dikenal: ' + data);
}

async function handleUpdate(update) {
  log('update diterima, message=' + !!(update && update.message) + ' callback=' + !!(update && update.callback_query));
  if (update && update.callback_query) return handleCallbackQuery(update);
  if (!update || !update.message) return;
  const msg = update.message;
  if (await handleCommand(msg)) return;
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
      // Mode runtime-local tidak memakai endpoint cloud-agent, jadi check cloud
      // hanya informatif di mode itu (token LLM sudah divalidasi oleh turn nyata).
      out.ok = out.telegram && out.mcode && (out.cloud || CFG.mode === 'runtime-local');
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

  if (req.method === 'POST' && p === '/ops/chain') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 3 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      let n = 0;
      if (body && Array.isArray(body.accounts)) {
        n = mergeChainFromBody(body.accounts);
      } else {
        n = importChainFromEnv();
      }
      send(res, 200, { ok: true, total: n, chain: chainLabels() });
    });
    return undefined;
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
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      (async () => {
        try {
          const r = await rotateRobust(typeof body.index === 'number' ? body.index : undefined);
          return send(res, 200, { ok: true, current: r.label, agentId: r.agentId, chain: chainLabels() });
        } catch (e) {
          return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 250) });
        }
      })();
    });
    return undefined;
  }

  // Hook uji: paksa lease chat ke akun lain / nyala fault kredit.
  // Dipakai untuk membuktikan rotasi akun tanpa kehilangan konteks.
  if (req.method === 'POST' && p === '/ops/lease') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      (async () => {
        try {
          const chatId = String(body.chatId || '').trim();
          if (!chatId) return send(res, 400, { ok: false, error: 'chatId wajib' });
          if (body.clear) {
            clearChatLease(chatId);
            clearFault(chatId);
            return send(res, 200, { ok: true, cleared: true, chatId });
          }
          if (body.fault) armFault(chatId, String(body.fault));
          else if (body.clearFault) clearFault(chatId);
          const patch = {};
          if (body.label) patch.label = String(body.label);
          if (body.sessionId) patch.sessionId = String(body.sessionId);
          if (body.owner) patch.owner = String(body.owner);
          if (body.agentId) patch.agentId = String(body.agentId);
          if (Object.keys(patch).length) setChatLease(chatId, patch);
          return send(res, 200, {
            ok: true,
            chatId,
            lease: leaseForChat(chatId),
            fault: faultFor(chatId),
            poolCurrent: state.accounts.currentLabel,
            chainSize: chainLabels().length,
          });
        } catch (e) {
          return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 250) });
        }
      })();
    });
    return undefined;
  }

  if (req.method === 'POST' && p === '/ops/claim') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      try {
        const r = await claimCheckin();
        return send(res, 200, Object.assign({ ok: true }, r));
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

  // Log internal container (ring buffer) --gunanya untuk diagnosa saat live.
  if (req.method === 'GET' && p === '/ops/logs') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return send(res, 200, { ok: true, lines: recentLogs(url.searchParams.get('limit')) });
  }

  // Kesehatan pool akun: berapa yang mati / kedaluwarsa / punya token valid.
  if (req.method === 'GET' && p === '/ops/pool') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    const now = Date.now();
    let dead = 0; let expired = 0; let valid = 0; let noToken = 0;
    for (const a of pool.accounts) {
      if (!a) continue;
      if (a.dead) { dead++; continue; }
      const exp = Number(a.expiresAtMs || 0);
      if (!a.accessToken) noToken++;
      else if (exp && exp - now > 5 * 60 * 1000) valid++;
      else expired++;
    }
    return send(res, 200, {
      ok: true,
      total: pool.accounts.length,
      dead, expired, valid, noToken,
      currentIndex: pool.currentIndex,
      currentLabel: state.accounts.currentLabel,
      leaseCount: pool.leaseCount(),
    });
  }

  // Diagnostik egress: cek host yang dipakai bot (cloud API + OAuth).
  if (req.method === 'GET' && p === '/ops/netcheck') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return (async () => {
      const results = [];
      const probes = [
        { name: 'cloud-api GET', method: 'GET', url: CFG.mm.base + '/minimax-cloud/api/v1/agent' },
        { name: 'oauth GET', method: 'GET', url: CFG.mm.tokenUrl },
        {
          name: 'oauth POST', method: 'POST', url: CFG.mm.tokenUrl,
          body: 'grant_type=refresh_token&refresh_token=probe-invalid&client_id=' + encodeURIComponent(CFG.mm.clientId),
        },
        {
          name: 'cloud-api POST', method: 'POST', url: CFG.mm.base + '/minimax-cloud/api/v1/signin/claim',
          body: '{}', json: true,
        },
      ];
      for (const t of probes) {
        const t0 = Date.now();
        try {
          const res = await fetch(t.url, {
            method: t.method,
            signal: AbortSignal.timeout(15000),
            headers: {
              'user-agent': 'MiniMax Code/3.1.17',
              ...(t.json ? { 'content-type': 'application/json' } : { 'content-type': 'application/x-www-form-urlencoded' }),
            },
            body: t.body,
          });
          const txt = await res.text().catch(() => '');
          results.push({
            name: t.name, host: new URL(t.url).host, method: t.method,
            status: res.status, ms: Date.now() - t0, snippet: txt.slice(0, 90),
          });
        } catch (e) {
          results.push({
            name: t.name, host: new URL(t.url).host, method: t.method,
            error: String((e && e.message) || e).slice(0, 160), ms: Date.now() - t0,
          });
        }
      }
      return send(res, 200, { ok: true, results });
    })();
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

  // ---- Live view browser (halaman web, frame, dan input user) ----
  if (req.method === 'GET' && p === '/browser/view') {
    const token = url.searchParams.get('token') || '';
    const chatId = chatByToken(token);
    if (!chatId) return send(res, 401, { ok: false, error: 'token live view salah' });
    return (async () => {
      let status = null;
      try { status = await frameRelay.getStatus(chatId); } catch { status = null; }
      const html = renderLiveView({ token, chatId, status, frameUrl: '/browser/frame.jpg' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    })();
  }

  if (req.method === 'GET' && p === '/browser/frame.jpg') {
    const token = url.searchParams.get('token') || '';
    const chatId = chatByToken(token);
    if (!chatId) return send(res, 401, { ok: false, error: 'token live view salah' });
    return (async () => {
      let file = null;
      try {
        const fr = await frameRelay.getFrame(chatId);
        file = fr && (fr.path || fr.filePath);
      } catch { file = null; }
      if (!file || !fs.existsSync(file)) return send(res, 202, { ok: false, error: 'belum ada frame' });
      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': buf.length,
        'cache-control': 'no-store',
      });
      res.end(buf);
    })();
  }

  if (req.method === 'POST' && p === '/browser/input') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
      (async () => {
        const token = String(body.token || '');
        const chatId = chatByToken(token);
        if (!chatId) return send(res, 401, { ok: false, error: 'token live view salah' });
        const action = {
          type: String(body.type || 'click'),
          x: Number(body.x || 0),
          y: Number(body.y || 0),
          text: String(body.text || ''),
          key: String(body.key || ''),
          url: String(body.url || ''),
        };
        const r = await relayInstruction(chatId, action);
        return send(res, r.ok ? 200 : 500, { ok: r.ok, reply: r.reply || '', error: r.error || '' });
      })();
    });
    return undefined;
  }

  // ---- Peta user -> akun (tanpa token) ----
  if (req.method === 'GET' && p === '/ops/users') {
    if (!opsOk(req)) return send(res, 401, { ok: false, error: 'token ops salah' });
    return send(res, 200, { ok: true, users: exportForOps() });
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
  try {
    await setMyCommands(BOT_COMMANDS);
    log('perintah bot didaftarkan: ' + BOT_COMMANDS.length);
  } catch (e) {
    log('gagal daftar perintah: ' + String((e && e.message) || e).slice(0, 120));
  }
  // Webhook harus mengizinkan callback_query, kalau tidak tombol tidak pernah
  // sampai ke bot. Daftar ulang kalau allowed_updates masih kurang.
  try {
    const info = await getWebhookInfo();
    const allowed = (info && info.allowed_updates) || [];
    const expected = CFG.publicUrl ? CFG.publicUrl + CFG.telegram.webhookPath : '';
    const urlOk = !!expected && String((info && info.url) || '') === expected;
    if (!allowed.includes('callback_query') || !urlOk) {
      if (!expected) {
        log('PUBLIC_BASE_URL kosong -> webhook tidak didaftarkan ulang');
      } else {
        await setWebhook(expected, CFG.telegram.webhookSecret);
        log('webhook didaftarkan ulang (callback_query=' + allowed.includes('callback_query')
          + ', url_ok=' + urlOk + ') -> ' + expected);
      }
    } else {
      log('webhook siap: callback_query aktif dan URL cocok');
    }
  } catch (e) {
    log('gagal cek webhook: ' + String((e && e.message) || e).slice(0, 140));
  }
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
