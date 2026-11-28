#!/usr/bin/env bash
# entrypoint.sh - jalankan Gibran.ai bot webhook
set -uo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8080}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-/data}"

mkdir -p "$BOT_DATA_DIR"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "[entrypoint] FATAL: TELEGRAM_BOT_TOKEN belum diset"
  exit 1
fi
if [ -z "${MM_AGENT_ID:-}" ]; then
  echo "[entrypoint] FATAL: MM_AGENT_ID belum diset"
  exit 1
fi

echo "[entrypoint] starting gibran-bot on port $PORT"
exec node /app/src/server.mjs
