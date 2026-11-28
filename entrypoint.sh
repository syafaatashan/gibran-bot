#!/usr/bin/env bash
# entrypoint.sh - Gibran.ai: siapkan profil MCode lalu jalankan bot webhook.
set -uo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8080}"
export MINIMAX_DATA_DIR="${MINIMAX_DATA_DIR:-/data}"
export BOT_WORKSPACE_DIR="${BOT_WORKSPACE_DIR:-/workspace}"
export BOT_MODE="${BOT_MODE:-runtime-local}"
export TZ="${TZ:-Asia/Makassar}"

mkdir -p "$MINIMAX_DATA_DIR"

node /app/render.mjs || { echo "[entrypoint] render gagal"; exit 1; }

echo "[entrypoint] mode=$BOT_MODE data=$MINIMAX_DATA_DIR port=$PORT"
exec node /app/src/server.mjs
