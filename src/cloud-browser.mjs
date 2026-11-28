// cloud-browser.mjs - relay frame & instruksi antara Drive cloud dan bot.
// Browser TIDAK ada di container: agen cloud menulis frame_latest.png +
// frame_status.json ke /workspace/output, keduanya muncul di Cloud Drive.
// Modul ini: (1) polling Drive -> cache frame, (2) menyusun pesan instruksi
// Bahasa Indonesia untuk sesi cloud. Sengaja TIDAK mengirim ke cloud:
// lead yang owns pengiriman pesan ke sesi.
// Daftar/unduh file memakai bridge yang sama (src/cloud-files.mjs).
import { log as defaultLog } from './log.mjs';
import { FrameCache } from './frame-cache.mjs';
import { listDrive, downloadFile, DRIVE_PATH } from './cloud-files.mjs';
import { toMs } from './cloud-files.mjs';

export { DRIVE_PATH, toMs };

export const FRAME_NAME = 'frame_latest.png';
export const STATUS_NAME = 'frame_status.json';
export const VIEWPORT = { width: 1280, height: 900 };

// Parse isi frame_status.json -> { goal, url, step, caption, updatedAt }.
export function parseStatus(raw) {
  let o = raw;
  if (Buffer.isBuffer(o)) o = o.toString('utf8');
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch { return null; }
  }
  if (!o || typeof o !== 'object') return null;
  const s = (o.status && typeof o.status === 'object') ? o.status : o;
  return {
    goal: String(s.goal || ''),
    url: String(s.url || ''),
    step: s.step == null ? '' : String(s.step),
    caption: String(s.caption || ''),
    updatedAt: s.updatedAt == null ? '' : String(s.updatedAt),
    manual: s.manual === true,
  };
}

// Nama tombol yang lebih enak dibaca agen.
const KEY_NAMES = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', space: 'Space',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

function prettyKey(k) {
  const s = String(k).trim();
  const low = s.toLowerCase();
  if (KEY_NAMES[low]) return KEY_NAMES[low];
  if (s.includes('+')) {
    return s.split('+').map((p) => KEY_NAMES[p.trim().toLowerCase()] || p.trim()).join('+');
  }
  return s;
}

export class FrameRelay {
  constructor({
    cloud,
    cache,
    pollMs = 2000,
    idleMs = 120000,
    manualMaxMs = 600000,
    viewport = VIEWPORT,
    fetchImpl,
    now = () => Date.now(),
    log = defaultLog,
  } = {}) {
    this.cloud = cloud;
    this.cache = cache || new FrameCache();
    this.pollMs = pollMs;
    this.idleMs = idleMs;
    this.manualMaxMs = manualMaxMs;
    this.viewport = viewport;
    this.fetchImpl = fetchImpl || null;
    this.now = now;
    this.log = log;
    this.sessions = new Map();
  }

  ensureSession(chatId) {
    const key = String(chatId);
    let st = this.sessions.get(key);
    if (!st) {
      st = {
        token: '',
        timer: null,
        running: false,
        manual: false,
        manualAt: 0,
        lastActivityAt: this.now(),
        lastInstructionAt: 0,
        lastFrameAt: 0,
        frameAt: 0,
        statusAt: 0,
      };
      this.sessions.set(key, st);
    }
    return st;
  }

  // Mulai polling Drive untuk satu chat. Poll pertama langsung dilakukan.
  async start(chatId, token) {
    const key = String(chatId);
    const st = this.ensureSession(key);
    if (token) st.token = token;
    st.lastActivityAt = this.now();
    if (st.timer) return { ok: true, chatId: key, alreadyRunning: true };
    st.running = true;
    await this.pollOnce(key);
    st.timer = setInterval(() => { this.tick(key); }, this.pollMs);
    if (st.timer && st.timer.unref) st.timer.unref();
    return { ok: true, chatId: key };
  }

