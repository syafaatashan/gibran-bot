// Uji formatter jawaban: 20 fixture balasan agen -> ringkas, tanpa markdown mentah.
import assert from 'node:assert/strict';
import { formatAnswer, chunkText, toTelegram } from '../src/format.mjs';

const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;

const bigTable = ['## Rekomendasi Lowongan', '', '| Posisi | Kota | Gaji |', '|---|---|---|']
  .concat(Array.from({ length: 20 }, (_, i) => '| Posisi ' + (i + 1) + ' | Kota ' + (i + 1) + ' | ' + (10 + i) + ' jt |'))
  .join('\n');

const longCode = '## Contoh Kode' + '\n\n' + FENCE + 'js' + '\n'
  + Array.from({ length: 30 }, (_, i) => 'const nilai' + i + ' = ' + i + ';').join('\n')
  + '\n' + FENCE;

const longList = '## Checklist' + '\n\n'
  + Array.from({ length: 25 }, (_, i) => '- Langkah ' + (i + 1) + ' untuk dikirim').join('\n');

const FIXTURES = [
  { name: 'jawaban pendek', hadTable: false, text: 'Ada 3 lowongan baru yang cocok dengan profil Anda.' },
  { name: 'heading dan paragraf', hadTable: false, text: '## Hasil Pencarian' + '\n' + 'Saya menemukan beberapa lowongan yang cocok dengan profil Anda di Makassar.' },
  { name: 'tabel kecil', hadTable: true, text: '## Kandidat' + '\n' + '| Posisi | Kota | Gaji |' + '\n' + '|---|---|---|' + '\n' + '| Data Analyst | Jakarta | 12 jt |' + '\n' + '| Analyst Risiko | Surabaya | 10 jt |' },
  { name: 'tabel besar', hadTable: true, text: bigTable },
  { name: 'kode pendek', hadTable: false, text: FENCE + 'js' + '\n' + 'const a = 1;' + '\n' + 'console.log(a);' + '\n' + FENCE },
  { name: 'kode panjang', hadTable: false, text: longCode },
  { name: 'daftar panjang', hadTable: false, text: longList },
  { name: 'jawaban kosong', hadTable: false, text: '' },
  { name: 'hanya spasi', hadTable: false, text: '   \n\n   \n ' },
  { name: 'blok meta saja', hadTable: false, text: 'Saya akan mencari lowongan yang cocok di JobStreet dan Glints, lalu menyiapkannya untuk Anda.' },
  { name: 'meta plus isi', hadTable: false, text: 'Ringkasan factual:' + '\n' + 'Ada 5 lowongan yang cocok.' + '\n\n' + 'Saya akan submisi CV ke yang paling cocok.' },
  { name: 'markdown campuran', hadTable: false, text: '**Tebal**, *miring*, ~~coret~~, [tautan](https://example.com), ' + BT + 'kode' + BT + '.' },
  { name: 'paragraf sangat panjang', hadTable: false, text: 'kata '.repeat(600) },
  { name: 'banyak heading', hadTable: false, text: Array.from({ length: 10 }, (_, i) => '## Bagian ' + (i + 1) + '\nIsi bagian ' + (i + 1) + '.').join('\n\n') },
  { name: 'campuran', hadTable: true, text: '## Ringkasan' + '\n' + 'Ada 2 kandidat.' + '\n\n' + '| Posisi | Kota |' + '\n' + '|---|---|' + '\n' + '| Analyst | Jakarta |' + '\n\n' + FENCE + 'js' + '\n' + 'const x = 1;' + '\n' + FENCE + '\n\n' + '- Satu' + '\n' + '- Dua' },
  { name: 'daftar bertingkat', hadTable: false, text: '- atas' + '\n' + '  - dalam' + '\n' + '    - paling dalam' },
  { name: 'karakter markdown mentah', hadTable: false, text: '### bukan heading' + '\n' + '***tebal miring***' + '\n' + '__garis bawah__' + '\n' + 'a | b | c' },
  { name: 'kata tunggal panjang', hadTable: false, text: 'x'.repeat(3000) },
  { name: 'rencana dan langkah', hadTable: false, text: 'Rencana:' + '\n' + '1. Cari lowongan' + '\n' + '2. Kirim CV' + '\n\n' + 'Langkah berikutnya:' + '\n' + 'Tunggu konfirmasi.' },
  { name: 'unicode dan emoji', hadTable: false, text: 'Selesai. 3 lamaran terkirim di Makassar, 2 di Jakarta, sisanya menunggu konfirmasi.' },
];

let cek = 0;
function uji(nama, fn) {
  fn();
  cek++;
  console.log('  ok - ' + nama);
}

