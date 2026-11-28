// test/users.mjs - uji isolasi per pengguna.
//
// Yang diuji:
// - dua chatId -> akun sticky berbeda, file profil terpisah, tidak saling bocor
// - setMode hanya menerima 'confirm'|'auto'
// - canApply/markApplied naik-turun, cap dihormati, reset saat tanggal berubah
// - assignStickyAccount idempoten dan tidak memakai akun dead
// - userContextBlock memuat identitas sendiri, tidak memuat data user lain
//
// Folder data uji dibuat di folder temp. Folder produksi (/data) tidak disentuh.
// CATATAN: tidak ada token/secret yang dicetak.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Arahkan data ke folder temp SEBELUM modul diimpor (config dibaca saat import).
const TMP = path.join(os.tmpdir(), 'gibran-users-test-' + Date.now() + '-' + Math.floor(Math.random() * 100000));
process.env.PROFILE_DIR = TMP;
process.env.MINIMAX_DATA_DIR = TMP;
process.env.BOT_DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const imp = (p) => import(pathToFileURL(p).href);
const U = await imp(ROOT + '/src/users.mjs');

const A = '111';
const B = '222';
const C = '333';
const D = '444';

let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}

// Pool palsu: 1.205 akun sehingga segmen user (indeks >= 1000) tersedia.
// tokenFor sengaja dibuat gagal: layer user tidak boleh menyentuh token.
function fakePool(n, deadIdx = []) {
  const accounts = [];
  for (let i = 0; i < n; i++) {
    accounts.push({
      label: 'Akun Uji ' + i,
      email: 'uji' + i + '@contoh.test',
      dead: deadIdx.includes(i),
    });
  }
  return {
    accounts,
    async agentIdFor(label) { return 'agent-uji-' + label; },
    async tokenFor() { throw new Error('token tidak boleh diakses di layer user'); },
    persist() { this.persisted = (this.persisted || 0) + 1; },
  };
}

const idxOf = (label) => Number(String(label).replace(/[^0-9]/g, ''));
let cLabel = ''; // label akun milik user C, dipakai lintas blok
let poolDead = null; // pool dengan akun mati, dipakai lintas blok

console.log('=== UJI ISOLASI PER PENGGUNA ===');
console.log('folder uji: ' + TMP);

// U1 - profil default
{
  const p = U.getProfile(A);
  check('U1 profil default', p.mode === 'confirm' && p.applyDailyCap === 5 && p.accountLabel === ''
    && p.appliedToday === 0 && p.appliedDate === '' && p.manual === false
    && Array.isArray(p.reservedAccounts) && p.reservedAccounts.length === 0,
    'mode=' + p.mode + ' cap=' + p.applyDailyCap);
}

// U2 - dua user dapat akun berbeda dari segmen >= 1000
const pool = fakePool(1205);
const a1 = await U.assignStickyAccount(A, { pool });
const b1 = await U.assignStickyAccount(B, { pool });
check('U2 akun sticky berbeda per user', a1.label !== b1.label, a1.label + ' vs ' + b1.label);
check('U2b akun dari segmen user (indeks >= 1000)',
  idxOf(a1.label) >= 1000 && idxOf(b1.label) >= 1000,
  a1.label + ' / ' + b1.label);
check('U2c agent id dikembalikan', !!a1.agentId && !!b1.agentId, a1.agentId + ' / ' + b1.agentId);

// U3 - file profil terpisah
{
  const fa = path.join(TMP, A, 'profile.json');
  const fb = path.join(TMP, B, 'profile.json');
  const ja = JSON.parse(fs.readFileSync(fa, 'utf8'));
  const jb = JSON.parse(fs.readFileSync(fb, 'utf8'));
  check('U3 file profil terpisah per user',
    fs.existsSync(fa) && fs.existsSync(fb) && ja.chatId === A && jb.chatId === B,
    fa + ' | ' + fb);
  check('U3b isi file tidak sama', ja.accountLabel !== jb.accountLabel,
    ja.accountLabel + ' vs ' + jb.accountLabel);
}

// U4 - tidak saling bocor
{
  const ja = U.getProfile(A);
  const jb = U.getProfile(B);
  check('U4 reservasi tidak bocor antar user',
    !ja.reservedAccounts.includes(b1.label) && !jb.reservedAccounts.includes(a1.label),
    'A=' + ja.reservedAccounts.join(',') + ' | B=' + jb.reservedAccounts.join(','));
}

// U5 - setMode hanya menerima confirm/auto
{
  let threw = 0;
  try { U.setMode(A, 'gila'); } catch { threw++; }
  try { U.setMode(A, 'turbo'); } catch { threw++; }
  try { U.setMode(A, 123); } catch { threw++; }
  try { U.setMode(A, ''); } catch { threw++; }
  const okMode = U.setMode(A, 'auto').mode;
  const okMode2 = U.setMode(A, 'confirm').mode;
  check('U5 setMode menolak mode tak sah', threw === 4, 'ditolak ' + threw + '/4');
  check('U5b setMode menerima confirm/auto', okMode === 'auto' && okMode2 === 'confirm',
    okMode + ' -> ' + okMode2);
  check('U5c mode tiap user terpisah', U.getProfile(A).mode === 'confirm' && U.getProfile(B).mode === 'confirm',
    'A=' + U.getProfile(A).mode + ' B=' + U.getProfile(B).mode);
}

