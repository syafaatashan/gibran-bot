import { CFG } from './config.mjs';
import { toInlineKeyboard } from './keyboard.mjs';
import { unduhBuffer, guessFilename, sniffMime, mimeFromUrl } from './media.mjs';

const apiUrl = (method) => 'https://api.telegram.org/bot' + CFG.telegram.token + '/' + method;
const MAX_CAPTION = 1024;

export function splitText(text, limit) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [''];
  const out = [];
  let rest = t;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.5)) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.length) out.push(rest);
  return out;
}

async function call(method, body) {
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ' gagal: ' + JSON.stringify(j).slice(0, 200));
  return j.result;
}

// kalau markdown tidak bisa diparse, kirim ulang tanpa parse_mode (isi tetap terbaca)
async function callLenient(method, body) {
  try {
    return await call(method, body);
  } catch (e) {
    if (body && body.parse_mode) {
      const retry = Object.assign({}, body);
      delete retry.parse_mode;
      return await call(method, retry);
    }
    throw e;
  }
}

// kirim multipart/form-data (buffer file atau URL sebagai field biasa)
async function callMultipart(method, fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null || v === '') continue;
    fd.append(k, String(v));
  }
  if (file && file.blob) fd.append(file.field, file.blob, file.filename);
  const res = await fetch(apiUrl(method), { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ' gagal: ' + JSON.stringify(j).slice(0, 200));
  return j.result;
}

export async function getMe() {
  const res = await fetch(apiUrl('getMe'));
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('getMe gagal: ' + JSON.stringify(j).slice(0, 160));
  return j.result;
}

export async function sendMessage(chatId, text, extra) {
  const opt = Object.assign({}, extra || {});
  delete opt.keyboard;
  const markup = opt.reply_markup || (extra && extra.keyboard ? toInlineKeyboard(extra.keyboard) : null);
  const chunks = splitText(text, CFG.telegram.maxChars);
  const ids = [];
  for (const c of chunks) {
    const body = Object.assign({ chat_id: chatId, text: c, disable_web_page_preview: true }, opt);
    if (markup) body.reply_markup = markup;
    const r = await callLenient('sendMessage', body);
    ids.push(r && r.message_id);
  }
  return ids;
}

// teks boleh pakai opsi: { keyboard, reply_markup, parse_mode }
export async function editMessageText(chatId, messageId, text, options) {
  const opt = options || {};
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text === undefined || text === null ? '' : text).slice(0, CFG.telegram.maxChars),
  };
  const markup = opt.reply_markup || (opt.keyboard ? toInlineKeyboard(opt.keyboard) : null);
  if (markup) body.reply_markup = markup;
  if (opt.parse_mode) body.parse_mode = opt.parse_mode;
  try {
    await callLenient('editMessageText', body);
    return true;
  } catch (e) {
    return false;
  }
}

export async function sendChatAction(chatId, action) {
  try {
    await call('sendChatAction', { chat_id: chatId, action: action || 'typing' });
  } catch {
    // abaikan
  }
}

// kirim foto: URL (Telegram yang mengunduh) atau Buffer (multipart upload)
export async function sendPhoto(chatId, source, caption) {
  const fields = { chat_id: chatId };
  const cap = capCaption(caption);
  if (cap) fields.caption = cap;
  if (typeof source === 'string' && source) {
    try {
      return await callMultipart('sendPhoto', Object.assign({ photo: source }, fields));
    } catch (e) {
      // fallback: unduh dulu, lalu upload sebagai file
      const buf = await unduhBuffer(source);
      const mime = mimeFromUrl(source) || sniffMime(buf) || 'image/jpeg';
      return await callMultipart('sendPhoto', fields, {
        field: 'photo',
        blob: new Blob([buf], { type: mime }),
        filename: guessFilename(source, mime, 'photo'),
      });
    }
  }
  const buf = toBuffer(source);
  const mime = sniffMime(buf) || 'image/jpeg';
  return await callMultipart('sendPhoto', fields, {
    field: 'photo',
    blob: new Blob([buf], { type: mime }),
    filename: guessFilename('', mime, 'photo'),
  });
}

// kirim dokumen: URL, Buffer, atau Buffer + nama file
export async function sendDocument(chatId, source, filename, caption) {
  const fields = { chat_id: chatId };
  const cap = capCaption(caption);
  if (cap) fields.caption = cap;
  if (typeof source === 'string' && source) {
    // nama file harus dihormati -> unduh dulu lalu upload
    if (filename) {
      const buf = await unduhBuffer(source);
      const mime = mimeFromUrl(source) || sniffMime(buf) || 'application/octet-stream';
      return await callMultipart('sendDocument', fields, {
        field: 'document',
        blob: new Blob([buf], { type: mime }),
        filename: String(filename),
      });
    }
    try {
      return await callMultipart('sendDocument', Object.assign({ document: source }, fields));
    } catch (e) {
      const buf = await unduhBuffer(source);
      const mime = mimeFromUrl(source) || sniffMime(buf) || 'application/octet-stream';
      return await callMultipart('sendDocument', fields, {
        field: 'document',
        blob: new Blob([buf], { type: mime }),
        filename: guessFilename(source, mime, 'dokumen'),
      });
    }
  }
  const buf = toBuffer(source);
  const mime = sniffMime(buf) || 'application/octet-stream';
  return await callMultipart('sendDocument', fields, {
    field: 'document',
    blob: new Blob([buf], { type: mime }),
    filename: filename ? String(filename) : guessFilename('', mime, 'dokumen'),
  });
}

// jawab tombol inline
export async function answerCallbackQuery(callbackId, text, extra) {
  const body = Object.assign({ callback_query_id: callbackId, show_alert: false }, extra || {});
  if (text) body.text = String(text).slice(0, 200);
  try {
    await call('answerCallbackQuery', body);
    return true;
  } catch (e) {
    return false;
  }
}

// daftar perintah slash: [{ command, description }]
export async function setMyCommands(commands) {
  const list = (Array.isArray(commands) ? commands : [])
    .filter((c) => c && c.command)
    .slice(0, 100)
    .map((c) => ({
      command: String(c.command).replace(/^[@/]+/, '').toLowerCase().slice(0, 32),
      description: String(c.description || '').slice(0, 256),
    }));
  return call('setMyCommands', { commands: list });
}

export async function setWebhook(url, secret) {
  return call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 10,
  });
}

export async function getWebhookInfo() {
  const res = await fetch(apiUrl('getWebhookInfo'));
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('getWebhookInfo gagal: ' + JSON.stringify(j).slice(0, 160));
  return j.result;
}

// ---------- helpers internal ----------

function toBuffer(source) {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (source && typeof source === 'object' && source.buffer) return Buffer.from(source);
  return Buffer.from(source || '');
}

function capCaption(caption) {
  if (!caption) return '';
  return String(caption).slice(0, Math.min(MAX_CAPTION, CFG.telegram.maxChars));
}
