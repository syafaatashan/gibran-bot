// live-view.mjs - render halaman live view browser + panduan pairing Remote.
// Self-contained: tanpa CDN eksternal dan tanpa dependensi.
// Token hanya dipakai sebagai query endpoint frame/input, tidak pernah dicetak.
import { VIEWPORT } from './cloud-browser.mjs';

export const DEFAULT_FRAME_URL = '/browser/frame.jpg';
export const INPUT_ENDPOINT = '/browser/input';
export const REMOTE_URL = 'https://agent.minimax.io';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sisipkan token sebagai query endpoint frame.
function withToken(url, token) {
  const base = String(url || DEFAULT_FRAME_URL);
  if (!token) return base;
  if (base.includes('token=')) return base;
  return base + (base.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

const STYLE = [
  ':root{color-scheme:dark}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:#0b0e11;color:#e6e8eb;font:14px/1.5 system-ui,Segoe UI,Roboto,Arial,sans-serif}',
  'header{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#14181d;border-bottom:1px solid #232a31}',
  '.ttl{font-weight:600;letter-spacing:.2px}',
  '.chat{color:#8b949e;font-weight:400;margin-left:6px}',
  '.badge{margin-left:auto;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid #2a3138}',
  '.badge.manual{background:#3b2f00;border-color:#7a6100;color:#ffd479}',
  '.badge.agent{background:#10301c;border-color:#1f5c35;color:#7ee2a8}',
  '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 16px;padding:10px 14px;border-bottom:1px solid #1b2026;font-size:13px}',
  '.meta b{color:#8b949e;font-weight:600}',
  '.meta span{color:#e6e8eb;word-break:break-word}',
  '.actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;background:#11151a;border-bottom:1px solid #1b2026}',
  '.btn{cursor:pointer;border:1px solid #2a3138;background:#1c2229;color:#e6e8eb;padding:7px 14px;border-radius:8px;font-size:13px}',
  '.btn:hover{background:#242c34}',
  '.btn.primary{background:#1f6feb;border-color:#2f7ff0;color:#fff}',
  '.btn.primary:hover{background:#2a7cf5}',
  '.stage{padding:12px;display:flex;justify-content:center;align-items:flex-start;background:#0b0e11;min-height:120px}',
  '.stage img{max-width:100%;border:1px solid #232a31;border-radius:8px;background:#000;cursor:crosshair;display:block}',
  '.send{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #1b2026;align-items:flex-start}',
  '.send textarea{flex:1;resize:vertical;min-height:56px;background:#11151a;color:#e6e8eb;border:1px solid #2a3138;border-radius:8px;padding:8px;font:inherit}',
  '.hint{padding:0 14px 14px;color:#6e7681;font-size:12px;margin:0}',
  '#stamp{color:#8b949e}',
].join('');

function script(token, chatId, src, viewport) {
  return [
    'var TOKEN = ' + JSON.stringify(String(token)) + ';',
    'var CHAT_ID = ' + JSON.stringify(String(chatId)) + ';',
    'var SRC = ' + JSON.stringify(String(src)) + ';',
    'var ENDPOINT = ' + JSON.stringify(INPUT_ENDPOINT) + ';',
    'var VW = ' + JSON.stringify(viewport) + ';',
    'function stamp(t){var e=document.getElementById("stamp");if(e)e.textContent=t;}',
    'function post(action){',
    '  var body=Object.assign({chatId:CHAT_ID,token:TOKEN},action||{});',
    '  fetch(ENDPOINT+"?token="+encodeURIComponent(TOKEN),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})',
    '   .then(function(r){return r.json().catch(function(){return {};});})',
    '   .then(function(j){stamp(j&&j.message?j.message:("terkirim: "+(action&&action.type||"?")));})',
    '   .catch(function(e){stamp("gagal kirim: "+(e&&e.message?e.message:e));});',
    '}',
    'var img=document.getElementById("frame");',
    'img.addEventListener("click",function(ev){',
    '  var r=img.getBoundingClientRect();',
    '  var nw=img.naturalWidth||VW.width, nh=img.naturalHeight||VW.height;',
    '  var x=Math.round((ev.clientX-r.left)*(nw/(r.width||1)));',
    '  var y=Math.round((ev.clientY-r.top)*(nh/(r.height||1)));',
    '  post({type:"click",x:x,y:y});',
    '});',
    'document.getElementById("takeover").addEventListener("click",function(){post({type:"takeover"});});',
    'document.getElementById("release").addEventListener("click",function(){post({type:"release"});});',
    'document.getElementById("back").addEventListener("click",function(){post({type:"back"});});',
    'document.getElementById("reload").addEventListener("click",function(){post({type:"reload"});});',
    'document.getElementById("send").addEventListener("click",function(){',
    '  var t=document.getElementById("msg");',
    '  var v=(t.value||"").trim();',
    '  if(!v){stamp("instruksi kosong");return;}',
    '  post({type:"text",text:v});',
    '  t.value="";',
    '});',
    'document.getElementById("msg").addEventListener("keydown",function(ev){',
    '  if(ev.key==="Enter"&&!ev.shiftKey){ev.preventDefault();document.getElementById("send").click();}',
    '});',
    '// Muat ulang frame tiap 2 detik supaya tampilan live.',
    'setInterval(function(){',
    '  img.src=SRC+(SRC.indexOf("?")>=0?"&":"?")+"t="+Date.now();',
    '},2000);',
  ].join('\n');
}

// Halaman live view: frame browser + badge status + kontrol take-over.
export function renderLiveView({ token = '', chatId = '', status = null, frameUrl = DEFAULT_FRAME_URL } = {}) {
  const st = status && typeof status === 'object' ? status : {};
  const manual = st.manual === true || st.control === 'manual';
  const badge = manual ? 'Anda memegang kontrol' : 'Agen bekerja';
  const badgeClass = manual ? 'manual' : 'agent';
  const src = withToken(frameUrl, token);
  const viewport = st.viewport && typeof st.viewport === 'object' ? st.viewport : VIEWPORT;

  const head = [
    '<!doctype html>',
    '<html lang="id"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Gibran.ai - Live View Browser</title>',
    '<style>' + STYLE + '</style>',
    '</head><body>',
  ].join('\n');

  const body = [
    '<header>',
    '  <div class="ttl">Live View Browser<span class="chat">chat ' + esc(chatId) + '</span></div>',
    '  <div class="badge ' + badgeClass + '" id="badge">' + esc(badge) + '</div>',
    '</header>',
    '<section class="meta">',
    '  <div><b>Goal:</b> <span id="goal">' + esc(st.goal || '') + '</span></div>',
    '  <div><b>Step:</b> <span id="step">' + esc(st.step == null ? '' : st.step) + '</span></div>',
    '  <div><b>URL:</b> <span id="url">' + esc(st.url || '') + '</span></div>',
    '  <div><b>Catatan:</b> <span id="caption">' + esc(st.caption || '') + '</span></div>',
    '</section>',
    '<div class="actions">',
    '  <button class="btn primary" id="takeover">Ambil alih</button>',
    '  <button class="btn" id="release">Kembali ke bot</button>',
    '  <button class="btn" id="back">Back</button>',
    '  <button class="btn" id="reload">Reload</button>',
    '</div>',
    '<div class="stage"><img id="frame" src="' + esc(src) + '" alt="frame browser live"></div>',
    '<div class="send">',
    '  <textarea id="msg" rows="2" placeholder="Tulis instruksi untuk bot, contoh: buka menu(lowongan) lalu isi form"></textarea>',
    '  <button class="btn primary" id="send">Kirim instruksi</button>',
    '</div>',
    '<p class="hint">Klik langsung pada gambar untuk meneruskan klik ke browser cloud. Status terakhir: <span id="stamp">siap</span></p>',
    '<script>',
    script(token, chatId, src, viewport),
    '</script>',
    '</body></html>',
  ].join('\n');

  return head + '\n' + body;
}

// Panduan pairing Remote native (dipakai tombol Remote di bot).
export function renderRemoteHelp(url = REMOTE_URL) {
  const target = String(url || REMOTE_URL);
  const head = [
    '<!doctype html>',
    '<html lang="id"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Gibran.ai - Remote Browser</title>',
    '<style>' + STYLE + '</style>',
    '</head><body>',
  ].join('\n');
  const body = [
    '<header><div class="ttl">Remote Browser<span class="chat">pairing native</span></div></header>',
    '<section class="meta" style="display:block">',
    '  <div><b>1.</b> <span>Buka <a href="' + esc(target) + '" target="_blank" rel="noopener">' + esc(target) + '</a></span></div>',
    '  <div><b>2.</b> <span>Tekan tombol <b>Remote</b> di sidebar kiri halaman tersebut.</span></div>',
    '  <div><b>3.</b> <span>Pastikan <b>MCode Desktop</b> sudah ter-pairing dengan akun yang sama.</span></div>',
    '  <div><b>4.</b> <span>Desktop harus tetap menyala selama sesi remote dipakai.</span></div>',
    '  <div><b>5.</b> <span>Kirim tautan pairing dari bot ke chat ini, lalu buka tautannya.</span></div>',
    '</section>',
    '<div class="actions"><a class="btn primary" href="' + esc(target) + '" target="_blank" rel="noopener">Buka MiniMax Code</a></div>',
    '<p class="hint">Kalau tombol Remote tidak aktif, cek dulu pairing Desktop di pengaturan akun.</p>',
    '</body></html>',
  ].join('\n');
  return head + '\n' + body;
}
