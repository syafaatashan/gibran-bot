// src/orchestrator.mjs - anggaran giliran, deteksi hasil browser, pemicu kirim file.
//
// Bot ini relay: agen cloud yang berpikir dan browsing, bot yang meneruskan
// balasan dan berkas ke Telegram. Modul ini menjaga giliran tetap ringkas.
export const TURN = {
  maxChars: 1200,
  maxMs: 8 * 60 * 1000,
  maxBrowserRounds: 6,
  maxFiles: 3,
  maxFrames: 8,
  frameThrottleMs: 4000,
  fileThrottleMs: 800,
};

const FILE_HINT = /(saya (lampirkan|kirim|attach|tulis)|terlampir|file (ini|below)|lihat file|download file|\.csv|\.pdf|\.md\b)/i;
const BROWSER_HINT = /(linkedin|lowongan|job|cari kerja|apply|lamaran|buka (halaman|tab)|browser|lowongan di)/i;

export function createTurnContext(chatId, profile) {
  return {
    chatId,
    mode: (profile && profile.mode) || 'confirm',
    startedAt: Date.now(),
    rounds: 0,
    filesSent: 0,
    framesSent: 0,
    lastFileAt: 0,
    lastFrameAt: 0,
    browserActive: false,
    manual: false,
    path: 'direct',
  };
}

export function elapsed(ctx) {
  return Date.now() - ctx.startedAt;
}

export function budgetLeft(ctx) {
  return Math.max(0, TURN.maxMs - elapsed(ctx));
}

export function budgetExpired(ctx) {
  return elapsed(ctx) > TURN.maxMs || ctx.rounds > TURN.maxBrowserRounds;
}

export function canSendFrame(ctx) {
  if (ctx.framesSent >= TURN.maxFrames) return false;
  if (Date.now() - ctx.lastFrameAt < TURN.frameThrottleMs) return false;
  return true;
}

export function markFrameSent(ctx) {
  ctx.framesSent += 1;
  ctx.lastFrameAt = Date.now();
}

export function canSendFile(ctx) {
  if (ctx.filesSent >= TURN.maxFiles) return false;
  if (Date.now() - ctx.lastFileAt < TURN.fileThrottleMs) return false;
  return true;
}

export function markFileSent(ctx) {
  ctx.filesSent += 1;
  ctx.lastFileAt = Date.now();
}

// Balasan agen yang menyebut berkas -> bot perlu mengirim berkas itu.
export function mentionsFiles(text) {
  return FILE_HINT.test(String(text || ''));
}

// Permintaan yang butuh browser -> bot menyalakan relay frame.
export function needsBrowser(text) {
  return BROWSER_HINT.test(String(text || ''));
}

// Instruksi live view user: "INSTRUKSI USER (live view): ..." -> teruskan apa adanya.
export function extractUserInstruction(text) {
  const t = String(text || '');
  const m = t.match(/INSTRUKSI USER \([^)]*\):\s*([\s\S]+)$/i);
  if (m) return { source: 'live-view', body: m[1].trim() };
  return null;
}
