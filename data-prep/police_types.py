"""事故類型與車種：用警政署「傷亡道路交通事故資料」（112–114 年，逐案、每位當事者一列）。

來源（政府資料開放平臺，警政署）：
  112 年 https://data.gov.tw/dataset/167905
  113 年 https://data.gov.tw/dataset/172969
  114 年 https://data.gov.tw/dataset/177136
下載 ZIP 解壓到 data-prep/raw/police/<年>/（raw/ 不進 git，約 1.8 GB）。

做法：
  1. 只讀需要的欄位，先用 Demo 範圍的經緯度框篩掉其他縣市。
  2. 同一場事故有好幾列（每位當事者一列）→ 用 發生日期+時間+經緯度+事故類別 合併成一件。
  3. 和 prepare.py 同一套：事故在路口 35 公尺內，就算最近的那個路口。
  4. 每個路口算：事故類型（人與車／車與車／車輛本身）、牽涉的車種、死亡人數。
輸出 data/accident_types.json（不動 locations.json，原本的示意數字不變）。
"""
import json
import math
import re
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw" / "police"
DATA = HERE.parent / "data"
SNAP_M = 35

COLS = ["發生年度", "發生日期", "發生時間", "事故類別名稱", "事故類型及型態大類別名稱", "事故類型及型態子類別名稱",
        "死亡受傷人數", "當事者順位", "當事者區分-類別-大類別名稱-車種", "當事者區分-類別-子類別名稱-車種", "經度", "緯度"]

meta = json.load(open(DATA / "meta.json", encoding="utf-8"))
locs = json.load(open(DATA / "locations.json", encoding="utf-8"))
b = meta["bbox"]
PAD = 0.003


def xy(lon, lat):
    return lon * 111320 * math.cos(math.radians(24.95)), lat * 110540  # local metres; only differences matter


frames = []
for f in sorted(RAW.glob("*/*交通事故資料*.csv")):
    for chunk in pd.read_csv(f, usecols=COLS, dtype=str, encoding="utf-8-sig", chunksize=200_000):
        lon = pd.to_numeric(chunk["經度"], errors="coerce")
        lat = pd.to_numeric(chunk["緯度"], errors="coerce")
        keep = lon.between(b[0] - PAD, b[2] + PAD) & lat.between(b[1] - PAD, b[3] + PAD)
        if keep.any():
            frames.append(chunk[keep])
    print("read", f.name)
rows = pd.concat(frames, ignore_index=True)
rows["lon"] = pd.to_numeric(rows["經度"])
rows["lat"] = pd.to_numeric(rows["緯度"])
print("rows in demo box:", len(rows))

# one accident = same date, time, place and class
key = ["發生日期", "發生時間", "經度", "緯度", "事故類別名稱"]
rows["acc_id"] = rows.groupby(key, sort=False).ngroup()
# 大類「人」also covers passengers; only 子類「行人」is a pedestrian
rows["veh"] = rows["當事者區分-類別-大類別名稱-車種"].where(rows["當事者區分-類別-大類別名稱-車種"] != "人", rows["當事者區分-類別-子類別名稱-車種"])


def deaths_of(s):
    m = re.search(r"死亡(\d+)", str(s))
    return int(m.group(1)) if m else 0


acc = rows.groupby("acc_id").agg(
    year=("發生年度", "first"), cls=("事故類別名稱", "first"), kind=("事故類型及型態大類別名稱", "first"),
    sub=("事故類型及型態子類別名稱", "first"), hurt=("死亡受傷人數", "first"), lon=("lon", "first"), lat=("lat", "first"),
    vehicles=("veh", lambda v: sorted(set(x for x in v if isinstance(x, str)))),
)
acc["deaths"] = acc["hurt"].map(deaths_of)
print("accidents in demo box:", len(acc), acc["year"].value_counts().to_dict())

# snap to the nearest demo intersection within 35 m
# Same rule as prepare.py: distance to the closest OSM point of each intersection (all intersections compete,
# not only the 29 demo ones); intersection_pts.json is written by prepare.py.
P_xy = [(it["id"], xy(p[0], p[1])) for it in json.load(open(HERE / "intersection_pts.json", encoding="utf-8")) for p in it["pts"]]
def nearest(lon, lat):
    x, y = xy(lon, lat)
    d, i = min(((math.hypot(x - px, y - py), i) for i, (px, py) in P_xy), key=lambda t: t[0])
    return i if d <= SNAP_M else None  # None also when the closest intersection is not a demo one
acc["loc"] = [nearest(o, a) for o, a in zip(acc["lon"], acc["lat"])]
acc = acc[acc["loc"].notna()]

VEH = ["行人", "機車", "汽車", "自行車", "大型車"]  # buckets shown in the demo
def bucket(v):  # 當事者區分大類別（「人」換成子類別）：行人／機車／小客車(含客、貨兩用)／小貨車／慢車／大貨車／大客車／曳引車／聯結車…
    if v == "行人": return "行人"
    if v == "機車": return "機車"
    if v == "慢車": return "自行車"  # 慢車 is mostly bicycles
    if v.startswith("小客車") or v == "小貨車": return "汽車"
    if v in ("大貨車", "大客車", "曳引車", "半聯結車", "全聯結車"): return "大型車"
    return None
KIND = {"汽(機)車本身": "車輛本身", "人與汽(機)車": "人與車"}  # 112 年的舊名稱

out = {}
for lid, g in acc.groupby("loc"):
    veh = {k: 0 for k in VEH}
    for vs in g["vehicles"]:
        for k in set(filter(None, (bucket(v) for v in vs))):
            veh[k] += 1
    kinds = g["kind"].fillna("其他").replace(KIND).value_counts().to_dict()
    subs = g["sub"].fillna("其他").value_counts().head(5).to_dict()
    out[lid] = {"n": int(len(g)), "a1": int((g["cls"] == "A1").sum()), "deaths": int(g["deaths"].sum()),
                "kinds": {k: int(v) for k, v in kinds.items()}, "subs": {k: int(v) for k, v in subs.items()},
                "vehicles": veh}

res = {"source": "內政部警政署「傷亡道路交通事故資料」112–114 年（政府資料開放平臺）", "years": [2023, 2025], "snap_m": SNAP_M, "locations": out}
json.dump(res, open(DATA / "accident_types.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
cmp = [(L["id"], L["real"]["acc_recent"], out.get(L["id"], {}).get("n", 0), L["real"]["a1_recent"], out.get(L["id"], {}).get("a1", 0)) for L in locs]
print("id, 桃園市版近三年, 警政署版, 桃園A1, 警政署A1")
for c in cmp: print(c)
