// ops-probe.mjs - alat bantu QA (milik QA, bukan kode produk).
// Membaca OPS_TOKEN dari file probe lokal, TIDAK pernah mencetak nilainya.
// Menyimpan bukti mentah ke docs/evidence/ dengan nilai sensitif disensor.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://http--gibran-bot--t2lhy99dxnfp.code.run';
const PROBE_FILE = process.env.QA_TOKEN_FILE
  || 'E:/Minimax Code/Minimax-Cloud/bot-workspaces/probe/nf_check_gibran.py';
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'docs/evidence');

const src = fs.readFileSync(PROBE_FILE, 'utf8');
const m = src.match(/OPS_TOKEN["'\s,:=]+["']([A-Za-z0-9_\-]{8,})["']/);
if (!m) { console.error('token ops tidak ditemukan di', PROBE_FILE); process.exit(2); }
const OPS = m[1];

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (/token|secret|password|accesskey/i.test(k)) o[k] = val ? '<redacted len=' + String(val).length + '>' : val;
      else o[k] = redact(val);
    }
    return o;
  }
  if (typeof v === 'string') return v.replace(/([?&]token=)[A-Za-z0-9]+/g, '$1<redacted>');
  return v;
}

async function get(p) {
  const r = await fetch(BASE + p, { headers: { 'x-ops-token': OPS, accept: 'application/json' } });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* bukan json */ }
  return { status: r.status, json: j, text: txt };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const paths = ['/health', '/ready', '/ops/state', '/ops/pool', '/ops/users', '/ops/webhook', '/ops/logs?limit=400'];
const out = {};
for (const p of paths) {
  const r = await get(p);
  out[p] = { status: r.status, body: redact(r.json !== null ? r.json : r.text.slice(0, 500)) };
  const name = p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
  fs.writeFileSync(path.join(OUT_DIR, name + '.json'), JSON.stringify(out[p], null, 2), 'utf8');
}

// Ringkasan tercetak (aman: tidak ada token).
const st = out['/ops/state'].body;
const pool = out['/ops/pool'].body;
const usr = out['/ops/users'].body;
const logs = out['/ops/logs?limit=400'].body;
const lines = (logs && Array.isArray(logs.lines)) ? logs.lines : [];
console.log('HTTP codes:', paths.map((p) => p + '=' + out[p].status).join(' '));
console.log('health:', JSON.stringify(out['/health'].body));
console.log('ready:', JSON.stringify(out['/ready'].body));
console.log('state: mode=' + (st && st.mode) + ' chain=' + ((st.accounts && st.accounts.chain || []).length)
  + ' current=' + (st.accounts && st.accounts.current) + ' sessions=' + Object.keys((st && st.sessions) || {}).length
  + ' lastError=' + JSON.stringify((st && st.lastError) || null));
for (const [cid, s] of Object.entries((st && st.sessions) || {})) {
  console.log('  lease[' + cid + '] label=' + s.label + ' owner=' + s.owner + ' session=' + s.sessionId
    + ' path=' + s.lastPath + ' replyLen=' + String(s.lastReply || '').length
    + ' replyHead=' + String(s.lastReply || '').slice(0, 90).replace(/\s+/g, ' '));
}
console.log('pool:', JSON.stringify(pool));
console.log('users:', JSON.stringify(usr));
console.log('logs: baris=' + lines.length);
fs.writeFileSync(path.join(OUT_DIR, 'logs_lines.txt'), lines.join('\n'), 'utf8');
