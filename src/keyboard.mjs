// Keyboard inline + konstanta callback untuk bot Gibran.ai.
// Tombol Bahasa Indonesia singkat supaya enak dibaca di layar HP.

export const CB_SCAN = 'gibran:scan';
export const CB_CV = 'gibran:cv';
export const CB_APPLY = 'gibran:apply';
export const CB_STATUS = 'gibran:status';
export const CB_BROWSER = 'gibran:browser';
export const CB_MODE_CONFIRM = 'gibran:mode:confirm';
export const CB_MODE_AUTO = 'gibran:mode:auto';
export const CB_APPLY_YES = 'gibran:apply:yes';
export const CB_APPLY_NO = 'gibran:apply:no';
export const CB_REMOTE = 'gibran:remote';
export const CB_TAKEOVER = 'gibran:browser:takeover';
export const CB_RESUME = 'gibran:browser:resume';
export const CB_BACK = 'gibran:browser:back';
export const CB_RELOAD = 'gibran:browser:reload';
// tambahan: tombol "Mode" di menu utama membuka menu mode
export const CB_MODE_MENU = 'gibran:mode';

export const ALL_CALLBACKS = Object.freeze([
  CB_SCAN, CB_CV, CB_APPLY, CB_STATUS, CB_BROWSER, CB_MODE_MENU,
  CB_MODE_CONFIRM, CB_MODE_AUTO, CB_APPLY_YES, CB_APPLY_NO, CB_REMOTE,
  CB_TAKEOVER, CB_RESUME, CB_BACK, CB_RELOAD,
]);

const btn = (text, callback_data) => ({ text, callback_data });

export const MAIN_MENU = [
  [btn('Cari lowongan', CB_SCAN), btn('CV saya', CB_CV)],
  [btn('Apply', CB_APPLY), btn('Status', CB_STATUS)],
  [btn('Browser live', CB_BROWSER), btn('Mode', CB_MODE_MENU)],
];

export const APPLY_CONFIRM = [
  [btn('Setujui & kirim', CB_APPLY_YES), btn('Ubah', CB_CV), btn('Batal', CB_APPLY_NO)],
];

export const MODE_MENU = [
  [btn('Konfirmasi', CB_MODE_CONFIRM), btn('Auto submit', CB_MODE_AUTO)],
];

export const BROWSER_MENU = [
  [btn('Ambil alih', CB_TAKEOVER), btn('Kembali ke bot', CB_REMOTE)],
  [btn('Back', CB_BACK), btn('Reload', CB_RELOAD)],
];

// ubah baris tombol jadi reply_markup Telegram
export function toInlineKeyboard(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    inline_keyboard: list.map((row) => {
      const arr = Array.isArray(row) ? row : [row];
      return arr.filter(Boolean).map((b) => {
        const item = { text: String(b.text || '') };
        if (b.callback_data) item.callback_data = String(b.callback_data);
        else if (b.url) item.url = String(b.url);
        return item;
      });
    }),
  };
}

// cari tombol berdasarkan callback data
export function findByCallback(rows, data) {
  for (const row of rows || []) {
    for (const b of row || []) {
      if (b && b.callback_data === data) return b;
    }
  }
  return null;
}
