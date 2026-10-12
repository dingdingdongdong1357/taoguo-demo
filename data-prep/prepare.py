"""Build the demo's data files from data-prep/raw/.

Outputs (all deterministic for a given input):
  data/roads.geojson   roads, railway and stations (OpenStreetMap, ODbL)
  data/locations.json  intersections with REAL accident counts and MOCK citizen reports
  data/meta.json       area summary, thresholds, sources

Real vs mock: every accident number comes from Taoyuan open data; every citizen report,
comment, status and owner shown in the demo is generated here with a fixed seed and is
marked "mock": true. Usage: python data-prep/prepare.py
"""
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE.parent / "data"
OUT.mkdir(exist_ok=True)

SEED = 20261013
SOUTH, WEST, NORTH, EAST = 24.944, 121.208, 24.968, 121.242
LAT0, LON0 = (SOUTH + NORTH) / 2, (WEST + EAST) / 2
MX = 111320 * math.cos(math.radians(LAT0))
MY = 110540
CLUSTER_M = 30      # intersection nodes closer than this are one intersection
SNAP_M = 35         # an accident within this distance of an intersection belongs to it
YEARS = list(range(2019, 2026))
WX_STORM, WX_CLOUDY = 40, 12  # 路況天氣：雷雨 / 多雲 門檻
RECENT = (2023, 2025)

CLASS_RANK = {"trunk": 6, "primary": 5, "secondary": 4, "tertiary": 3, "unclassified": 2,
              "residential": 1, "living_street": 1, "primary_link": 4, "secondary_link": 3,
              "tertiary_link": 2, "motorway": 6}


import re
STREET = re.compile(r"(路|街|大道|道)([一二三四五六七八九十]段)?$")


def base_name(name):
    """延平路一段 -> 延平路 (sections of one road are the same road)."""
    return re.sub(r"[一二三四五六七八九十]段$", "", name)


def xy(lon, lat):
    return (np.asarray(lon) - LON0) * MX, (np.asarray(lat) - LAT0) * MY


# ---------------------------------------------------------------- OSM
osm = json.loads((RAW / "osm.json").read_text(encoding="utf-8"))
features, node_names = [], defaultdict(set)
node_pos, node_rank = {}, defaultdict(int)
for el in osm["elements"]:
    tags = el.get("tags", {})
    if el["type"] == "node" and tags.get("railway") == "station":
        features.append({"type": "Feature", "properties": {"kind": "station", "name": tags.get("name", "")},
                         "geometry": {"type": "Point", "coordinates": [round(el["lon"], 5), round(el["lat"], 5)]}})
        continue
    if el["type"] != "way" or "geometry" not in el:
        continue
    coords = [[round(p["lon"], 5), round(p["lat"], 5)] for p in el["geometry"]]
    if tags.get("railway") == "rail":
        features.append({"type": "Feature", "properties": {"kind": "rail"},
                         "geometry": {"type": "LineString", "coordinates": coords}})
        continue
    hw = tags.get("highway", "")
    name = tags.get("name", "").strip()
    # only real streets take part in intersections: bridges and place names are skipped
    is_street = bool(STREET.search(name)) and not name.endswith("橋")
    features.append({"type": "Feature",
                     "properties": {"kind": "road", "class": hw, "rank": CLASS_RANK.get(hw, 1), "name": name},
                     "geometry": {"type": "LineString", "coordinates": coords}})
    if is_street and not hw.endswith("_link"):
        # "out geom" carries no node ids; ways that share a vertex share its exact coordinates
        for p in el["geometry"]:
            nid = (round(p["lon"], 7), round(p["lat"], 7))
            node_names[nid].add(name)
            node_pos[nid] = (p["lon"], p["lat"])
            node_rank[(nid, name)] = max(node_rank[(nid, name)], CLASS_RANK.get(hw, 1))

