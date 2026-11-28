// drive-list.mjs - alat bantu QA: cek isi MiniMax Cloud Drive via listDrive.
// Hanya memakai akun dari accounts-slice.json (indeks >= 1000, tidak dipakai container).
// Token dibaca dari file dan TIDAK PERNAH dicetak. Keluarannya hanya nama file.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot-src');
const SLICE = path.resolve('E:/Minimax Code/Minimax-Cloud/bot-workspaces/deploy/gibran-bot/accounts-slice.json');
const imp = (p) => import(pathToFileURL(p).href);

const { listDrive } = await imp(ROOT + '/src/cloud-files.mjs');
const raw = JSON.parse(fs.readFileSync(SLICE, 'utf8'));
const accounts = raw.accounts || [];
const now = Date.now();
const usable = accounts.filter((a) => a && a.accessToken && Number(a.expiresAtMs || 0) > now + 120000);
console.log('akun di slice: ' + accounts.length + ' | token belum kedaluwarsa: ' + usable.length);

let done = false;
for (const acc of usable.slice(0, 3)) {
  try {
    const nodes = await listDrive({ token: acc.accessToken });
    console.log('--- drive akun ' + acc.label + ' -> ' + nodes.length + ' node ---');
    for (const n of nodes.slice(0, 25)) {
      console.log('  ' + n.name + ' | ' + n.mime + ' | ' + n.size + ' B | ' + new Date(n.updatedAt || 0).toISOString());
    }
    done = true;
    break;
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.log('akun ' + acc.label + ' gagal: ' + msg.slice(0, 120).replace(/[A-Za-z0-9_\-]{20,}/g, '<redacted>'));
  }
}
if (!done) console.log('TIDAK ADA node drive yang bisa dibaca');
