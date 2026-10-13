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
    check(x["route"] in ("district", "fast", "next", "none"), f"{x['id']} 送審路徑值合法")
    check((x["route"] == "none") == (x["route_reason"] == ""), f"{x['id']} 有送審路徑就有說明")
    check(bool(x.get("district")), f"{x['id']} 有行政區")
    check(len(x["owners"]) >= 1 or rp["concern"] == 0, f"{x['id']} 至少有一個權責單位")
    for c, n in rp["categories"].items():
        if n > 0:
            check(sum(rp["causes"].get(c, {}).values()) == n, f"{x['id']} {c} 的具體原因加總＝該類人數")
            for cz in rp["causes"].get(c, {}):
                check(cz in M["cause_owner"].get(c, {}), f"{x['id']} 具體原因「{cz}」有對應權責單位")
    tl = x["timeline"]
    check(tl[0]["type"] == "stage" and tl[0]["n"] == 1 and tl[0]["start"] == M["data_start"], f"{x['id']} 時間線從第 1 階段開始")
    check(all(tl[i]["type"] != tl[i + 1]["type"] for i in range(len(tl) - 1)), f"{x['id']} 階段與市府更新交替出現")
    check(tl[-1]["type"] == "stage" and tl[-1].get("current") and tl[-1]["end"] is None, f"{x['id']} 最後一段是目前階段")
    has_upd = any(t["type"] == "update" for t in tl)
    check(rp["praise"] == 0 or has_upd, f"{x['id']} 只有市府更新後才有「變好了」")
    check(all(c["tone"] != "praise" for c in x["comments"]) or has_upd, f"{x['id']} 沒有更新就沒有稱讚留言")
    for i, t in enumerate(tl):
        if t["type"] == "update":
            check(tl[i - 1]["end"] < t["date"][:7] <= tl[i + 1]["start"], f"{x['id']} 市府更新日期落在兩個階段之間")
    cur_start = tl[-1]["start"].replace("-", "/")
    check(all(cur_start <= c["date"] <= M["data_now"].replace("-", "/") for c in x["comments"]), f"{x['id']} 留言日期都在目前階段內")
    stage_months = sum(t["months"] for t in tl if t["type"] == "stage")
    total = (int(M["data_now"][:4]) - int(M["data_start"][:4])) * 12 + int(M["data_now"][5:]) - int(M["data_start"][5:]) + 1
    check(stage_months == total, f"{x['id']} 各階段月數加起來＝整段期間")
    if x["route"] == "fast":
        check(x["care"] != "many", f"{x['id']} 快速通道只給回報不多的路口")
        if "死亡事故" in x["route_reason"]:
            check(x["real"]["a1_total"] > 0, f"{x['id']} 以死亡事故走快速通道時，真實資料確實有死亡事故")
    check(len(x["comments"]) >= 2, f"{x['id']} 至少兩則留言")

q = {}
for x in L:
    q[x["quadrant"]] = q.get(x["quadrant"], 0) + 1
check(all(q.get(k, 0) >= 3 for k in ("priority", "prevent", "blind", "calm")), f"四種對照類型各至少 3 個：{q}")

# routes: no citywide ranking; every district sends exactly its own top N
ranked = sorted([x for x in L if not x["improved"]], key=lambda x: (-x["reports"]["concern"], x["id"]))
check("rank_quota" not in M and not any(x["route"] == "rank" for x in L), "沒有全區排行")
for dist in M["districts"]:
    top = [x for x in ranked if x["district"] == dist]
    check(all(x["route"] == "district" for x in top[:M["district_quota"]]), f"{dist}前 {M['district_quota']} 名都送市府")
    check(sum(x["route"] == "district" for x in L if x["district"] == dist) == min(M["district_quota"], len(top)), f"{dist}名額＝{M['district_quota']}")
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
