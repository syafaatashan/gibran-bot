# Gibran.ai - MCode penuh di container Linux + bridge Telegram.
FROM node:24-bookworm-slim

# better-sqlite3 butuh toolchain + glibc >= 2.29 (bookworm = 2.36).
# chromium dipakai plugin browser-use bawaan MCode (bukan muse browser).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates curl util-linux procps tzdata \
        chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# CLI resmi MiniMax Code (npm publik, MIT). Prebuild better-sqlite3 untuk Linux
# diambil oleh verify-native-install.mjs dari npmmirror.
RUN npm install -g @minimax-ai/code@0.8.0 chrome-devtools-mcp@latest \
        --allow-scripts=@minimax-ai/code,better-sqlite3 \
        --registry=https://registry.npmjs.org/ \
    && npm cache clean --force \
    && mcode --version

ENV NODE_ENV=production \
    PORT=8080 \
    MINIMAX_DATA_DIR=/data \
    BOT_WORKSPACE_DIR=/workspace \
    TZ=Asia/Makassar \
    MCODE_BROWSER_HEADLESS=true

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY skill ./skill
COPY agent ./agent
COPY config.template.yaml ./config.template.yaml
COPY render.mjs ./render.mjs
COPY entrypoint.sh /app/entrypoint.sh

# Wrapper Chromium headless: --disable-quic wajib (UDP 443 di-blackhole egress
# Northflank -> Chromium hang saat memuat https, sementara curl normal).
RUN printf '#!/usr/bin/env bash\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-quic --disable-features=Translate,BackForwardCache "$@"\n' > /usr/local/bin/chromium-headless \
    && chmod +x /usr/local/bin/chromium-headless \
    && chmod +x /app/entrypoint.sh \
    && mkdir -p /data /workspace

VOLUME ["/data"]
EXPOSE 8080

# Pakai curl, bukan `node -e`: startup node di 0,2 vCPU bisa >10 detik ->
# healthcheck timeout -> Northflank kill & restart container tiap ~10 menit.
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=5 \
  CMD curl -fsS --max-time 10 http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
