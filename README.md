# Gibran.ai - bot Telegram dengan MCode penuh di cloud

Bot Telegram publik yang membantu pelamar kerja: membuat CV, mencari lowongan,
mencocokkan CV dengan lowongan, dan menyiapkan bahan lamaran.

Otaknya adalah **MCode sungguhan** (`@minimax-ai/code`, CLI resmi npm) yang berjalan
di dalam container Linux Northflank - bukan hanya model cloud. Jadi skill, agent,
MCP, tools, memory, dan session MCode behave persis seperti di laptop.

## Arsitektur

```
Telegram  --webhook-->  service gibran-bot  (Northflank, free tier nf-compute-20)
                         |
                         |- supervisor  (src/supervisor.mjs)
                         |    . refresh OAuth (single-use) -> auth store + chain
                         |    . claim check-in harian saat kredit habis
                         |    . rotasi akun (hanya akun runtime-capable)
                         |
                         |- bridge  (src/server.mjs)
                              . antrean per chat_id
                              . mcode exec --cwd <workspace> --session <sid>
                              .          --output-format stream-json
                              . kirim progres + jawaban akhir ke Telegram
```

Kubernetes Northflank tidak bisa menjalankan channel internal MCode
(`channelCapabilityEnabled` butuh `channelComposition='external'` dan
`capabilityProfile!=='cli'`), jadi **Telegram-nya yang di-bridge**, sedangkan
otaknya tetap proses `mcode` asli di container yang sama.

## Mode operasi

| `BOT_MODE` | Penjelasan |
|---|---|
| `runtime-local` | Default. Otak = proses `mcode` di container. Butuh akun yang sudah sign-in penuh. |
| `cloud-agent` | Cadangan. Otak = MCode Cloud API (`agent.minimax.io`). Cocok untuk akun pool. |

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | liveness, mode, jumlah akun & sesi |
| GET | `/ready` | cek koneksi MiniMax Cloud + Telegram + akun |
| POST | `/tg/webhook` | endpoint webhook Telegram (header `x-telegram-bot-api-secret-token`) |
| POST | `/ops/exec` | jalankan satu prompt `mcode exec` (debug/smoke test) |
| GET | `/ops/state` | state sesi, rantai akun, error terakhir |
| GET | `/ops/accounts` | label akun + sisa kredit + status check-in |
| POST | `/ops/claim` | paksa klaim check-in harian |
| POST | `/ops/rotate` | rotasi akun (body: `{index}` opsional) |
| GET | `/ops/webhook` | status webhook di sisi Telegram |
| POST | `/ops/set-webhook` | daftar webhook ke Telegram |

Endpoint `/ops/*` butuh header `x-ops-token`.

## Rotasi akun & kredit

- Error `insufficient balance (1008)` / `50110` memicu supervisor:
  1. `GET /minimax-cloud/api/v1/signin/status?timezone_id=Asia/Makassar`
  2. Kalau hari ini belum diklaim -> `POST /minimax-cloud/api/v1/signin/claim` (+400 credits)
  3. Kalau tetap habis -> rotasi ke akun berikutnya yang **runtime-capable**
- Refresh token OAuth **single-use**: hasil refresh langsung ditulis ke auth store
  **dan** ke chain akun di volume (`/data/accounts.json`). Tanpa itu token lama
  jadi `invalid_grant`.
- Akun pool ditandai `runtime: false`: bisa dipakai di mode `cloud-agent`, tapi
  mode `runtime-local` butuh akun yang sudah sign-in penuh (content review auth).
- Supervisor self-healing: kalau token di chain basi, ambil token terbaru dari
  auth store container.

## Data di container

```
/data  (volume persisten 6 GB, mount /data)
  auth/prod/en/mcode-public/auth.json   <- credential OAuth (ditulis supervisor)
  config.yaml                            <- config runtime
  skills/get-a-job/                      <- skill (native, slash command)
  agents/gibran-ai/agent.md              <- persona agent
  sessions/ , v2/                        <- histori sesi MCode
  accounts.json                          <- chain akun + token hasil refresh
  workspace/users/<chat_id>/             <- data kerja per pengguna
```

## Endpoint publik

`https://http--gibran-bot--t2lhy99dxnfp.code.run` (TLS Northflank, valid untuk Telegram).
Webhook didaftarkan oleh `stop-desktop-poller.ps1` (laptop) + `register-webhook.py`.

## Catatan

- Poller Telegram di MCode Desktop bertabrakan dengan webhook: saat dapat 409
  `webhook active`, desktop memanggil `deleteWebhook`. Karena itu channel
  `telegram:gibran-ai` di desktop harus `enabled: false` lalu desktop di-restart.
- Browser dan apply otomatis butuh MCP browser yang jalan di Linux (belum dipasang).
  Sambil itu bot menyiapkan bahan lamaran dan memberi langkah manual.
- `secrets.yaml` dan `accounts.json` sengaja tidak ada di repo (berisi token).
