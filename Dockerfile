# Gibran.ai - worker bot Telegram (MiniMax Code CLI runtime + channel Telegram)
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        tmux ca-certificates curl git procps less \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @minimax-ai/code@latest && npm cache clean --force

ENV MINIMAX_DATA_DIR=/root/.minimax
ENV TERM=xterm-256color
ENV HOME=/root
WORKDIR /app

COPY agent /app/agent
COPY skill /app/skill
COPY render.mjs /app/render.mjs
COPY entrypoint.sh /app/entrypoint.sh
COPY config.template.yaml /app/config.template.yaml

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /root/.minimax/agents /root/.minimax/skills /workspace/users \
    && cp -r /app/agent/gibran-ai /root/.minimax/agents/gibran-ai \
    && cp -r /app/skill/get-a-job /root/.minimax/skills/get-a-job \
    && rm -rf /app/agent /app/skill

VOLUME ["/workspace"]
HEALTHCHECK --interval=60s --timeout=20s --start-period=90s --retries=3 \
  CMD tmux has-session -t gibran-bot || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
