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
    const res = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ chat_id: chatId, text: c, disable_web_page_preview: true }, extra || {})),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error('sendMessage gagal: ' + JSON.stringify(j).slice(0, 200));
    ids.push(j.result && j.result.message_id);
  }
  return ids;
}

export async function setWebhook(url, secret) {
  const res = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
      max_connections: 10,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('setWebhook gagal: ' + JSON.stringify(j).slice(0, 200));
  return j.result;
}

export async function getWebhookInfo() {
  const res = await fetch(apiUrl('getWebhookInfo'));
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error('getWebhookInfo gagal: ' + JSON.stringify(j).slice(0, 160));
  return j.result;
}
