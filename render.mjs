// render.mjs - siapkan profil MiniMax Code di dalam container.
// Dipanggil entrypoint.sh sebelum server dijalankan.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.MINIMAX_DATA_DIR || '/data';
const APP = process.env.APP_DIR || '/app';
const WORKSPACE = process.env.BOT_WORKSPACE_DIR || '/workspace';

function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfPresent(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

for (const d of ['auth/prod/en/mcode-public', 'skills', 'agents', 'sessions', 'workspace/users']) {
  mkdir(path.join(DATA, d));
}

// Skill get-a-job + persona agent gibran-ai selalu disalin dari image
// (isi image yang authoritative, volume hanya menyimpan sesi & state).
const skillOk = copyIfPresent(path.join(APP, 'skill', 'get-a-job'), path.join(DATA, 'skills', 'get-a-job'));
const agentOk = copyIfPresent(path.join(APP, 'agent', 'gibran-ai'), path.join(DATA, 'agents', 'gibran-ai'));
console.log('[render] skill get-a-job:', skillOk, '| agent gibran-ai:', agentOk);

// config.yaml untuk runtime
const tpl = path.join(APP, 'config.template.yaml');
if (fs.existsSync(tpl)) {
  fs.writeFileSync(path.join(DATA, 'config.yaml'), fs.readFileSync(tpl, 'utf8'));
  console.log('[render] config.yaml ditulis');
}

// Workspace per-pengguna dipersistent lewat volume yang sama.
try {
  const target = path.join(DATA, 'workspace');
  mkdir(target);
  if (!fs.existsSync(WORKSPACE)) {
    fs.symlinkSync(target, WORKSPACE, 'dir');
    console.log('[render] symlink', WORKSPACE, '->', target);
  }
} catch (e) {
  console.log('[render] symlink workspace dilewati:', e.message);
}

// MCP browser native MCode (chrome-devtools-mcp) - tanpa muse browser.
try {
  const mcp = {
    mcpServers: {
      'chrome-devtools': {
        type: 'stdio',
        enabled: true,
        configured: true,
        builtin: false,
        description: 'Kontrol browser Chrome headless (MCP native MiniMax Code)',
        command: 'chrome-devtools-mcp',
        args: ['--headless', '--isolated', '--executablePath=/usr/local/bin/chromium-headless'],
      },
    },
  };
  fs.writeFileSync(path.join(DATA, 'mcp.json'), JSON.stringify(mcp, null, 2));
  console.log('[render] mcp.json ditulis (chrome-devtools)');
} catch (e) {
  console.log('[render] gagal tulis mcp.json:', e.message);
}

console.log('[render] data dir siap:', DATA);
