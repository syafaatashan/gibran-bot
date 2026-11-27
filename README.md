# Gibran.ai - Worker Bot Telegram (Northflank)

Bot Telegram publik untuk bantu pelamar kerja: buat CV, cari lowongan, cocokkan CV dengan job, dan apply.
Seluruh intelligence memakai skill /get-a-job (agent Gibran.ai).

## Arsitektur

```
Telegram  ->  MCode CLI (runtime yg sama dgn desktop)  ->  agent gibran-ai -> skill /get-a-job
                     |
                     +-- TelegramPoller (channel Telegram, mode sdk)
                     +-- session channel per-sender (sessionStrategy: per-sender)
```

Container ini menjalankan `mcode` di dalam tmux (butuh TTY) dengan supervisor loop,
sehingga bot hidup 24/7 dan auto-restart bila proses mati.

Konfigurasi runtime (auth store, telegram-channel.yaml, channel-bindings.yaml, channel-routes.yaml)
dibuat saat start dari environment variable - token TIDAK PERNAH ada di dalam image atau git.

## Secret yang dibutuhkan (Northflank secret group)

| Key | Isi |
|---|---|
| TELEGRAM_BOT_TOKEN | token bot Telegram |
| TELEGRAM_BOT_NAME | nama tampilan bot (opsional) |
| MCODE_ACCESS_TOKEN | OAuth access token akun MiniMax (mmoat_...) |
| MCODE_REFRESH_TOKEN | OAuth refresh token (mmort_...) |
| MCODE_AUTH_EXPIRES_AT_MS | epoch ms masa berlaku access token |

## Deployment (Northflank CLI)

```bash
# 1. secret group
northflank create secret --projectId gibran-ai --file ./secrets.yaml

# 2. service (build dari Git)
northflank create service combined --projectId gibran-ai --file ./service.yaml

# 3. verifikasi
northflank get service --projectId gibran-ai --serviceId gibran-bot
northflank get service logs --projectId gibran-ai --serviceId gibran-bot -f
```

## Biaya (perkiraan)

| Item | Plan | Biaya |
|---|---|---|
| Service | nf-compute-200 (2 vCPU / 4 GB) | ~$48/bulan |
| Build | default nf-compute-400-16 | ~$144 per build |
| Volume /workspace (opsional) | storage | kecil, per GB/bulan |

## Catatan penting

- SATU bot token hanya boleh dipoll SATU runtime. Setelah service ini jalan, matikan binding
  Telegram di laptop (desktop) agar tidak terjadi 409 Conflict.
- Workspace per pengguna: /workspace/users/<user_key>/Get a Job (user_key = id chat Telegram).
- Volume /workspace dipakai agar data pengguna bertahan saat container restart.
- Logs: /root/.minimax/bot.log di dalam container (juga di stdout service).
