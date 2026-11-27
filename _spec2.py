
import io, os, yaml
dep = r"E:\Minimax Code\Minimax-Cloud\deploy\northflank-gibran-bot"
p = os.path.join(dep, "service.yaml")
s = yaml.safe_load(io.open(p, encoding="utf-8").read())
s["billing"] = {"deploymentPlan": "nf-compute-50"}
s["buildSettings"]["storage"] = {"ephemeralStorage": {"storageSize": 32768}}
s["deployment"]["storage"] = {"ephemeralStorage": {"storageSize": 4096}}
io.open(p, "w", encoding="utf-8", newline="").write(
    yaml.dump(s, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120))
print(io.open(p, encoding="utf-8").read())
