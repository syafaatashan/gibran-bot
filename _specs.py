
import io, json, os, re, yaml
dep = r"E:\Minimax Code\Minimax-Cloud\deploy\northflank-gibran-bot"
bundle = r"E:\Minimax Code\Minimax-Cloud\bot-workspaces\deploy\gibran-bot\bundle"

# --- ambil secret dari bundle (tidak dicetak) ---
tg = io.open(os.path.join(bundle, "telegram-channel.yaml"), encoding="utf-8").read()
bot_token = re.search(r"botToken:\s*(\S+)", tg).group(1)
auth = json.load(io.open(os.path.join(bundle, "auth", "prod", "en", "mcode-public", "auth.json"), encoding="utf-8"))
rec = list(auth["records"].values())[0]
acc, ref = rec["accessToken"], rec["refreshToken"]
exp_ms = rec["expiresAtMs"]

# --- spec service (combined: build dari Git + deploy) ---
service = {
    "name": "gibran-bot",
    "description": "Worker bot Telegram Gibran.ai - MCode CLI runtime + channel Telegram (skill /get-a-job)",
    "billing": {"deploymentPlan": "nf-compute-200"},
    "vcsData": {
        "projectUrl": "https://github.com/syafaatashan/gibran-bot",
        "projectType": "github",
        "projectBranch": "master",
    },
    "buildSettings": {
        "dockerfile": {
            "buildEngine": "buildkit",
            "dockerFilePath": "/Dockerfile",
            "dockerWorkDir": "/",
        }
    },
    "deployment": {
        "instances": 1,
        "storage": {"ephemeralStorage": {"storageSize": 16384}},
    },
    "runtimeEnvironment": {
        "MINIMAX_DATA_DIR": "/root/.minimax",
        "BOT_WORKSPACE": "/workspace",
        "TERM": "xterm-256color",
    },
}
io.open(os.path.join(dep, "service.yaml"), "w", encoding="utf-8", newline="").write(
    yaml.dump(service, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120))

# --- spec secret group (nilai rahasia, file TIDAK masuk git) ---
secrets = {
    "name": "gibran-bot-secrets",
    "description": "Kredensial bot Telegram + OAuth MiniMax untuk worker Gibran.ai",
    "type": "secret",
    "secretType": "environment",
    "priority": 10,
    "restrictions": {
        "restricted": True,
        "nfObjects": [{"id": "gibran-bot", "type": "service"}],
    },
    "secrets": {
        "variables": {
            "TELEGRAM_BOT_TOKEN": bot_token,
            "TELEGRAM_BOT_NAME": "Gibran.ai",
            "MCODE_ACCESS_TOKEN": acc,
            "MCODE_REFRESH_TOKEN": ref,
            "MCODE_AUTH_EXPIRES_AT_MS": str(exp_ms),
        }
    },
}
io.open(os.path.join(dep, "secrets.yaml"), "w", encoding="utf-8", newline="").write(
    yaml.dump(secrets, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120))

print("service.yaml  :", os.path.getsize(os.path.join(dep, "service.yaml")), "byte")
print("secrets.yaml :", os.path.getsize(os.path.join(dep, "secrets.yaml")), "byte")
print("token bot    :", bot_token[:10] + "..." , "(len", len(bot_token), ")")
print("akun server  : pool terpisah (Account 2056), access", acc[:10] + "...", "exp", exp_ms)
print("service body :")
print(io.open(os.path.join(dep, "service.yaml"), encoding="utf-8").read())