// U6 - canApply + markApplied (naik-turun, cap dihormati)
{
  U.patchProfile(A, { mode: 'auto', applyDailyCap: 2 });
  const s1 = U.canApply(A);
  const c1 = U.markApplied(A).appliedToday;
  const s2 = U.canApply(A);
  const c2 = U.markApplied(A).appliedToday;
  const s3 = U.canApply(A);
  const rem = U.dailyRemaining(A);
  check('U6 canApply/markApplied naik-turun',
    s1 === true && c1 === 1 && s2 === true && c2 === 2 && s3 === false,
    's1=' + s1 + ' c1=' + c1 + ' s2=' + s2 + ' c2=' + c2 + ' s3=' + s3);
  check('U6b cap harian dihormati', rem === 0 && U.getProfile(A).appliedToday === 2,
    'sisa=' + rem + ' terpakai=' + U.getProfile(A).appliedToday);
}

// U7 - mode confirm boleh menyiapkan walau cap terlampaui
{
  U.patchProfile(B, { applyDailyCap: 1 });
  U.markApplied(B); U.markApplied(B); U.markApplied(B);
  check('U7 mode confirm tetap boleh apply', U.canApply(B) === true,
    'terpakai=' + U.getProfile(B).appliedToday + ' sisa=' + U.dailyRemaining(B));
}

// U8 - reset otomatis saat tanggal berubah
{
  U.patchProfile(A, { appliedDate: '2020-01-01', appliedToday: 9 });
  const before = U.canApply(A);
  const after = U.markApplied(A);
  check('U8 reset saat tanggal berubah',
    before === true && after.appliedToday === 1 && after.appliedDate === U.todayISO(),
    'appliedDate=' + after.appliedDate + ' appliedToday=' + after.appliedToday);
}

// U9 - assignStickyAccount idempoten
{
  const again = await U.assignStickyAccount(A, { pool });
  check('U9 assignStickyAccount idempoten', again.label === a1.label && again.agentId === a1.agentId,
    a1.label + ' -> ' + again.label);
}

// U10 - akun dead dilewati, akun terpakai user lain dilewati
{
  poolDead = fakePool(1205, [1000]);
  const c1 = await U.assignStickyAccount(C, { pool: poolDead });
  cLabel = c1.label;
  check('U10 akun dead tidak dipakai',
    c1.label !== 'Akun Uji 1000' && idxOf(c1.label) >= 1000 && c1.label !== a1.label && c1.label !== b1.label,
    c1.label);
}

// U11 - releaseAccount melepas akun (akun mati), profil lain utuh
{
  const beforeA = U.getProfile(A).accountLabel;
  const beforeB = U.getProfile(B).accountLabel;
  U.releaseAccount(C, cLabel);
  const pc = U.getProfile(C);
  check('U11 releaseAccount melepas akun',
    pc.accountLabel === '' && !pc.reservedAccounts.includes(cLabel),
    'accountLabel="' + pc.accountLabel + '" reserved=' + pc.reservedAccounts.length);
  check('U11b profil user lain tidak tersentuh',
    U.getProfile(A).accountLabel === beforeA && U.getProfile(B).accountLabel === beforeB,
    beforeA + ' / ' + beforeB);
  const d1 = await U.assignStickyAccount(D, { pool: poolDead });
  check('U11c akun yang dilepas bisa dipakai lagi', d1.label === cLabel, d1.label);
}

// U12 - akun dead pada profil yang sudah punya akun -> cari yang baru
{
  const poolDead2 = fakePool(1205, [1000, 1002]);
  const d2 = await U.assignStickyAccount(D, { pool: poolDead2 });
  check('U12 akun mati dilepas lalu diganti',
    d2.label !== 'Akun Uji 1002' && idxOf(d2.label) >= 1000 && d2.label !== a1.label && d2.label !== b1.label,
    d2.label);
}

// U13 - userContextBlock
{
  U.patchProfile(A, { cv: { name: 'Siti Aminah', email: 'siti@contoh.test' } });
  const blockA = U.userContextBlock(A);
  const blockB = U.userContextBlock(B);
  check('U13 konteks memuat identitas user sendiri',
    blockA.includes('Siti Aminah') && blockA.includes('siti@contoh.test') && blockA.includes(A),
    blockA.slice(0, 110));
  check('U13b konteks tidak bocor data user lain',
    !blockB.includes('Siti Aminah') && !blockB.includes('siti@contoh.test') && !blockB.includes(A),
    blockB.slice(0, 110));
  check('U13c konteks memuat perintah isolasi',
    blockB.includes('HANYA fakta milik pengguna ini') && blockB.includes('data pengguna lain'),
    'ok');
}

// U14 - exportForOps (tanpa token)
{
  const ops = U.exportForOps();
  const keys = Object.keys(ops[0] || {}).sort().join(',');
  check('U14 exportForOps bentuk benar',
    Array.isArray(ops) && ops.length >= 4 && keys === 'accountLabel,appliedToday,applyDailyCap,chatId,mode',
    keys + ' | ' + ops.length + ' user');
  const dump = JSON.stringify(ops).toLowerCase();
  check('U14b exportForOps tanpa token/secret',
    !dump.includes('token') && !dump.includes('refresh') && !dump.includes('secret'),
    'aman');
}

// U15 - listProfiles memuat semua user
{
  const all = U.listProfiles();
  const ids = all.map((p) => p.chatId).sort();
  check('U15 listProfiles memuat semua user',
    ids.length >= 4 && ids.includes(A) && ids.includes(B) && ids.includes(C) && ids.includes(D),
    ids.join(','));
}

// U16 - folder uji dibersihkan, folder produksi tidak disentuh
{
  fs.rmSync(TMP, { recursive: true, force: true });
  check('U16 folder uji dibersihkan', !fs.existsSync(TMP), TMP);
}

console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
