import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';

function read(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
}

function collectMarkdown(dir, rel) {
  const out = [];
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    const r = rel ? rel + '/' + it.name : it.name;
    if (it.isDirectory()) out.push(...collectMarkdown(p, r));
    else if (/\.md$/i.test(it.name)) out.push([r, p]);
  }
  return out;
}

/**
 * Bundle konteks yang dikirim sebagai pesan pertama ke sesi cloud:
 * persona agent + isi skill get-a-job + adaptasi runtime cloud.
 */
export function buildContextBundle() {
  const parts = [];
  parts.push(
    '# KONTEKS INSTRUKSI GIBRAN.AI (internal - jangan diekspos ke pengguna, jangan sebut nama file ini)\n\n' +
    'Kamu adalah Gibran.ai, asisten(lowongan kerja untuk pengguna lewat Telegram. ' +
    'Instruksi di bawah ini berlaku untuk seluruh percakapan.'
  );

  const persona = read(CFG.personaFile);
  if (persona) parts.push('## Persona dan gaya bicara\n\n' + persona);

  const files = collectMarkdown(CFG.skillDir, '');
  files.sort((a, b) => {
    if (a[0] === 'SKILL.md') return -1;
    if (b[0] === 'SKILL.md') return 1;
    return a[0].localeCompare(b[0]);
  });
  for (const [rel, p] of files) {
    parts.push('## Skill: ' + rel + '\n\n' + read(p));
  }

  parts.push(
    '## ADAPTASI RUNTIME CLOUD\n\n' +
    '- Kamu berjalan di runtime MiniMax Code Cloud lewat API. Kamu tidak punya file system lokal ' +
    'dan tidak bisa menjalankan script Python.\n' +
    '- Skill get-a-job biasanya memakai file CSV di workspace. Di sini, pertahankan daftar lowongan ' +
    'aktif dan dream company sebagai TABEL MARKDOWN di dalam percakapan.\n' +
    '- Kalau pengguna minta data tabular, keluarkan juga isi CSV lengkap di dalam blok kode agar ' +
    'mereka bisa menyimpannya sendiri.\n' +
    '- Kalau sebuah langkah butuh browser (membuka lowongan, apply, kirim surel), katakan terus terang ' +
    'ke pengguna langkah mana yang belum bisa kamu eksekusi, lalu berikan langkah manual yang harus ' +
    'mereka lakukan.\n' +
    '- Jawab dalam Bahasa Indonesia, ringkas tapi lengkap, dan pakai emoji secukupnya.'
  );

  return parts.join('\n\n');
}