try {
  console.log('formatAnswer: ' + FIXTURES.length + ' fixture');

  for (const f of FIXTURES) {
    const r = formatAnswer(f.text);
    uji(f.name + ' - panjang maksimal 1200 karakter', () => {
      assert.ok(typeof r.text === 'string', 'text harus string');
      assert.ok(r.text.length <= 1200, 'panjang ' + r.text.length + ' melebihi 1200');
    });
    uji(f.name + ' - tanpa markdown mentah', () => {
      assert.ok(!r.text.includes('##'), 'ada heading mentah: ' + r.text.slice(0, 80));
      assert.ok(!r.text.includes(FENCE), 'ada code fence mentah: ' + r.text.slice(0, 80));
    });
    uji(f.name + ' - hadTable benar', () => {
      assert.equal(r.hadTable, f.hadTable, 'hadTable harus ' + f.hadTable);
    });
    uji(f.name + ' - flag konsisten', () => {
      assert.equal(typeof r.truncated, 'boolean');
      assert.equal(typeof r.longDetail, 'boolean');
      assert.ok(r.text.trim().length > 0, 'hasil tidak boleh kosong');
    });
  }

  uji('heading jadi bold Telegram', () => {
    const r = formatAnswer('## Hasil Pencarian' + '\n' + 'Isi ringkas.');
    assert.ok(r.text.includes('*Hasil Pencarian*'), 'heading harus bold: ' + r.text);
  });

  uji('tabel jadi bullet', () => {
    const r = formatAnswer('| Posisi | Kota |' + '\n' + '|---|---|' + '\n' + '| Data Analyst | Jakarta |');
    assert.ok(r.text.includes('•'), 'tabel harus bullet: ' + r.text);
    assert.ok(r.text.includes('Data Analyst'), 'isi tabel hilang: ' + r.text);
  });

  uji('kode panjang diringkas jadi catatan', () => {
    const r = formatAnswer(longCode);
    assert.ok(r.text.includes('diringkas'), 'kode panjang harus diringkas: ' + r.text);
    assert.equal(r.longDetail, true, 'longDetail harus true');
  });

  uji('blok meta dibuang', () => {
    const r = formatAnswer('Ringkasan factual:' + '\n' + 'Ada 5 lowongan.' + '\n\n' + 'Saya akan submisi CV sekarang.');
    assert.ok(!r.text.includes('Saya akan'), 'niat kerja agen harus dibuang: ' + r.text);
    assert.ok(r.text.includes('5 lowongan'), 'isi ringkasan harus kept: ' + r.text);
  });

  uji('inline markdown dibersihkan', () => {
    const r = formatAnswer('**Tebal** dan ~~coret~~ dan [tautan](https://example.com).');
    assert.ok(!r.text.includes('**'), 'bold mentah bocor: ' + r.text);
    assert.ok(!r.text.includes('~~'), 'coret mentah bocor: ' + r.text);
    assert.ok(r.text.includes('https://example.com'), 'link hilang: ' + r.text);
  });

  uji('batas karakter khusus dipatuhi', () => {
    const r = formatAnswer('kata '.repeat(2000), { maxChars: 300 });
    assert.ok(r.text.length <= 300, 'panjang ' + r.text.length);
    assert.equal(r.truncated, true, 'harus truncated');
    assert.equal(r.longDetail, true, 'harus longDetail');
  });

  uji('batas blok dipatuhi (maksimal 3 blok)', () => {
    const r = formatAnswer(Array.from({ length: 9 }, (_, i) => '## Bagian ' + i + '\n' + 'Isi ' + i + '.').join('\n\n'));
    assert.ok(r.text.length <= 1200, 'panjang melebihi: ' + r.text.length);
    assert.equal(r.truncated, true, 'harus truncated');
  });

  uji('chunkText memecah pada batas', () => {
    const chunks = chunkText('baris ' + 'kata '.repeat(2000), 3900);
    assert.ok(chunks.length > 1, 'harus jadi beberapa chunk');
    for (const c of chunks) assert.ok(c.length <= 3900, 'chunk terlalu panjang: ' + c.length);
  });

  uji('chunkText tangani teks kosong', () => {
    assert.deepEqual(chunkText('', 100), []);
    assert.deepEqual(chunkText('   ', 100), []);
  });

  uji('chunkText tangani kata tunggal panjang', () => {
    const chunks = chunkText('x'.repeat(9500), 3900);
    assert.ok(chunks.length >= 3, 'harus dipecah paksa');
    for (const c of chunks) assert.ok(c.length <= 3900, 'chunk terlalu panjang: ' + c.length);
  });

  uji('toTelegram mengubah heading jadi bold', () => {
    const out = toTelegram('## Judul' + '\n' + 'Isi.');
    assert.ok(out.includes('*Judul*'), 'heading harus bold: ' + out);
    assert.ok(!out.includes('##'), 'markdown mentah bocor: ' + out);
  });

  uji('toTelegram membuang code fence mentah', () => {
    const out = toTelegram(FENCE + 'js' + '\n' + 'const a = 1;' + '\n' + FENCE);
    assert.ok(!out.includes(FENCE), 'code fence bocor: ' + out);
    assert.ok(out.includes('const a = 1;'), 'isi kode hilang: ' + out);
  });

  console.log('format: ' + cek + ' pemeriksaan lolos');
} catch (e) {
  console.error('GAGAL: ' + (e && e.message ? e.message : e));
  if (e && e.stack) console.error(String(e.stack).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
