"""CP5 reproducibility: re-run data-prep/prepare.py and confirm every output file is byte-identical,
then run the CP1 and CP2 checks. Exit 1 on any difference or failure.

Usage: python checks/check_reproducible.py
"""
import hashlib
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
FILES = ["data/roads.geojson", "data/locations.json", "data/meta.json"]


def digest():
    return {f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest() for f in FILES}


before = digest()
run = subprocess.run([sys.executable, "-P", "-E", "data-prep/prepare.py"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
if run.returncode != 0:
    print("prepare.py 執行失敗：", run.stderr[-500:])
    sys.exit(1)
after = digest()
diff = [f for f in FILES if before[f] != after[f]]
print("CP5 可重現：重跑資料處理後，輸出檔案" + ("完全相同" if not diff else "有差異：" + ", ".join(diff)))
for f in FILES:
    print(f"  {f}  {after[f][:16]}")

ok = not diff
for script in ["checks/check_data.py", "checks/check_site.py"]:
    r = subprocess.run([sys.executable, "-P", "-E", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    print(r.stdout.strip())
    ok = ok and r.returncode == 0
sys.exit(0 if ok else 1)
