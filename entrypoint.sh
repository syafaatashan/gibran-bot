#!/usr/bin/env bash
# entrypoint.sh - render config MCode dari env lalu jalankan bot (tmux + auto-restart)
set -uo pipefail

export MINIMAX_DATA_DIR="${MINIMAX_DATA_DIR:-/root/.minimax}"
export TERM="${TERM:-xterm-256color}"
WORKSPACE="${BOT_WORKSPACE:-/workspace}"
LOGFILE="$MINIMAX_DATA_DIR/bot.log"

echo "[entrypoint] data dir : $MINIMAX_DATA_DIR"
echo "[entrypoint] workspace: $WORKSPACE"

# 1) butuh kredensial + token bot
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: TELEGRAM_BOT_TOKEN belum diset"
  exit 1
fi
if [ -z "${MCODE_ACCESS_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: MCODE_ACCESS_TOKEN belum diset"
  exit 1
fi

# 2) tulis konfigurasi runtime (telegram-channel, channel-bindings, channel-routes, auth)
node /app/render.mjs || { echo "[entrypoint] render gagal"; exit 1; }

# 3) siapkan workspace per pengguna
mkdir -p "$WORKSPACE/users"
chmod 700 "$MINIMAX_DATA_DIR/auth" 2>/dev/null || true
chmod 600 "$MINIMAX_DATA_DIR/telegram-channel.yaml" 2>/dev/null || true

# 4) supervisor: jalankan mcode di tmux, restart bila mati
while true; do
  tmux kill-session -t gibran-bot 2>/dev/null || true
  tmux new-session -d -s gibran-bot -c "$WORKSPACE" \
     "mcode 2>&1 | tee -a $LOGFILE"
  echo "[entrypoint] $(date -Is) mcode start (tmux gibran-bot)" | tee -a "$LOGFILE"
  sleep 45
  if ! tmux has-session -t gibran-bot 2>/dev/null; then
    echo "[entrypoint] $(date -Is) mcode mati, restart 15 dtk lagi" | tee -a "$LOGFILE"
    sleep 15
  fi
done