(OUT / "roads.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# intersections: nodes where two differently named roads meet, clustered
cand = sorted(n for n, s in node_names.items() if len({base_name(x) for x in s}) >= 2)
cx, cy = xy([node_pos[n][0] for n in cand], [node_pos[n][1] for n in cand])
parent = list(range(len(cand)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
for i in range(len(cand)):
    d = np.hypot(cx - cx[i], cy - cy[i])
    for j in np.nonzero(d < CLUSTER_M)[0]:
        if j > i:
            parent[find(j)] = find(i)
groups = defaultdict(list)
for i in range(len(cand)):
    groups[find(i)].append(i)

inters = []
for members in groups.values():
    rank_by_name = defaultdict(int)
    for i in members:
        for nm in node_names[cand[i]]:
            rank_by_name[nm] = max(rank_by_name[nm], node_rank[(cand[i], nm)])
    ordered = sorted(rank_by_name, key=lambda n: (-rank_by_name[n], n))
    names, seen = [], set()
    for nm in ordered:  # keep the most important section name of each distinct road
        if base_name(nm) not in seen:
            seen.add(base_name(nm))
            names.append(nm)
    if len(names) < 2:
        continue
    lon =float(np.mean([node_pos[cand[i]][0] for i in members]))
    lat = float(np.mean([node_pos[cand[i]][1] for i in members]))
    if not (SOUTH < lat < NORTH and WEST < lon < EAST):
        continue
    inters.append({"names": names[:2], "lon": lon, "lat": lat,
                   "rank": rank_by_name[names[0]] + rank_by_name[names[1]]})
# a divided road meets a street at two nearby points: merge same-pair points within 250 m
MERGE_M = 250
merged = []
for d in sorted(inters, key=lambda d: (-d["rank"], round(d["lat"], 5), round(d["lon"], 5))):
    pair = frozenset(base_name(n) for n in d["names"])
    for m in merged:
        if m["pair"] == pair and math.hypot((d["lon"] - m["lon"]) * MX, (d["lat"] - m["lat"]) * MY) < MERGE_M:
            m["pts"].append((d["lon"], d["lat"]))
            break
    else:
        merged.append({**d, "pair": pair, "pts": [(d["lon"], d["lat"])]})
inters = []
for m in merged:
    m["lon"] = float(np.mean([p[0] for p in m["pts"]]))
    m["lat"] = float(np.mean([p[1] for p in m["pts"]]))
    inters.append({k: m[k] for k in ("names", "lon", "lat", "rank", "pts")})
inters.sort(key=lambda d: (round(d["lat"], 5), round(d["lon"], 5)))
ix, iy = xy([d["lon"] for d in inters], [d["lat"] for d in inters])

# ---------------------------------------------------------------- accidents (real)
frames = []
for roc in range(108, 115):
    d = pd.read_csv(RAW / f"accidents_{roc}.csv", dtype=str, encoding="utf-8-sig")
    frames.append(d)
acc = pd.concat(frames, ignore_index=True).drop_duplicates()
acc["year"] = pd.to_numeric(acc["Year"], errors="coerce")
acc["lon"] = pd.to_numeric(acc["Longitude"], errors="coerce")
acc["lat"] = pd.to_numeric(acc["Latitude"], errors="coerce")
acc = acc[acc["year"].isin(YEARS) & acc["lon"].between(WEST, EAST) & acc["lat"].between(SOUTH, NORTH)].copy()
ax, ay = xy(acc["lon"].values, acc["lat"].values)
nearest = np.full(len(acc), -1)
best = np.full(len(acc), np.inf)
for k in range(len(inters)):
    px, py = xy([p[0] for p in inters[k]["pts"]], [p[1] for p in inters[k]["pts"]])
    dist = np.min(np.hypot(ax[:, None] - px[None, :], ay[:, None] - py[None, :]), axis=1)
    better = dist < best
    best[better] = dist[better]
    nearest[better] = k
acc["loc"] = np.where(best <= SNAP_M, nearest, -1)

per_year = acc[acc["loc"] >= 0].groupby(["loc", "year"]).size().unstack(fill_value=0).reindex(columns=YEARS, fill_value=0)
a1 = acc[(acc["loc"] >= 0) & acc["Accident_type"].eq("A1")].groupby("loc").size()
recent_mask = acc["year"].between(*RECENT)
area = {
    "accidents_2019_2025": int(len(acc)),
    "accidents_recent": int(recent_mask.sum()),
    "a1_recent": int((recent_mask & acc["Accident_type"].eq("A1")).sum()),
    "share_recent_at_intersections": round(float((acc.loc[recent_mask, "loc"] >= 0).mean()), 3),
}

for k, d in enumerate(inters):
    ys = per_year.loc[k].tolist() if k in per_year.index else [0] * len(YEARS)
    d["acc_by_year"] = [int(v) for v in ys]
    d["acc_recent"] = int(sum(v for y, v in zip(YEARS, ys) if RECENT[0] <= y <= RECENT[1]))
    d["a1_total"] = int(a1.get(k, 0))

with_acc = np.array([d["acc_recent"] for d in inters if d["acc_recent"] > 0])
ACC_HIGH = int(np.percentile(with_acc, 80))

# ---------------------------------------------------------------- choose demo locations
rng = random.Random(SEED)
by_acc = sorted(range(len(inters)), key=lambda k: (-inters[k]["acc_recent"], -inters[k]["rank"], k))
chosen = []
def far_enough(k, min_m):
    return all(math.hypot(ix[k] - ix[c], iy[k] - iy[c]) >= min_m for c in chosen)
for k in by_acc:
    if len(chosen) >= 18:
        break
    if far_enough(k, 120):
        chosen.append(k)
high_set = list(chosen)
low_pool = [k for k in range(len(inters)) if inters[k]["acc_recent"] < ACC_HIGH / 2 and inters[k]["rank"] >= 3]
rng.shuffle(low_pool)
for k in low_pool:
    if len(chosen) >= 36:
        break
    if far_enough(k, 220):
        chosen.append(k)
low_set = [k for k in chosen if k not in high_set]

# archetypes: (accident level is real) x (report level is mock)
arche = {}
hs = list(high_set); rng.shuffle(hs)
for i, k in enumerate(hs):
    arche[k] = "hot" if i < 11 else "blind"
ls = list(low_set); rng.shuffle(ls)
for i, k in enumerate(ls):
    arche[k] = "early" if i < 7 else ("praise" if i < 11 else "calm")

# ---------------------------------------------------------------- mock reports
CATS = ["視線被擋", "號誌時間太短", "待轉區讓人困惑", "標線看不清楚", "沒有人行空間", "車速太快", "違停擋住視線", "大車進出", "路面不平"]
OWNER = {"視線被擋": ["工務局養工處", "台電"], "號誌時間太短": ["交通局"], "待轉區讓人困惑": ["交通局"],
         "標線看不清楚": ["交通局"], "沒有人行空間": ["工務局養工處", "區公所"], "車速太快": ["警察局", "交通局"],
         "違停擋住視線": ["警察局"], "大車進出": ["交通局", "警察局"], "路面不平": ["工務局養工處"]}
USERS = ["行人", "機車", "汽車", "自行車", "公車乘客"]
COMMENTS = {
    "視線被擋": ["右轉的時候轉角有東西擋住，常常到最後一刻才看到行人。", "路口轉角停滿機車，騎過去完全看不到左邊來車。", "電箱剛好在轉角，小朋友走出來根本看不到。"],
    "號誌時間太短": ["綠燈才幾秒，帶著長輩過馬路走到一半就閃紅燈。", "行人號誌一亮車子也同時轉進來，每次都要用跑的。", "等紅燈很久，綠燈卻很短，很多人乾脆闖。"],
    "待轉區讓人困惑": ["待轉格太小，尖峰時根本停不進去，只能停到斑馬線上。", "待轉區畫在直行車道旁邊，等的時候大車貼著過去很恐怖。", "不知道這裡到底要不要兩段式左轉，標誌被樹擋住。"],
    "標線看不清楚": ["晚上下雨標線幾乎看不到，不知道車道在哪。", "槽化線和車道線混在一起，第一次騎一定會騎錯。", "斑馬線磨到快看不見了。"],
    "沒有人行空間": ["人行道被機車和攤位占滿，只能走在車道上。", "推嬰兒車完全過不去，只好走馬路。", "騎樓高高低低，長輩只能走到路邊。"],
    "車速太快": ["這段路很直，車子都開很快，過馬路很難判斷距離。", "下班時間很多車搶黃燈衝過路口。", "路口前沒有減速的設計，常常聽到急煞聲。"],
    "違停擋住視線": ["路口一直有車臨停，公車只能停在外側車道。", "違停在轉角，出巷口要整台車探出去才看得到。", "接送時間路口前後都是臨停。"],
    "大車進出": ["附近工地的大車進出頻繁，轉彎內輪差很可怕。", "公車和砂石車都在這裡轉，機車常被擠到邊邊。", "大車右轉的時候完全看不到旁邊的機車。"],
    "路面不平": ["挖完管線補的地方凹凸不平，騎過去很晃。", "人孔蓋比路面低一截，晚上看不到。", "雨天這裡會積水，還有坑洞。"],
}
PRAISE = ["斑馬線退縮之後，右轉車真的會停下來讓人了。", "多了行人庇護島，帶小孩過馬路安心很多。", "號誌秒數調長了，長輩終於可以從容走完。",
          "待轉區重畫之後清楚多了，不會再停錯位置。", "路口的違停變少了，視線好很多。", "新的標線很清楚，晚上也看得到。",
          "人行道整平了，推輪椅也順。", "路燈換新後晚上亮很多。"]
TIME_LABELS = ["上學上班尖峰", "白天", "下班尖峰", "夜間"]
STAGES = ["收集中", "已收到", "現勘中", "已排程", "改善中", "已改善"]


def hourly(rng, night=False):
    h = []
    for t in range(24):
        v = 0.4 + 3.2 * math.exp(-((t - 8) ** 2) / 2.5) + 3.0 * math.exp(-((t - 18) ** 2) / 3)
        if night:
            v += 2.2 * math.exp(-((t - 22) ** 2) / 3)
        if t < 6:
            v *= 0.25
        h.append(v * (0.75 + 0.5 * rng.random()))
    return h


def scale_to(weights, total, rng):
    s = sum(weights)
    raw = [w / s * total for w in weights]
    out = [int(math.floor(r)) for r in raw]
    rem = total - sum(out)
    order = sorted(range(len(raw)), key=lambda i: -(raw[i] - out[i]))
    for i in order[:rem]:
        out[i] += 1
    return out


locations = []
for n, k in enumerate(sorted(chosen, key=lambda k: (-inters[k]["acc_recent"], k))):
    d = inters[k]
    r = random.Random(SEED * 1000 + n)
    kind = arche[k]
    lid = f"L{n + 1:02d}"
    if kind in ("hot", "early"):
        negatives = r.randint(24, 68)
    elif kind == "praise":
        negatives = r.randint(3, 9)
    else:
        negatives = r.randint(1, 12)
    positives = r.randint(14, 30) if kind == "praise" else r.randint(0, 4)
    main = r.sample(CATS, 2)
    cat_w = [6 if c == main[0] else 3 if c == main[1] else r.random() * 0.8 for c in CATS]
    cat_counts = dict(sorted(zip(CATS, scale_to(cat_w, negatives, r)), key=lambda kv: -kv[1]))
    user_w = [0.25 + r.random() * 0.15, 0.42 + r.random() * 0.2, 0.12 + r.random() * 0.1, 0.04 + r.random() * 0.06, 0.05 + r.random() * 0.06]
    users = dict(zip(USERS, scale_to(user_w, negatives + positives, r)))
    hours = scale_to(hourly(r, night=r.random() < 0.3), negatives, r)
    severity = dict(zip(["感覺不安", "差點發生事故", "曾經擦撞"], scale_to([0.5, 0.38 + r.random() * 0.1, 0.08], negatives, r)))
    if kind == "hot":
        stage = r.choice(["已收到", "現勘中", "已排程", "改善中"])
    elif kind == "early":
        stage = r.choice(["已收到", "現勘中"])
    elif kind == "praise":
        stage = "已改善"
    else:
        stage = "收集中"
    # weather is a gentler visual scale than the action threshold (20): storm only when many people agree
    if positives > negatives:
        weather = "sunny"
    elif negatives >= WX_STORM:
        weather = "storm"
    elif negatives >= WX_CLOUDY:
        weather = "cloudy"
    else:
        weather = "sunny"
    owners = []
    for c in list(cat_counts)[:2]:
        for o in OWNER[c]:
            if o not in owners:
                owners.append(o)
    if len(owners) >= 3:
        owners.append("區公所（會勘）")
    comments = []
    for c in list(cat_counts)[:2]:
        for t in r.sample(COMMENTS[c], 2):
            comments.append({"tone": "concern", "category": c, "text": t, "user": r.choice(USERS[:3])})
    for t in r.sample(PRAISE, min(len(PRAISE), 1 + positives // 8)):
        comments.append({"tone": "praise", "text": t, "user": r.choice(USERS[:3])})
    peak = max(range(4), key=lambda i: [sum(hours[6:10]), sum(hours[10:16]), sum(hours[16:20]), sum(hours[20:24]) + sum(hours[0:6])][i])
    top_user = max(users, key=users.get)
    c1, c2 = list(cat_counts)[:2]
    summary = (f"{negatives} 位用路人回報這裡，以{top_user}為主，多在{TIME_LABELS[peak]}。"
               f"最常提到的是「{c1}」，其次是「{c2}」。")
    if positives:
        summary += f"另有 {positives} 人表示這裡「變好了」。"
    history = []
    if kind == "praise":
        history.append({"year": r.choice([2024, 2025]), "text": r.choice(["斑馬線退縮、增設行人庇護島", "行人號誌秒數調整", "待轉區重新劃設", "標線重新繪製"])})
    if r.random() < 0.4:
        history.append({"year": r.choice([2021, 2022, 2023]), "text": "路面刨鋪"})
    locations.append({
        "id": lid, "name": "／".join(d["names"]), "lon": round(d["lon"], 6), "lat": round(d["lat"], 6),
        "real": {"acc_by_year": d["acc_by_year"], "years": YEARS, "acc_recent": d["acc_recent"], "a1_total": d["a1_total"],
                 "level": "high" if d["acc_recent"] >= ACC_HIGH else "low"},
        "mock": True,
        "reports": {"concern": negatives, "praise": positives, "categories": cat_counts, "users": users,
                    "hours": hours, "severity": severity, "level": "high" if negatives >= 20 else "low"},
        "weather": weather, "stage": stage, "owners": owners, "summary": summary,
        "comments": comments, "history": sorted(history, key=lambda h: h["year"]),
    })

for L in locations:
    q = (L["real"]["level"], L["reports"]["level"])
    L["quadrant"] = {("high", "high"): "priority", ("low", "high"): "prevent", ("high", "low"): "blind", ("low", "low"): "calm"}[q]

(OUT / "locations.json").write_text(json.dumps(locations, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
meta = {
    "area": "中壢火車站周邊", "bbox": [WEST, SOUTH, EAST, NORTH], "years": YEARS, "recent": list(RECENT),
    "acc_high_threshold": ACC_HIGH, "report_high_threshold": 20, "weather_storm": WX_STORM, "weather_cloudy": WX_CLOUDY, "snap_m": SNAP_M, "cluster_m": CLUSTER_M,
    "n_intersections_found": len(inters), "seed": SEED, **area,
    "quadrants": dict(Counter(L["quadrant"] for L in locations)),
    "sources": {
        "accidents": "桃園市政府開放資料「桃園市A1及A2類道路交通事故」https://data.gov.tw/dataset/46364（真實資料）",
        "roads": "© OpenStreetMap contributors（ODbL）",
        "reports": "示意資料：由 data-prep/prepare.py 以固定亂數種子產生，非真實市民回報",
    },
}
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(meta, ensure_ascii=False, indent=1))
