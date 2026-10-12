"""CP2 site checks: syntax, references, external URLs, placeholders, secrets. Exit 1 on failure.

Usage: python checks/check_site.py
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
fails, passes = [], []
ALLOWED = [r"^https://fonts\.googleapis\.com(/|$)",r"^https://fonts\.gstatic\.com", r"^https://unpkg\.com/maplibre-gl@\d+\.\d+\.\d+/"]


def check(ok, msg):
    (passes if ok else fails).append(msg)


html = (ROOT / "index.html").read_text(encoding="utf-8")
refs = re.findall(r'(?:src|href)="([^"]+)"', html)
for ref in refs:
    if ref.startswith("http"):
        check(any(re.match(p, ref) for p in ALLOWED), f"外部網址在允許清單內：{ref}")
    elif not ref.startswith("#"):
        check((ROOT / ref).exists(), f"本機檔案存在：{ref}")

node = shutil.which("node")
for js in sorted((ROOT / "js").glob("*.js")):
    if node:
        r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
        check(r.returncode == 0, f"JS 語法正確：{js.name} {r.stderr.strip()[:200]}")
    src = js.read_text(encoding="utf-8")
    check("fetch(\"http" not in src and "fetch('http" not in src, f"{js.name} 沒有向外部網址抓資料")
check(node is not None, "有 node 可以做語法檢查")

for name in ["roads.geojson", "locations.json", "meta.json"]:
    try:
        json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))
        check(True, f"JSON 可解析：{name}")
    except Exception as e:
        check(False, f"JSON 可解析：{name} {e}")

texts = [p for p in ROOT.rglob("*") if p.suffix in {".html", ".js", ".css", ".json"} and "raw" not in p.parts and ".git" not in p.parts]
for p in texts:
    t = p.read_text(encoding="utf-8")
    check(not re.search(r"lorem|ipsum|TODO|FIXME|XXX", t, re.I), f"沒有佔位文字：{p.relative_to(ROOT)}")

check(not (ROOT / ".env").exists(), "demo 資料夾裡沒有 .env")
gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
check(".env" in gi and "data-prep/raw/" in gi, ".gitignore 排除 .env 與原始資料")
tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
check(not any(t.endswith(".env") for t in tracked), "git 沒有追蹤任何 .env")

size = sum(p.stat().st_size for p in (ROOT / "data").glob("*"))
check(size < 2_000_000, f"網頁資料小於 2MB：{size:,} bytes")

print(f"CP2 程式檢查：通過 {len(passes)} 項，失敗 {len(fails)} 項")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
