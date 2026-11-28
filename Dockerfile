# Gibran.ai - bot Telegram (webhook) -> MiniMax Code Cloud agent
# Tidak ada dependensi npm: cukup Node built-in (fetch, http, fs).
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    BOT_DATA_DIR=/data

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY skill ./skill
COPY agent ./agent
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
