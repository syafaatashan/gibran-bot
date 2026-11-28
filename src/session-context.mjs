import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';

function findSessionDir(sessionId) {
  const root = path.join(CFG.dataDir, 'v2', 'sessions');
  const want = 'session_' + Buffer.from(sessionId, 'utf8').toString('base64url').replace(/=+$/, '');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const p = path.join(dir, it.name);
      if (it.name.endsWith(want)) return p;
      stack.push(p);
    }
  }
  return null;
}

function textOf(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((x) => (typeof x === 'string' ? x : (x && (x.text || x.value)) || '')).join(' ');
  }
  if (c && typeof c === 'object') return String(c.text || c.value || '');
  return '';
}

export function buildContextBrief(sessionId, maxMessages, maxChars) {
  if (!sessionId) return '';
  const dir = findSessionDir(sessionId);
  if (!dir) return '';
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8'); } catch { return ''; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message || o;
    const role = msg.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const t = textOf(msg).trim();
    if (!t) continue;
    out.push(role + ': ' + t);
  }
  const limit = maxMessages || 14;
  const chars = maxChars || 4000;
  let brief = out.slice(-limit).join('\n');
  if (brief.length > chars) brief = '...\n' + brief.slice(-chars);
  if (!brief) return '';
  return '# KONTEKS PERCAKAPAN SEBELUMNYA (akun OAuth diganti, sesi baru dibuat)\n' + brief + '\n\n---\n\n';
}
