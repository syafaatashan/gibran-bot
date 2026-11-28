// frame-cache.mjs - cache frame browser (jpg) + status (json) untuk live view.
// Zero dependency. Penulisan atomic (tmp + rename) supaya file tidak pernah setengah jadi.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CFG } from './config.mjs';

const UNSAFE = /[^A-Za-z0-9_-]/g;
let tmpSeq = 0;

// Chat id Telegram bisa negatif -> aman untuk nama file.
export function safeChatId(chatId) {
  const s = String(chatId == null ? '' : chatId).trim().replace(UNSAFE, '_');
  return s || 'default';
}

export class FrameCache {
  constructor({ dir, now = () => Date.now() } = {}) {
    this.dir = dir || path.join(CFG.dataDir, 'frames');
    this.now = now;
  }

  // Lokasi file untuk sebuah chat.
  framePath(chatId) { return path.join(this.dir, safeChatId(chatId) + '.jpg'); }
  metaPath(chatId) { return path.join(this.dir, safeChatId(chatId) + '.json'); }

  async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
    return this.dir;
  }

  tmpPath(id) {
    tmpSeq += 1;
    return path.join(this.dir, '.' + id + '.' + process.pid + '.' + tmpSeq + '.tmp');
  }

  async writeMeta(chatId, obj) {
    await this.ensureDir();
    const tmp = this.tmpPath(safeChatId(chatId));
    await fs.writeFile(tmp, JSON.stringify(obj));
    await fs.rename(tmp, this.metaPath(chatId));
    return obj;
  }

  // Simpan frame (buffer gambar) + status (meta) untuk satu chat.
  async putFrame(chatId, buffer, meta) {
    await this.ensureDir();
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const updatedAt = this.now();
    const tmp = this.tmpPath(safeChatId(chatId));
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, this.framePath(chatId));
    const prev = await this.getMeta(chatId);
    const merged = Object.assign({}, prev || {}, meta || {});
    const stamp = Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : '';
    await this.writeMeta(chatId, {
      updatedAt,
      updatedAtIso: stamp,
      bytes: buf.length,
      meta: merged,
    });
    return { path: this.framePath(chatId), updatedAt, meta: merged };
  }

  // Simpan status tanpa frame baru (agen memperbarui frame_status.json).
  async putStatus(chatId, meta) {
    const cur = await this.readMetaFile(chatId);
    const updatedAt = cur && Number.isFinite(Number(cur.updatedAt)) ? Number(cur.updatedAt) : this.now();
    const merged = Object.assign({}, (cur && cur.meta) || {}, meta || {});
    const stamp = Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : '';
    await this.writeMeta(chatId, {
      updatedAt,
      updatedAtIso: stamp,
      bytes: cur && Number.isFinite(Number(cur.bytes)) ? Number(cur.bytes) : 0,
      meta: merged,
    });
    return merged;
  }

  async readMetaFile(chatId) {
    try {
      const txt = await fs.readFile(this.metaPath(chatId), 'utf8');
      const j = JSON.parse(txt);
      return j && typeof j === 'object' ? j : null;
    } catch { return null; }
  }

  // Frame terbaru: { path, updatedAt, meta } atau null.
  async getFrame(chatId) {
    const j = await this.readMetaFile(chatId);
    if (!j) return null;
    const p = this.framePath(chatId);
    try {
      const st = await fs.stat(p);
      if (!st.isFile()) return null;
    } catch { return null; }
    return { path: p, updatedAt: Number(j.updatedAt || 0), meta: j.meta || null };
  }

  // Status terakhir saja (goal/url/step/caption).
  async getMeta(chatId) {
    const j = await this.readMetaFile(chatId);
    if (!j) return null;
    return j.meta || null;
  }

  // True bila frame tidak ada atau sudah lebih tua dari maxAgeMs.
  async isStale(chatId, maxAgeMs = 60000) {
    const f = await this.getFrame(chatId);
    if (!f) return true;
    return (this.now() - Number(f.updatedAt || 0)) > maxAgeMs;
  }

  // Ringkasan semua frame untuk /ops.
  async listFrames() {
    const out = [];
    let names = [];
    try { names = await fs.readdir(this.dir); } catch { return out; }
    for (const n of names) {
      if (!n.endsWith('.json') || n.startsWith('.')) continue;
      const chatId = n.slice(0, -5);
      const j = await this.readMetaFile(chatId);
      if (!j) continue;
      const meta = j.meta || {};
      out.push({
        chatId,
        path: this.framePath(chatId),
        updatedAt: Number(j.updatedAt || 0),
        updatedAtIso: String(j.updatedAtIso || ''),
        bytes: Number(j.bytes || 0),
        stale: (this.now() - Number(j.updatedAt || 0)) > 60000,
        goal: String(meta.goal || ''),
        url: String(meta.url || ''),
        step: meta.step == null ? '' : String(meta.step),
        caption: String(meta.caption || ''),
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  // Hapus cache satu chat (misal setelah sesi browser selesai).
  async remove(chatId) {
    for (const p of [this.framePath(chatId), this.metaPath(chatId)]) {
      try { await fs.unlink(p); } catch { /* abaikan */ }
    }
    return true;
  }
}
