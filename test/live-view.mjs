// live-view.mjs - uji render halaman live view + panduan Remote (offline).
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot-src');
const imp = (p) => import(pathToFileURL(p).href);

process.env.MINIMAX_DATA_DIR = path.join(os.tmpdir(), 'gibran-live-view-data');
const { renderLiveView, renderRemoteHelp, DEFAULT_FRAME_URL, INPUT_ENDPOINT } = await imp(ROOT + '/src/live-view.mjs');

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}

const TOKEN = 'token-uji-dummy';
const CHAT = '42';
const status = {
  goal: 'cari lowongan frontend',
  url: 'https://jobs.test/list',
  step: 3,
  caption: 'Halaman daftar lowongan',
};

const html = renderLiveView({ token: TOKEN, chatId: CHAT, status, frameUrl: DEFAULT_FRAME_URL });

console.log('=== A. Live view ===');
check('LV1 HTML memuat frameUrl', html.includes(DEFAULT_FRAME_URL), DEFAULT_FRAME_URL);
check('LV2 HTML memuat token sebagai query frame', html.includes('token=' + TOKEN) && html.includes('src="' + DEFAULT_FRAME_URL + '?token=' + TOKEN + '"'));
check('LV3 HTML memuat endpoint /browser/input', html.includes(INPUT_ENDPOINT) && html.includes('/browser/input'), INPUT_ENDPOINT);
check('LV4 badge "Agen bekerja" saat bot yangPegang', html.includes('Agen bekerja'));
check('LV5 tombol lengkap', html.includes('Ambil alih') && html.includes('Kembali ke bot') && html.includes('Back') && html.includes('Reload'));
check('LV6 area kirim instruksi ada', html.includes('<textarea') && html.includes('Kirim instruksi'));
check('LV7 area klik koordinat ada', html.includes("addEventListener('click'") || html.includes('type:"click"') || html.includes('type: "click"'));
check('LV8 judul halaman ada', html.includes('<title>Gibran.ai - Live View Browser</title>'));
check('LV9 isi status tampil', html.includes('cari lowongan frontend') && html.includes('Halaman daftar lowongan') && html.includes('jobs.test/list'));
check('LV10 tanpa sumber daya eksternal', !/src="http/i.test(html) && !/href="http/i.test(html) && !html.includes('cdn.jsdelivr') && !html.includes('unpkg'));
check('LV11 self-contained (ada style + script inline)', html.includes('<style>') && html.includes('<script>'));

const manual = renderLiveView({ token: TOKEN, chatId: CHAT, status: { manual: true }, frameUrl: DEFAULT_FRAME_URL });
check('LV12 badge "Anda memegang kontrol" saat user ambil alih', manual.includes('Anda memegang kontrol') && !manual.includes('>Agen bekerja<'));

const custom = renderLiveView({ token: TOKEN, chatId: CHAT, status: null, frameUrl: '/browser/frame.jpg?v=2' });
check('LV13 frameUrl kustom dipakai', custom.includes('/browser/frame.jpg?v=2'));
check('LV14 tanpa status tetap render', custom.includes('Agen bekerja') && custom.includes(DEFAULT_FRAME_URL));

console.log('');
console.log('=== B. Panduan Remote ===');
const help = renderRemoteHelp('https://agent.minimax.io');
check('LV15 tautan agent.minimax.io ada', help.includes('https://agent.minimax.io'));
check('LV16 menyebut tombol Remote', help.includes('Remote'));
check('LV17 menyebut MCode Desktop harus ter-pairing', help.includes('MCode Desktop') && help.includes('pairing'));
check('LV18 menyebut desktop harus menyala', help.includes('menyala'));
check('LV19 halaman Remote punya tautan buka', help.includes('Buka MiniMax Code'));

console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
