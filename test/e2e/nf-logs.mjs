// nf-logs.mjs - alat bantu QA. Ambil log runtime container dari Northflank API.
// Token Northflank dibaca dari file config lokal, tidak pernah dicetak.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CFG = path.join(os.homedir(), '.northflank', 'config.json');
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const ctx = (cfg.contexts || []).find((c) => c.name === cfg.current) || (cfg.contexts || [])[0];
const TOKEN = ctx.token;
const API = 'https://api.northflank.com/v1';
const SVC = '/projects/gibran-ai/services/gibran-bot/logs';
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'docs/evidence');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function get(q) {
  const r = await fetch(API + SVC + q, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* bukan json */ }
  return { status: r.status, j, t };
}

const res = await get('?limit=1000');
const data = (res.j && res.j.data) || [];
const lines = data.map((d) => {
  if (typeof d === 'string') return d;
  const ts = d.timestamp || d.time || d.createdAt || '';
  const msg = d.message || d.log || d.text || JSON.stringify(d);
  return (ts ? '[' + ts + '] ' : '') + String(msg).replace(/\r?\n/g, ' ');
});
fs.writeFileSync(path.join(OUT_DIR, 'nf_logs.txt'), lines.join('\n'), 'utf8');

const low = lines.map((l) => l.toLowerCase());
const pats = {
  'rotasi akun': 'rotasi akun',
  'konteks dipindah': 'konteks dipindah',
  'migrasiViaHistory': 'migrasiviahistory',
  'Account ': 'account ',
  'ERROR': 'error', 'exception': 'exception', 'unhandled': 'unhandled', 'gagal': 'gagal',
  'fetch failed': 'fetch failed', 'rotasi': 'rotasi',
};
console.log('HTTP ' + res.status + ' | baris log=' + lines.length);
for (const [k, v] of Object.entries(pats)) {
  console.log('  cocok "' + k + '": ' + low.filter((l) => l.includes(v)).length);
}
console.log('--- 25 baris terakhir ---');
console.log(lines.slice(-25).join('\n'));
