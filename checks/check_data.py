"""CP1 data checks. Exit code 1 if any check fails.

Usage: python checks/check_data.py
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
DATA, RAW = ROOT / "data", ROOT / "data-prep" / "raw"
fails, passes = [], []


def check(ok, msg):
    (passes if ok else fails).append(msg)


L = json.loads((DATA / "locations.json").read_text(encoding="utf-8"))
M = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
G = json.loads((DATA / "roads.geojson").read_text(encoding="utf-8"))
W, S, E, N = M["bbox"]
street = re.compile(r"(路|街|大道|道)([一二三四五六七八九十]段)?$")
base = lambda n: re.sub(r"[一二三四五六七八九十]段$", "", n)

check(20 <= len(L) <= 40, f"地點數量合理：{len(L)}")
check(len({x["id"] for x in L}) == len(L), "地點 id 不重複")
check(len({x["name"] for x in L}) == len(L), "地點名稱不重複")
for x in L:
    a, b = x["name"].split("／")
    check(base(a) != base(b), f"{x['id']} 兩條路不是同一條：{x['name']}")
    check(bool(street.search(a)) and bool(street.search(b)), f"{x['id']} 名稱都是街道：{x['name']}")
    check(W < x["lon"] < E and S < x["lat"] < N, f"{x['id']} 座標在範圍內")
    r = x["real"]
    check(len(r["acc_by_year"]) == len(M["years"]) and all(isinstance(v, int) and v >= 0 for v in r["acc_by_year"]), f"{x['id']} 年度事故為非負整數")
    recent = sum(v for y, v in zip(M["years"], r["acc_by_year"]) if M["recent"][0] <= y <= M["recent"][1])
    check(recent == r["acc_recent"], f"{x['id']} 近三年事故加總一致")
    check((r["level"] == "high") == (r["acc_recent"] >= M["acc_high_threshold"]), f"{x['id']} 事故等級與門檻一致")
    rp = x["reports"]
    check(x["mock"] is True, f"{x['id']} 示意資料有標記 mock")
    check(sum(rp["categories"].values()) == rp["concern"], f"{x['id']} 問題類別加總＝回報數")
    check(sum(rp["hours"]) == rp["concern"] and len(rp["hours"]) == 24, f"{x['id']} 24 小時分布加總＝回報數")
    check(sum(rp["severity"].values()) == rp["concern"], f"{x['id']} 嚴重度加總＝回報數")
    check(sum(rp["users"].values()) == rp["concern"] + rp["praise"], f"{x['id']} 運具組成加總＝回報＋稱讚")
    check((rp["level"] == "high") == (rp["concern"] >= M["report_high_threshold"]), f"{x['id']} 回報等級與門檻一致")
    care = "many" if rp["concern"] >= M["report_high_threshold"] else "some" if rp["concern"] >= M["report_some_threshold"] else "few"
    check(x["care"] == care, f"{x['id']} 關心程度符合門檻")
    check(x["improved"] == (rp["praise"] > rp["concern"]), f"{x['id']} 「變好了」判斷正確")
    check(x["route"] in ("rank", "district", "fast", "next", "none"), f"{x['id']} 送審路徑值合法")
    check((x["route"] == "none") == (x["route_reason"] == ""), f"{x['id']} 有送審路徑就有說明")
    check(bool(x.get("district")), f"{x['id']} 有行政區")
    if x["route"] == "fast":
        check(x["care"] != "many", f"{x['id']} 快速通道只給回報不多的路口")
        if "死亡事故" in x["route_reason"]:
            check(x["real"]["a1_total"] > 0, f"{x['id']} 以死亡事故走快速通道時，真實資料確實有死亡事故")
    check(len(x["comments"]) >= 2, f"{x['id']} 至少兩則留言")

q = {}
for x in L:
    q[x["quadrant"]] = q.get(x["quadrant"], 0) + 1
check(all(q.get(k, 0) >= 3 for k in ("priority", "prevent", "blind", "calm")), f"四種對照類型各至少 3 個：{q}")

# routes: exactly rank_quota by overall ranking; every district's top N reaches the city
ranked = sorted([x for x in L if not x["improved"]], key=lambda x: (-x["reports"]["concern"], x["id"]))
check(sum(x["route"] == "rank" for x in L) == M["rank_quota"], f"全區排行名額＝{M['rank_quota']}")
check(all(x["route"] == "rank" for x in ranked[:M["rank_quota"]]), "全區排行就是回報最多的前幾名")
for dist in M["districts"]:
    top = [x for x in ranked if x["district"] == dist][:M["district_quota"]]
    check(all(x["route"] in ("rank", "district", "fast") for x in top), f"{dist}前 {M['district_quota']} 名都有送市府")
check(sum(M["districts"].values()) == len(L), "行政區計數一致")

kinds = {}
for f in G["features"]:
    kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
check(kinds.get("road", 0) > 100, f"道路線段數：{kinds.get('road', 0)}")
check(kinds.get("rail", 0) >= 1 and kinds.get("station", 0) >= 1, f"有鐵路與車站：{kinds}")

# independent recount from raw files
if RAW.exists():
    fr = [pd.read_csv(p, dtype=str, encoding="utf-8-sig") for p in sorted(RAW.glob("accidents_*.csv"))]
    a = pd.concat(fr).drop_duplicates()
    a["y"] = pd.to_numeric(a["Year"], errors="coerce")
    a["lon"] = pd.to_numeric(a["Longitude"], errors="coerce")
    a["lat"] = pd.to_numeric(a["Latitude"], errors="coerce")
    inb = a["lon"].between(W, E) & a["lat"].between(S, N)
    rec = a[inb & a["y"].between(*M["recent"])]
    check(len(rec) == M["accidents_recent"], f"範圍內近三年事故數重算一致：{len(rec)} vs {M['accidents_recent']}")
    check(int((rec["Accident_type"] == "A1").sum()) == M["a1_recent"], "範圍內近三年 A1 數重算一致")
check(sum(x["real"]["acc_recent"] for x in L) <= M["accidents_recent"], "各地點事故加總不超過範圍總數")

print(f"CP1 資料檢查：通過 {len(passes)} 項，失敗 {len(fails)} 項")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
