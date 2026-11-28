// src/linkedin/apply.mjs - Rencana apply lowongan LinkedIn (mode confirm / auto).
// Modul ini tidak menjalankan browser dan tidak mengirim form apa pun.
// Hasilnya: langkah + pesan untuk agen cloud MiniMax, plus guardrail anti-bot.

export const STOP_CONDITIONS = ['captcha', 'challenge', '999', '429', '403', 'verifikasi identitas'];
export const STOP_POLICY = 'Begitu salah satu stopConditions muncul: hentikan aksi, tulis frame_status.json (step = "blocked", caption = sinyal yang muncul), lalu tanya user. Jangan solving atau bypass.';
export const STOP_SIGNALS = ['captcha', 'challenge', '999', '429', '403', 'forbidden', 'verify', 'sign in'];
export const MIN_GAP_BETWEEN_LISTINGS_SEC = 20;
export const MIN_DELAY_SEC = 3;
export const MAX_DELAY_SEC = 8;
export const MIN_SUBMIT_DELAY_SEC = 20;

function clean(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function hashOf(str) {
  let h = 2166136261 >>> 0;
  const s = String(str === undefined || str === null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Jeda antar aksi yang menyerupai manusia: 3-8 detik, deterministik dari seed.
export function humanDelay(seed) {
  return MIN_DELAY_SEC + (hashOf(seed) % (MAX_DELAY_SEC - MIN_DELAY_SEC + 1));
}

// Deteksi sinyal blocking (captcha/challenge/999/429/403/forbidden/verify/sign in).
export function shouldStop(signalText) {
  const t = clean(signalText).toLowerCase();
  if (!t) return false;
  return STOP_SIGNALS.some((sig) => t.indexOf(sig) >= 0);
}

function safeFolder(name) {
  return clean(name).replace(/\s+/g, '_') || 'Perusahaan';
}

function cvFieldList(cv) {
  if (cv && typeof cv === 'object') return Object.keys(cv).filter((k) => clean(cv[k]));
  if (typeof cv === 'string' && cv.trim()) return ['resume (teks)'];
  return [];
}

// Langkah dasar (berhenti di tahap review, tanpa aksi kirim).
function baseSteps(ctx) {
  const seed = ctx.seed;
  const steps = [];
  steps.push({
    do: 'open-listing',
    detail: 'Buka ' + (ctx.url || 'URL lowongan dari Job_Listings.csv') + ' di browser cloud (Playwright), bukan fetch mentah. Set viewport 1280x900.',
    delaySec: humanDelay(seed + '|open'),
    guard: 'Pakai storage state milik akun sendiri bila tersedia; jangan memakai akun pihak lain.',
  });
  steps.push({
    do: 'check-session',
    detail: 'Pastikan sesi login adalah akun milik pengguna sendiri dan halaman tidak menampilkan sinyal blocking.',
    delaySec: humanDelay(seed + '|session'),
    guard: 'Kalau muncul captcha, challenge, 999, 429, 403, atau verifikasi identitas: hentikan, tulis frame_status.json step = "blocked", lalu tanya user.',
  });
  steps.push({
    do: 'prepare-materials',
    detail: 'Siapkan folder Applications/' + safeFolder(ctx.company) + '/ berisi resume_tailored.md, cover_letter.md (maks 400 kata), followup_email.md (maks 100 kata).',
    delaySec: humanDelay(seed + '|materials'),
    guard: 'Isi bahan lamaran diambil dari CV master; jangan menambah pengalaman, jabatan, atau keahlian yang tidak ada.',
  });
  steps.push({
    do: 'attach-cv',
    detail: 'Unggah resume_tailored.md ke kolom CV/resume, atau tempel ringkasan CV bila formulir meminta berkas.',
    delaySec: humanDelay(seed + '|attach'),
    guard: 'Jangan mengarang pengalaman; field yang tidak ada di CV dikosongkan lalu ditandai untuk user.',
  });
  steps.push({
    do: 'fill-form',
    detail: 'Isi field formulir (nama, email, telepon, lokasi, pendidikan, pengalaman, keahlian, jawaban wajib) HANYA dari data CV.',
    delaySec: humanDelay(seed + '|fill'),
    guard: 'Hanya data CV yang boleh dipakai; field yang tidak dikenal dibiarkan kosong, jangan menebak.',
  });
  steps.push({
    do: 'capture-frame',
    detail: 'Tulis frame_latest.png dan frame_status.json (goal, url, step, caption) setiap selesai satu langkah penting.',
    delaySec: humanDelay(seed + '|frame'),
    guard: 'frame_status.json wajib berisi goal, url, step, caption supaya bisa diaudit.',
  });
  steps.push({
    do: 'review',
    detail: 'Tinjau isian formulir, catat field yang kosong atau tidak ada di CV, kirim ringkasan singkat ke user, lalu tunggu instruksi lanjutan.',
    delaySec: humanDelay(seed + '|review'),
    guard: 'Tahan di tahap review sampai ada instruksi lanjutan dari user.',
  });
  return steps;
}

// Instruksi lengkap untuk agen cloud (Bahasa Indonesia).
export function buildApplyMessage({ listing = {}, cv = null, mode = 'confirm', dailyCap = 5, appliedToday = 0, needsConfirmation = true, submitDelaySec = MIN_SUBMIT_DELAY_SEC, blockedReason = '' } = {}) {
  const company = clean(listing.company) || 'Perusahaan';
  const role = clean(listing.role) || 'Posisi';
  const url = clean(listing.url) || '(URL lowongan dari Job_Listings.csv)';
  const m = String(mode || 'confirm').toLowerCase() === 'auto' ? 'auto' : 'confirm';
  const fields = cvFieldList(cv);
  const body = [];

  body.push('Buka ' + url + ' lewat BROWSER cloud (Playwright), JANGAN fetch mentah ke linkedin.com (kode 999 anti-bot). Set viewport 1280x900.');
  body.push('Pakai storage state akun milik pengguna sendiri. Kalau belum login, berhenti dan minta user login; jangan memakai akun orang lain.');
  body.push('Tulis frame_latest.png dan frame_status.json (goal, url, step, caption) setiap selesai satu langkah penting.');
  body.push('Siapkan bahan di Applications/' + safeFolder(company) + '/: resume_tailored.md, cover_letter.md (maks 400 kata), followup_email.md (maks 100 kata).');
  if (fields.length) {
    body.push('Isi formulir HANYA dari data CV master (data tersedia: ' + fields.join(', ') + '). Jangan mengarang pengalaman, pendidikan, keahlian, jabatan, atau kontak. Field yang tidak ada di CV dikosongkan lalu ditandai untuk user.');
  } else {
    body.push('Data CV belum tersedia. Jangan isi form apa pun; tulis frame_status.json step = "blocked" dan minta CV master dari user.');
  }
  if (m === 'auto' && !needsConfirmation) {
    body.push('Setelah isian lengkap dan tervalidasi, jeda minimal ' + submitDelaySec + ' detik, lalu tekan tombol kirim satu kali saja.');
  } else {
    body.push('Isi formulir sampai tahap REVIEW lalu BERHENTI. Jangan tekan tombol kirim atau submit. Kirim ringkasan singkat ke user dan tunggu instruksi sebelum melamar.');
  }
  body.push('Aturan submit: tekan tombol kirim hanya di mode auto, atau di mode confirm setelah ada konfirmasi user.');
  body.push('Kalau muncul captcha, challenge, 999, 429, 403, atau verifikasi identitas: hentikan aksi, tulis frame_status.json step = "blocked", laporkan ke user, jangan bypass.');
  body.push('Jeda minimal ' + MIN_GAP_BETWEEN_LISTINGS_SEC + ' detik antar lowongan sebelum membuka lowongan berikutnya.');
  if (blockedReason) {
    body.push('BLOKIR: ' + blockedReason + '. Jangan mengirim, minta persetujuan user.');
  } else if (m === 'auto') {
    body.push('Setelah berhasil mengirim, perbarui status baris Job_Listings.csv jadi "applied" dan catat tanggalnya.');
  }

  const header = [
    '# INSTRUKSI AGEN CLOUD - LAMARAN LINKEDIN',
    'Lowongan: ' + company + ' - ' + role,
    'URL: ' + url,
    'Mode: ' + m + ' | kuota hari ini: ' + appliedToday + '/' + dailyCap + ' | needsConfirmation: ' + (needsConfirmation ? 'true' : 'false'),
    '',
  ];
  const numbered = body.map((t, i) => (i + 1) + ') ' + t);
  return header.concat(numbered).join('\n');
}

// Rencana apply untuk satu lowongan. Mode confirm berhenti di review; mode auto boleh kirim
// selama kuota harian belum terlampaui.
export function buildApplyPlan({ listing = {}, cv = null, mode = 'confirm', dailyCap = 5, appliedToday = 0 } = {}) {
  const m = String(mode || 'confirm').toLowerCase() === 'auto' ? 'auto' : 'confirm';
  const cap = Number.isFinite(Number(dailyCap)) ? Number(dailyCap) : 5;
  const done = Number.isFinite(Number(appliedToday)) ? Number(appliedToday) : 0;
  const capReached = done >= cap;
  const company = clean(listing.company) || 'Perusahaan';
  const role = clean(listing.role) || 'Posisi';
  const url = clean(listing.url);
  const fields = cvFieldList(cv);
  const seed = [company, role, url, m, Date.now()].join('|');
  const submitDelaySec = MIN_SUBMIT_DELAY_SEC + (hashOf(seed + '|submit') % 5);

  const ctx = { company, role, url, seed };
  const steps = baseSteps(ctx);
  const needsConfirmation = m === 'confirm' || capReached;
  let blockedReason = '';

  if (m === 'auto' && !capReached) {
    steps.push({
      do: 'submit',
      detail: 'Tunggu minimal ' + submitDelaySec + ' detik sejak langkah terakhir, lalu tekan tombol kirim (submit) satu kali. Jangan kirim ulang.',
      delaySec: submitDelaySec,
      guard: 'Kirim hanya satu kali; kalau tombol gagal atau halaman tetap sama, berhenti dan tanya user.',
    });
    steps.push({
      do: 'record-result',
      detail: 'Verifikasi halaman konfirmasi, tulis frame_status.json (step = "applied"), lalu perbarui status baris Job_Listings.csv jadi "applied".',
      delaySec: humanDelay(seed + '|record'),
      guard: 'Kalau tidak ada halaman konfirmasi, tandai status "reviewing" dan laporkan ke user, jangan menebak.',
    });
  }

  if (capReached) {
    blockedReason = 'batas harian tercapai';
  }

  let summary;
  if (m === 'auto' && !capReached) {
    summary = 'Mode otomatis: lamaran ' + company + ' - ' + role + ' dikirim setelah jeda ' + submitDelaySec + ' detik. Kuota hari ini ' + done + '/' + cap + '.';
  } else if (capReached) {
    summary = 'Batas harian tercapai (' + done + '/' + cap + '). Lamaran ' + company + ' - ' + role + ' disiapkan tapi tidak dikirim, perlu persetujuan user.';
  } else {
    summary = 'Mode konfirmasi: lamaran ' + company + ' - ' + role + ' disiapkan (resume_tailored.md, cover_letter.md, followup_email.md) dan form sudah diisi, belum dikirim. Menunggu persetujuan user.';
  }

  const message = buildApplyMessage({
    listing,
    cv,
    mode: m,
    dailyCap: cap,
    appliedToday: done,
    needsConfirmation,
    submitDelaySec,
    blockedReason,
  });

  return {
    mode: m,
    needsConfirmation,
    steps,
    stopConditions: STOP_CONDITIONS.slice(),
    stopPolicy: STOP_POLICY,
    summary,
    message,
    blockedReason,
    company,
    role,
    url,
    cvAvailable: fields.length > 0,
    cvFields: fields,
    dailyCap: cap,
    appliedToday: done,
    submitDelaySec,
    minGapBetweenListingsSec: MIN_GAP_BETWEEN_LISTINGS_SEC,
  };
}
