# Kepemilikan Pool Akun OAuth (WAJIB dibaca sebelum test)

## Aturan dasar

Refresh token OAuth **single-use**: begitu satu runtime me-refresh akun X, token lama X langsung
tidak berlaku untuk runtime manapun. Salinan lain yang memegang token lama akan mendapat
`invalid_grant` dan akun itu **mati permanen** di salinan tersebut (tidak ada password untuk
mengembalikan).

Artinya: satu akun hanya boleh dipakai **satu runtime** pada satu waktu.

## Pembagian peran

| Runtime | Akun yang boleh dipakai | Keterangan |
|---|---|---|
| Container Northflank (produksi) | SELURUH chain (`/data/accounts.json`) | Pemilik utama. Semua refresh token hasil refresh di sini adalah yang valid. |
| Test lokal (`test/*.mjs`) | HANYA slice index **>= 1000** | Slice ini tidak dipakai container dalam operasi normal. |
| Uji QA Telegram | HANYA slice index **>= 1000** | Sama, dan akun slice QA tidak boleh dipakai agent lain. |

## Cara test lokal mengambil slice aman

```text
accounts-full.json  ->  potong array accounts mulai index 1000  ->  simpan accounts-slice.json
MINIMAX_DATA_DIR    ->  folder test khusus (bukan /data produksi)
```

Kalau sebuah test memakai akun di luar slice aman, akun itu akan mati di container saat
access token-nya kedaluwarsa. Gejalanya: `/ops/pool` naikkan angka `dead` tanpa sebab jelas.

## Refresh token hasil refresh

- Pool melakukan write-back atomik (tmp + rename) ke file chain setiap kali refresh berhasil.
- Kalau `invalid_grant`, akun ditandai `dead` dan dilewati selamanya.
- Jangan pernah menyalin file chain ke runtime lain kecuali lewat `POST /ops/chain` (itu
  menyalin chain mentah, bukan state refresh).

## Rotasi

- Rotasi hanya saat kredit habis. Urutan: cek kredit -> klaim check-in harian ->rotasi.
- `pool.currentIndex` dilanjutkan dari `state.accounts.currentIndex` setelah restart container.
- Sesudah rotasi, konteks dipindahkan: export histori (token akun **owner** sesi) -> sesi baru
  di akun tujuan -> inject brief + context bundle.

## Memo wajib

- Jangan mencetak token, refresh token, atau `cdn_url` bertanda akun ke chat, log, atau file.
- Yang boleh tampil: label akun (`Account 2034`), id sesi, nama file, dan penanda uji.
