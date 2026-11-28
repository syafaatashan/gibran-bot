import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CFG } from './config.mjs';
import { log } from './log.mjs';

export function isCreditError(text) {
  const t = String(text || '');
  return /insufficient balance/i.test(t) || /\b1008\b/.test(t) || /\b50110\b/.test(t);
}

export function isAuthError(text) {
  const t = String(text || '');
  return /401|unauthorized|invalid token|token expired/i.test(t)
    || /content review authentication expired/i.test(t)
    || /sign in again/i.test(t);
}

function buildArgs(opts) {
  const args = [
    'exec',
    '--cwd', opts.cwd,
    '--output-format', 'stream-json',
    '--permission', CFG.mcodePermission,
    '--max-steps', String(CFG.mcodeMaxSteps),
    '--timeout', CFG.mcodeTimeout,
  ];
  if (opts.sessionId) args.push('--session', opts.sessionId);
  if (CFG.mcodeModel) args.push('--model', CFG.mcodeModel);
  if (CFG.mcodeEffort) args.push('--effort', CFG.mcodeEffort);
  args.push('--output-last-message', opts.lastMessageFile);
  args.push(opts.prompt);
  return args;
}

// Jalankan satu turn MCode di dalam container. events = array event stream-json.
export async function runExec(opts) {
  const lastMessageFile = path.join(CFG.dataDir, 'last-message-' + process.pid + '.txt');
  try { fs.unlinkSync(lastMessageFile); } catch { /* belum ada */ }
  const args = buildArgs({
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    prompt: opts.prompt,
    lastMessageFile,
  });
  fs.mkdirSync(opts.cwd, { recursive: true });

  const started = Date.now();
  const res = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(CFG.mcodeBin, args, {
        cwd: opts.cwd,
        env: Object.assign({}, process.env, { MINIMAX_DATA_DIR: CFG.dataDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: 'gagal spawn ' + CFG.mcodeBin + ': ' + String(e.message || e), events: [] });
      return;
    }
    let stdout = '';
    let stderr = '';
    const events = [];
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || line[0] !== '{') continue;
        try {
          const ev = JSON.parse(line);
          events.push(ev);
          if (typeof opts.onEvent === 'function') {
            try { opts.onEvent(ev); } catch { /* abaikan */ }
          }
        } catch { /* baris bukan JSON */ }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (e) => {
      resolve({ code: -1, stdout, stderr: stderr + ' | ' + String(e.message || e), events });
    });
    child.on('close', (code) => {
      resolve({ code: code === null ? -1 : code, stdout, stderr, events });
    });
  });

  // Format stream-json nyata: satu JSON per baris.
  //   exec.started | session.started | turn.started
  //   item.started/item.updated  -> item.contentDelta (stream)
  //   item.completed             -> item.content (teks final)
  //   turn.completed | exec.completed -> result{ sessionId, status, output }
  let sessionId = null;
  let text = '';
  let streamed = '';
  let last = null;
  let execError = null;
  for (const ev of res.events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.sessionId && !sessionId) sessionId = ev.sessionId;
    if (ev.type === 'item.updated' && ev.item && ev.item.type === 'agent_message' && typeof ev.item.contentDelta === 'string') {
      streamed += ev.item.contentDelta;
    }
    if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message' && typeof ev.item.content === 'string') {
      text = ev.item.content;
    }
    if (ev.type === 'exec.completed' && ev.result) {
      last = ev.result;
      sessionId = ev.result.sessionId || sessionId;
      if (!text && typeof ev.result.output === 'string') text = ev.result.output;
      if (ev.result.error) execError = ev.result.error;
    }
  }
  if (!text) {
    try {
      text = fs.readFileSync(lastMessageFile, 'utf8').trim();
    } catch { /* tidak ada */ }
  }
  try { fs.unlinkSync(lastMessageFile); } catch { /* abaikan */ }

  const combined = res.stdout + '\n' + res.stderr;
  return {
    ok: res.code === 0 && !isCreditError(combined),
    code: res.code,
    text,
    streamed,
    sessionId: sessionId || null,
    status: (last && last.status) || null,
    error: execError || (last && last.error) || null,
    creditError: isCreditError(combined),
    authError: isAuthError(combined),
    stderr: res.stderr.slice(-2000),
    rawStdout: res.stdout.slice(-8000),
    events: res.events.slice(-40),
    durationMs: Date.now() - started,
  };
}