  stop(chatId) {
    const key = String(chatId);
    const st = this.sessions.get(key);
    if (!st) return { ok: true, chatId: key, stopped: false };
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    st.running = false;
    return { ok: true, chatId: key, stopped: true };
  }

  // Berhenti otomatis kalau idle (tidak ada instruksi & frame baru).
  tick(chatId) {
    const key = String(chatId);
    const st = this.sessions.get(key);
    if (!st || !st.timer) return;
    const idle = this.now() - st.lastActivityAt;
    if (idle > this.idleMs) {
      this.stop(key);
      this.log('relay frame idle untuk chat ' + key + ' -> polling dihentikan');
    }
  }

  // Daftar node drive yang sudah dinormalisasi (nama, cdnUrl, updatedAt).
  async listNodes(token) {
    const nodes = await listDrive({ token, cloud: this.cloud });
    return Array.isArray(nodes) ? nodes : [];
  }

  // Satu putaran polling: cek status lalu frame baru.
  async pollOnce(chatId) {
    const key = String(chatId);
    const st = this.sessions.get(key);
    if (!st) return { ok: false, error: 'tidak ada sesi relay untuk chat ini' };
    if (!st.token) return { ok: false, error: 'token cloud belum tersedia' };
    let nodes = [];
    try {
      nodes = await this.listNodes(st.token);
    } catch (e) {
      return { ok: false, error: this.errText(e) };
    }
    const frameNode = nodes.find((n) => n && String(n.name || '') === FRAME_NAME);
    const statusNode = nodes.find((n) => n && String(n.name || '') === STATUS_NAME);
    const out = { ok: true, newFrame: false, newStatus: false, frame: null, status: null };

    // Status lebih dulu supaya frame baru membawa konteks yang benar.
    if (statusNode) {
      const at = toMs(statusNode.updatedAt);
      if (at && at !== st.statusAt) {
        const raw = await this.downloadBytes(statusNode.cdnUrl, st.token);
        const parsed = parseStatus(raw);
        if (parsed) {
          await this.cache.putStatus(key, parsed);
          st.statusAt = at;
          out.newStatus = true;
          out.status = parsed;
        }
      }
    }

    if (frameNode) {
      const at = toMs(frameNode.updatedAt);
      if (at && at !== st.frameAt) {
        const buf = await this.downloadBytes(frameNode.cdnUrl, st.token);
        if (buf && buf.length) {
          const meta = await this.cache.getMeta(key);
          const saved = await this.cache.putFrame(key, buf, meta || undefined);
          st.frameAt = at;
          st.lastFrameAt = this.now();
          st.lastActivityAt = this.now();
          out.newFrame = true;
          out.frame = { path: saved.path, updatedAt: saved.updatedAt };
        }
      }
    }
    return out;
  }

  // Unduh file drive -> Buffer (tanpa mencetak isi/URL bertanda tangan).
  async downloadBytes(url, token) {
    if (!url) return null;
    try {
      const opts = this.fetchImpl ? { fetchImpl: this.fetchImpl } : {};
      return await downloadFile(url, token, opts);
    } catch { return null; }
  }

  errText(e) {
    return String((e && e.message) || e).slice(0, 200);
  }

  // Frame terbaru: { path, updatedAt } | null.
  async getFrame(chatId) {
    const f = await this.cache.getFrame(String(chatId));
    if (!f) return null;
    return { path: f.path, updatedAt: f.updatedAt };
  }

  // Status terakhir dari frame_status.json.
  async getStatus(chatId) {
    return this.cache.getMeta(String(chatId));
  }

  async isStale(chatId, maxAgeMs = 60000) {
    return this.cache.isStale(String(chatId), maxAgeMs);
  }

  // True selama user memegang kontrol (instruksi manual belum dilepas).
  isManualBusy(chatId) {
    const st = this.sessions.get(String(chatId));
    if (!st || !st.manual) return false;
    // Pengaman deadlock: kalau lead lupa release, kunci dilepas otomatis.
    if (this.manualMaxMs > 0 && this.now() - st.manualAt > this.manualMaxMs) {
      st.manual = false;
      return false;
    }
    return true;
  }

