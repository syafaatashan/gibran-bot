#!/usr/bin/env bash
# entrypoint.sh - render config MCode dari env lalu jalankan bot (tmux + TTY + auto-restart)
set -uo pipefail

export MINIMAX_DATA_DIR="${MINIMAX_DATA_DIR:-/root/.minimax}"
export TERM="${TERM:-xterm-256color}"
WORKSPACE="${BOT_WORKSPACE:-/workspace}"
LOGFILE="$MINIMAX_DATA_DIR/bot.log"
touch "$LOGFILE"

echo "[entrypoint] data dir : $MINIMAX_DATA_DIR"
echo "[entrypoint] workspace: $WORKSPACE"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: TELEGRAM_BOT_TOKEN belum diset"
  exit 1
fi
if [ -z "${MCODE_ACCESS_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: MCODE_ACCESS_TOKEN belum diset"
  exit 1
fi

node /app/render.mjs || { echo "[entrypoint] render gagal"; exit 1; }
mkdir -p "$WORKSPACE/users"
chmod 700 "$MINIMAX_DATA_DIR/auth" 2>/dev/null || true
chmod 600 "$MINIMAX_DATA_DIR/telegram-channel.yaml" 2>/dev/null || true

# streaming: kirim isi bot.log ke stdout container
( tail -n 200 -F "$LOGFILE" & )

# mcode WAJIB jalan tanpa pipe supaya stdout tetap TTY (tmux pane = pty)
while true; do
  tmux kill-session -t gibran-bot 2>/dev/null || true
  tmux new-session -d -s gibran-bot -x 200 -y 50 -c "$WORKSPACE" mcode
  echo "[entrypoint] $(date -Is) mcode start (tmux gibran-bot, TTY native)" | tee -a "$LOGFILE"
  sleep 20
  tmux capture-pane -p -t gibran-bot 2>/dev/null | grep -v "^$" | tail -30 | sed "s/^/[pane] /" >> "$LOGFILE"
  if ! tmux has-session -t gibran-bot 2>/dev/null; then
    echo "[entrypoint] $(date -Is) mcode mati, restart 10 dtk lagi" | tee -a "$LOGFILE"
    sleep 10
  fi
done
