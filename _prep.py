
import io, os, shutil, yaml
home = os.environ["USERPROFILE"]
MINIMAX = os.path.join(home, ".minimax")
dep = r"E:\Minimax Code\Minimax-Cloud\deploy\northflank-gibran-bot"

# 1) agent (tanpa secret) + patch workspace ke container
ag_dst = os.path.join(dep, "agent", "gibran-ai")
shutil.rmtree(os.path.join(dep, "agent"), ignore_errors=True)
os.makedirs(ag_dst, exist_ok=True)
ag = io.open(os.path.join(MINIMAX, "agents", "gibran-ai", "agent.md"), encoding="utf-8").read()
ag = ag.replace("defaultWorkspaceDir: E:\\Minimax Code\\Minimax-Cloud\\bot-workspaces",
                "defaultWorkspaceDir: /workspace/users")
ag = ag.replace("userKey = id chat Telegram bila tersedia di konteks; kalau tidak, pakai email pengguna (lowercase, tanpa spasi) yang kamu tanyakan di awal.",
                "userKey = id chat Telegram bila tersedia di konteks; kalau tidak, pakai email pengguna (lowercase, tanpa spasi) yang kamu tanyakan di awal. Semua file pengguna hanya di dalam /workspace/users/<user_key>/Get a Job.")
io.open(os.path.join(ag_dst, "agent.md"), "w", encoding="utf-8", newline="").write(ag)
inst = os.path.join(MINIMAX, "agents", "gibran-ai", ".agent-instance-id")
if os.path.isfile(inst):
    shutil.copy2(inst, os.path.join(ag_dst, ".agent-instance-id"))

# 2) skill
sk_dst = os.path.join(dep, "skill", "get-a-job")
shutil.rmtree(os.path.join(dep, "skill"), ignore_errors=True)
shutil.copytree(os.path.join(MINIMAX, "skills", "get-a-job"), sk_dst,
                ignore=shutil.ignore_patterns("__pycache__"))

# 3) config.template.yaml dari config desktop (buang blok 9router)
cfg = yaml.safe_load(io.open(os.path.join(MINIMAX, "config.yaml"), encoding="utf-8").read()) or {}
for k in ("custom_provider", "minimax_api"):
    cfg.pop(k, None)
cfg.pop("defaultModelContextWindow", None)
cfg["permissionMode"] = "bypassPermissions"
cfg["minimaxModelSource"] = "token_plan"
cfg["defaultModel"] = "minimax/MiniMax-M3.1-Flash"
io.open(os.path.join(dep, "config.template.yaml"), "w", encoding="utf-8", newline="").write(
    yaml.dump(cfg, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120))
print("agent.md bytes :", os.path.getsize(os.path.join(ag_dst, "agent.md")))
print("skill files    :", sum(len(f) for _, _, f in os.walk(sk_dst)))
print("config template:", os.path.getsize(os.path.join(dep, "config.template.yaml")))
print("agent workspace:", [l for l in ag.splitlines() if "defaultWorkspaceDir" in l])