  releaseManual(chatId) {
    const st = this.sessions.get(String(chatId));
    if (!st) return { ok: true, chatId: String(chatId), manual: false };
    st.manual = false;
    st.lastActivityAt = this.now();
    return { ok: true, chatId: String(chatId), manual: false };
  }

  // Susun pesan Bahasa Indonesia untuk sesi cloud (tidak dikirim di sini).
  sendInstruction(chatId, action) {
    const key = String(chatId);
    const type = String((action && action.type) || '').trim().toLowerCase();
    if (!type) return { ok: false, message: 'Tipe aksi wajib diisi.' };
    if (this.isManualBusy(key)) {
      return { ok: false, message: 'Ada instruksi manual lain yang sedang berjalan. Tunggu giliran selesai.' };
    }
    const vp = (action && action.viewport) || this.viewport;
    let msg = '';
    if (type === 'click') {
      const x = Number(action.x);
      const y = Number(action.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, message: 'Klik butuh koordinat x dan y.' };
      }
      msg = 'INSTRUKSI USER (live view): klik di x=' + Math.round(x) + ' y=' + Math.round(y)
        + ' pada viewport ' + vp.width + 'x' + vp.height;
    } else if (type === 'type') {
      const t = String(action.text || '').trim();
      if (!t) return { ok: false, message: 'Ketik butuh teks.' };
      msg = 'INSTRUKSI USER (live view): ketik teks: ' + t;
    } else if (type === 'key') {
      const k = String(action.key || action.text || '').trim();
      if (!k) return { ok: false, message: 'Tekan tombol butuh nama tombol.' };
      msg = 'INSTRUKSI USER (live view): tekan tombol ' + prettyKey(k);
    } else if (type === 'scroll') {
      const raw = String(action.direction || action.text || 'down').toLowerCase();
      const arah = (raw.includes('up') || raw.includes('atas')) ? 'atas' : 'bawah';
      const amount = Number(action.amount || 0);
      msg = 'INSTRUKSI USER (live view): scroll ke ' + arah
        + (Number.isFinite(amount) && amount ? ' ' + Math.round(amount) + ' piksel' : '');
    } else if (type === 'back') {
      msg = 'INSTRUKSI USER (live view): kembali ke halaman sebelumnya';
    } else if (type === 'reload') {
      msg = 'INSTRUKSI USER (live view): muat ulang halaman';
    } else if (type === 'navigate') {
      const u = String(action.url || '').trim();
      if (!u) return { ok: false, message: 'Navigasi butuh url.' };
      msg = 'INSTRUKSI USER (live view): buka url ' + u;
    } else if (type === 'text') {
      const t = String(action.text || '').trim();
      if (!t) return { ok: false, message: 'Instruksi butuh teks.' };
      msg = 'INSTRUKSI USER (chat): ' + t;
    } else {
      return { ok: false, message: 'Tipe aksi tidak dikenal: ' + type };
    }
    const st = this.ensureSession(key);
    st.manual = true;
    st.manualAt = this.now();
    st.lastInstructionAt = this.now();
    st.lastActivityAt = this.now();
    return { ok: true, message: msg };
  }

  // Ringkasan untuk /ops.
  getState(chatId) {
    const key = String(chatId);
    const st = this.sessions.get(key);
    if (!st) return { chatId: key, running: false, manual: false };
    return {
      chatId: key,
      running: st.running,
      manual: this.isManualBusy(key),
      lastActivityAt: st.lastActivityAt,
      lastInstructionAt: st.lastInstructionAt,
      lastFrameAt: st.lastFrameAt,
      frameAt: st.frameAt,
      statusAt: st.statusAt,
      hasToken: !!st.token,
    };
  }
}
