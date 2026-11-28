# Gibran.ai - bot Telegram (webhook)

Bot Telegram publik yang membantu pelamar kerja: membuat CV, mencari lowongan,
mencocokkan CV dengan lowongan, dan apply. Otaknya berjalan di MiniMax Code Cloud runtime.

## Arsitektur

```
Pengguna Telegram
   -> POST https://<host>/tg/webhook        (Telegram Bot API webhook)
   -> bot Node.js (service gibran-bot, Northflank)
        1. POST /minimax-cloud/api/v1/agent/{agentId}/session   -> buat sesi cloud
        2. POST /minimax-cloud/api/v1/session/{id}/message       -> SSE:
           isi = persona + skill get-a-job + pesan pengguna
        3. event type=6 (chunk msg_content) + type=2 (pesan final) -> teks jawaban
   -> sendMessage ke Telegram
```

Service bisa hidup 24/7 di Northflank tanpa MCode Desktop, karena otaknya
dieksekusi di cloud MiniMax, bukan di dalam container.

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/health` | liveness, status token, jumlah chat |
| GET | `/ready` | cek koneksi ke MiniMax Cloud + Telegram |
| POST | `/tg/webhook` | endpoint webhook Telegram (header `x-telegram-bot-api-secret-token`) |
| POST | `/ops/set-webhook` | daftar webhook ke Telegram (header `x-ops-token`) |
| GET | `/ops/webhook` | lihat status webhook di sisi Telegram |
| GET | `/ops/sessions` | peta chat_id ke sessionId cloud |

## Environment

| Nama | Isi |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | token bot dari BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | secret token header webhook |
| `MM_AGENT_ID` | nama agent cloud milik akun bot |
| `MM_ACCESS_TOKEN` / `MM_REFRESH_TOKEN` | kredensial OAuth akun bot (bootstrap) |
| `MM_AUTH_EXPIRES_AT_MS` | masa berlaku access token awal |
| `MM_CLOUD_BASE` | `https://agent.minimax.io` |
| `MM_TOKEN_URL` | `https://account.minimax.io/oauth2/token` |
| `MM_SALT` | salt tanda tangan `x-signature` |
| `MM_CLIENT_ID` | `mcode-public` |
| `MM_SCOPE` / `MM_AUDIENCE` | `agent.default` / `agent-backend` |
| `PUBLIC_BASE_URL` | URL publik service (untuk mendaftarkan webhook) |
| `OPS_TOKEN` | token admin untuk endpoint `/ops/*` |
| `BOT_DATA_DIR` | volume untuk state (token + peta sesi) |

## Catatan operasional

- **Refresh token bersifat single-use.** Setelah bot me-refresh, token baru disimpan di
  `/data/state.json` dan env tidak lagi dipakai. Jangan memakai kredensial yang sama
  di runtime lain (desktop/laptop), atau keduanya saling membatalkan refresh.
- Sesi cloud disimpan per `chat_id` di `/data/state.json`, jadi percakapan berlanjut
  antar restart.
- Skill `get-a-job` dan persona `gibran-ai` dibundel di image dan disuntik sebagai
  pesan pertama setiap sesi baru.
- `secrets.yaml` sengaja tidak ada di repo: simpan di luar git.
