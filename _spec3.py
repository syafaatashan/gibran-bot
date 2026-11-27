
import io, os, yaml
dep = r"E:\Minimax Code\Minimax-Cloud\deploy\northflank-gibran-bot"
p = os.path.join(dep, "service.yaml")
s = yaml.safe_load(io.open(p, encoding="utf-8").read())
s["billing"] = {"deploymentPlan": "nf-compute-20"}
s.setdefault("buildSettings", {})["storage"] = {"ephemeralStorage": {"storageSize": 16384}}
s.setdefault("deployment", {})["storage"] = {"ephemeralStorage": {"storageSize": 2048}}
io.open(p, "w", encoding="utf-8", newline="").write(
    yaml.dump(s, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120))
print("plan:", s["billing"]["deploymentPlan"],
      "| build storage:", s["buildSettings"]["storage"]["ephemeralStorage"]["storageSize"],
      "| runtime storage:", s["deployment"]["storage"]["ephemeralStorage"]["storageSize"])
