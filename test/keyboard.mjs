// Uji keyboard inline + konstanta callback.
import assert from 'node:assert/strict';
import {
  MAIN_MENU, APPLY_CONFIRM, MODE_MENU, BROWSER_MENU, ALL_CALLBACKS,
  toInlineKeyboard, findByCallback,
  CB_SCAN, CB_CV, CB_APPLY, CB_STATUS, CB_BROWSER, CB_MODE_CONFIRM, CB_MODE_AUTO,
  CB_APPLY_YES, CB_APPLY_NO, CB_REMOTE, CB_TAKEOVER, CB_RESUME, CB_BACK, CB_RELOAD,
} from '../src/keyboard.mjs';

let cek = 0;
function uji(nama, fn) {
  fn();
  cek++;
  console.log('  ok - ' + nama);
}

const KEYBOARDS = [
  { nama: 'MAIN_MENU', rows: MAIN_MENU },
  { nama: 'APPLY_CONFIRM', rows: APPLY_CONFIRM },
  { nama: 'MODE_MENU', rows: MODE_MENU },
  { nama: 'BROWSER_MENU', rows: BROWSER_MENU },
];

try {
  console.log('keyboard: ' + KEYBOARDS.length + ' keyboard, ' + ALL_CALLBACKS.length + ' callback');

  uji('nilai konstanta callback sesuai', () => {
    assert.equal(CB_SCAN, 'gibran:scan');
    assert.equal(CB_CV, 'gibran:cv');
    assert.equal(CB_APPLY, 'gibran:apply');
    assert.equal(CB_STATUS, 'gibran:status');
    assert.equal(CB_BROWSER, 'gibran:browser');
    assert.equal(CB_MODE_CONFIRM, 'gibran:mode:confirm');
    assert.equal(CB_MODE_AUTO, 'gibran:mode:auto');
    assert.equal(CB_APPLY_YES, 'gibran:apply:yes');
    assert.equal(CB_APPLY_NO, 'gibran:apply:no');
    assert.equal(CB_REMOTE, 'gibran:remote');
    assert.equal(CB_TAKEOVER, 'gibran:browser:takeover');
    assert.equal(CB_RESUME, 'gibran:browser:resume');
    assert.equal(CB_BACK, 'gibran:browser:back');
    assert.equal(CB_RELOAD, 'gibran:browser:reload');
  });

  uji('semua konstanta callback unik', () => {
    assert.equal(new Set(ALL_CALLBACKS).size, ALL_CALLBACKS.length, 'ada callback duplikat');
  });

  uji('semua konstanta callback terdaftar di ALL_CALLBACKS', () => {
    for (const cb of [CB_SCAN, CB_CV, CB_APPLY, CB_STATUS, CB_BROWSER, CB_MODE_CONFIRM, CB_MODE_AUTO,
      CB_APPLY_YES, CB_APPLY_NO, CB_REMOTE, CB_TAKEOVER, CB_RESUME, CB_BACK, CB_RELOAD]) {
      assert.ok(ALL_CALLBACKS.includes(cb), 'kurang: ' + cb);
    }
  });

  for (const kb of KEYBOARDS) {
    uji(kb.nama + ' - bentuk keyboard valid', () => {
      assert.ok(Array.isArray(kb.rows), 'harus array baris');
      assert.ok(kb.rows.length > 0, 'baris tidak boleh kosong');
      for (const row of kb.rows) {
        assert.ok(Array.isArray(row), 'baris harus array tombol');
        assert.ok(row.length > 0, 'baris tidak boleh kosong');
      }
    });

    uji(kb.nama + ' - tombol dan callback valid', () => {
      const seen = new Set();
      for (const row of kb.rows) {
        for (const b of row) {
          assert.ok(b && typeof b.text === 'string', 'tombol harus punya text');
          assert.ok(b.text.trim().length > 0, 'text tombol tidak boleh kosong');
          assert.ok(b.text.length <= 24, 'text tombol kepanjangan: ' + b.text);
          assert.equal(typeof b.callback_data, 'string', 'tombol harus punya callback_data');
          assert.ok(/^gibran:[a-z:]+$/.test(b.callback_data), 'callback_data tidak valid: ' + b.callback_data);
          assert.ok(ALL_CALLBACKS.includes(b.callback_data), 'callback tak dikenal: ' + b.callback_data);
          assert.ok(b.callback_data.length <= 64, 'callback_data kepanjangan');
          assert.ok(!seen.has(b.callback_data), 'callback duplikat dalam satu keyboard: ' + b.callback_data);
          seen.add(b.callback_data);
        }
      }
    });

    uji(kb.nama + ' - reply_markup valid', () => {
      const markup = toInlineKeyboard(kb.rows);
      assert.ok(markup && Array.isArray(markup.inline_keyboard), 'inline_keyboard wajib ada');
      assert.equal(markup.inline_keyboard.length, kb.rows.length, 'jumlah baris tidak sama');
      markup.inline_keyboard.forEach((row, i) => {
        assert.ok(Array.isArray(row) && row.length > 0, 'baris markup kosong');
        row.forEach((b, j) => {
          assert.equal(typeof b.text, 'string');
          assert.equal(b.callback_data, kb.rows[i][j].callback_data, 'callback_data tidak sama');
          assert.equal(Object.keys(b).length, 2, 'tombol markup harus text + callback_data');
        });
      });
    });
  }

  uji('layout menu utama sesuai', () => {
    assert.equal(MAIN_MENU.length, 3, 'menu utama harus 3 baris');
    assert.deepEqual(MAIN_MENU.map((r) => r.length), [2, 2, 2]);
    assert.deepEqual(MAIN_MENU.map((r) => r.map((b) => b.text)), [
      ['Cari lowongan', 'CV saya'],
      ['Apply', 'Status'],
      ['Browser live', 'Mode'],
    ]);
  });

  uji('layout konfirmasi apply sesuai', () => {
    assert.equal(APPLY_CONFIRM.length, 1);
    assert.deepEqual(APPLY_CONFIRM[0].map((b) => b.text), ['Setujui & kirim', 'Ubah', 'Batal']);
    assert.deepEqual(APPLY_CONFIRM[0].map((b) => b.callback_data), [CB_APPLY_YES, CB_CV, CB_APPLY_NO]);
  });

  uji('layout menu mode sesuai', () => {
    assert.equal(MODE_MENU.length, 1);
    assert.deepEqual(MODE_MENU[0].map((b) => b.text), ['Konfirmasi', 'Auto submit']);
    assert.deepEqual(MODE_MENU[0].map((b) => b.callback_data), [CB_MODE_CONFIRM, CB_MODE_AUTO]);
  });

  uji('layout menu browser sesuai', () => {
    assert.equal(BROWSER_MENU.length, 2);
    assert.deepEqual(BROWSER_MENU.map((r) => r.length), [2, 2]);
    assert.deepEqual(BROWSER_MENU.map((r) => r.map((b) => b.text)), [
      ['Ambil alih', 'Kembali ke bot'],
      ['Back', 'Reload'],
    ]);
    assert.equal(BROWSER_MENU[1][0].callback_data, CB_BACK);
    assert.equal(BROWSER_MENU[1][1].callback_data, CB_RELOAD);
  });

  uji('cari tombol lewat callback data', () => {
    const b = findByCallback(MAIN_MENU, CB_SCAN);
    assert.ok(b, 'tombol tidak ditemukan');
    assert.equal(b.text, 'Cari lowongan');
    assert.equal(findByCallback(MAIN_MENU, 'gibran:tidak-ada'), null);
  });

  console.log('keyboard: ' + cek + ' pemeriksaan lolos');
} catch (e) {
  console.error('GAGAL: ' + (e && e.message ? e.message : e));
  if (e && e.stack) console.error(String(e.stack).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
