import { CFG } from './config.mjs';

const apiUrl = (method) => 'https://api.telegram.org/bot' + CFG.telegram.token + '/' + method;

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

export async function getMe() {
  const res = await fetch(apiUrl('getMe'));
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('getMe gagal: ' + JSON.stringify(j).slice(0, 160));
  return j.result;
}

export async function sendMessage(chatId, text, extra) {
  const chunks = splitText(text, CFG.telegram.maxChars);
  const ids = [];
  for (const c of chunks) {
    const r = await call('sendMessage', Object.assign({ chat_id: chatId, text: c, disable_web_page_preview: true }, extra || {}));
    ids.push(r && r.message_id);
  }
  return ids;
}

export async function editMessageText(chatId, messageId, text) {
  try {
    await call('editMessageText', { chat_id: chatId, message_id: messageId, text: String(text).slice(0, CFG.telegram.maxChars) });
  } catch (e) {
    // editMessageText gagal kalau pesan tidak berubah - abaikan.
  }
}

export async function sendChatAction(chatId, action) {
  try {
    await call('sendChatAction', { chat_id: chatId, action: action || 'typing' });
  } catch {
    // abaikan
  }
}

export async function setWebhook(url, secret) {
  return call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
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
