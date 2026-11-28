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
RUN npm install -g @minimax-ai/code@0.8.0 \
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

RUN chmod +x /app/entrypoint.sh && mkdir -p /data /workspace

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
