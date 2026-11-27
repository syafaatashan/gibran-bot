#!/usr/bin/env bash
# entrypoint.sh - render config MCode dari env lalu jalankan bot di pty (script -qfc) + auto-restart
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

# streaming log ke stdout container
( tail -n 200 -F "$LOGFILE" & )

# mcode butuh stdin+stdout TTY -> script mengalokasikan pty untuk child
while true; do
  echo "[entrypoint] $(date -Is) mcode start via script(pty)" | tee -a "$LOGFILE"
  script -q -f -c "mcode" "$LOGFILE"
  echo "[entrypoint] $(date -Is) mcode exit, restart 10 dtk lagi" | tee -a "$LOGFILE"
  sleep 10
done
