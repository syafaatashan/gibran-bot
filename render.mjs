// render.mjs - tulis konfigurasi MiniMax Code runtime dari environment variables.
// Secret TIDAK pernah ada di image/git - hanya di Northflank secret group.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA = process.env.MINIMAX_DATA_DIR || "/root/.minimax";
const AUTH_HOME = path.join(DATA, "auth");
const NS = path.join(AUTH_HOME, "prod", "en", "mcode-public");
const AGENT = process.env.BOT_AGENT || "gibran-ai";
const CLIENT = "telegram:" + AGENT;
const now = Date.now();
const expiresAtMs = Number(process.env.MCODE_AUTH_EXPIRES_AT_MS || now + 11 * 3600 * 1000);

fs.mkdirSync(NS, { recursive: true });

// accountId = base64url_nopad(sha256(authHome + "\0" + "mcode-public"))  -> per mesin
const accountId = createHash("sha256")
  .update(AUTH_HOME + "\0" + "mcode-public")
  .digest("base64url")
  .replace(/=+$/, "");
const recordKey = "com.minimax.mcode.oauth.prod.en\0" + accountId;

// 1) auth store (plaintext JSON, format asli aplikasi)
fs.writeFileSync(
  path.join(NS, "auth.json"),
  JSON.stringify({
    schemaVersion: 1,
    records: {
      [recordKey]: {
        schemaVersion: 1,
        accessToken: process.env.MCODE_ACCESS_TOKEN,
        refreshToken: process.env.MCODE_REFRESH_TOKEN || "",
        tokenType: "Bearer",
        clientId: "mcode-public",
        scopes: ["agent.default"],
        audience: "agent-backend",
        expiresAtMs,
        generation: 1,
        loginEpoch: "nf-" + Date.now(),
      },
    },
  }, null, 2),
);
fs.writeFileSync(
  path.join(NS, "auth-state.json"),
  JSON.stringify({
    schemaVersion: 2,
    status: "authenticated",
    storeKind: "file",
    clientId: "mcode-public",
    scopes: ["agent.default"],
    audience: "agent-backend",
    buildEnv: "prod",
    region: "en",
    generation: 1,
    expiresAtMs,
  }, null, 2),
);

// 2) binding transport Telegram (mode WAJIB "sdk")
fs.writeFileSync(
  path.join(DATA, "telegram-channel.yaml"),
  [
    "schemaVersion: 1",
    "bindings:",
    "  " + CLIENT + ":",
    "    clientId: " + CLIENT,
    "    agentName: " + AGENT,
    "    botToken: " + process.env.TELEGRAM_BOT_TOKEN,
    "    botName: " + (process.env.TELEGRAM_BOT_NAME || "Gibran.ai"),
    "    connected: true",
    "    enabled: true",
    "    mode: sdk",
    "    createdAt: " + now,
    "    updatedAt: " + now,
    "",
  ].join("\n"),
);

// 3) channel-bindings: connections + legacy client-default binding WAJIB (model IM v2)
const connectionId = process.env.BOT_CONNECTION_ID || "conn-nf-gibran-bot";
fs.writeFileSync(
  path.join(DATA, "channel-bindings.yaml"),
  [
    "schemaVersion: 3",
    "bindings:",
    "  " + CLIENT + ":",
    "    key: " + CLIENT,
    "    platform: telegram",
    "    clientName: " + CLIENT,
    "    chatId: ''",
    "    senderId: ''",
    "    threadId: ''",
    "    lane: interactive",
    "    agentName: " + AGENT,
    "    sessionId: mvs_bootstrap_nf_gibran_bot",
    "    strategy: per-sender",
    "    pinned: false",
    "    routeRuleId: telegram-gibran-public",
    "    exactOwnerName: " + AGENT,
    "    projectKey: default",
    "    routingMode: project-main",
    "    generation: 1",
    "    createdAt: " + now,
    "    updatedAt: " + now,
    "messageFilters: {}",
    "connections:",
    "  " + connectionId + ":",
    "    connectionId: " + connectionId,
    "    agentName: " + AGENT,
    "    channel: telegram",
    "    projectKey: null",
    "    resolvedProjectKey: default",
    "    createdAt: " + now,
    "    updatedAt: " + now,
    "physicalBindings: {}",
    "",
  ].join("\n"),
);

// 4) route: rule tanpa syarat mention + defaultRoute per-sender
fs.writeFileSync(
  path.join(DATA, "channel-routes.yaml"),
  [
    "schemaVersion: 2",
    "rules:",
    "  - id: telegram-gibran-public",
    "    platform: telegram",
    "    enabled: true",
    "    priority: 10",
    "    requireMention: false",
    "    match:",
    "      chatType: '*'",
    "      chatId: ''",
    "      senderId: ''",
    "      clientName: " + CLIENT,
    "    target:",
    "      agentId: " + AGENT,
    "      sessionStrategy: per-sender",
    "      sessionTitle: ''",
    "      exactOwnerName: " + AGENT,
    "      projectKey: default",
    "      routingMode: project-main",
    "      generation: 1",
    "    createdAt: " + now,
    "    updatedAt: " + now,
    "defaultRoute:",
    "  telegram:",
    "    agentId: " + AGENT,
    "    sessionStrategy: per-sender",
    "    exactOwnerName: " + AGENT,
    "    projectKey: default",
    "    routingMode: project-main",
    "    generation: 1",
    "",
  ].join("\n"),
);

// 5) config.yaml runtime dari template
fs.copyFileSync("/app/config.template.yaml", path.join(DATA, "config.yaml"));

console.log("[render] accountId  :", accountId);
console.log("[render] recordKey  :", recordKey.replace(/\0/g, "\\0"));
console.log("[render] files      : auth.json, auth-state.json, telegram-channel.yaml, channel-bindings.yaml, channel-routes.yaml, config.yaml");
