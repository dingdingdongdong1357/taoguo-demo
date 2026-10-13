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
REPORT_HIGH_PCT, REPORT_SOME_PCT = 70, 35  # 回報多＝本區前 30%；有人關心＝前 65%
N_FAST_REAL = 2
N_DISTRICT = 3        # 各區排行：每區每月前 3 名送市府，每區名額一樣（依市府人力決定）
MAIN_DISTRICT = "中壢區"  # 快速通道：回報少、但這裡發生過死亡事故（真實資料）
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
district = acc[acc["loc"] >= 0].groupby("loc")["Area"].agg(lambda s: s.value_counts().index[0])
recent_mask = acc["year"].between(*RECENT)
a1_recent = acc[(acc["loc"] >= 0) & acc["Accident_type"].eq("A1") & recent_mask].groupby("loc").size()
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
    d["a1_recent"] = int(a1_recent.get(k, 0))  # fast track looks at the last three years only, like "many accidents"
    if k in district.index:
        d["district"] = str(district[k])
    else:  # no accident nearby: borrow the district of the closest accident
        j = int(np.argmin(np.hypot(ax - ix[k], ay - iy[k])))
        d["district"] = str(acc["Area"].iloc[j])

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
    arche[k] = "hot" if i < 6 else "blind"
ls = list(low_set); rng.shuffle(ls)
for i, k in enumerate(ls):
    arche[k] = "early" if i < 4 else ("praise" if i < 7 else "calm")

# ---------------------------------------------------------------- mock reports
# Everything in this block is MOCK data (fixed seed). Three layers of classification:
#   category (citizens tap one of 9)  ->  specific cause (what the AI would extract from text, voice, photos)  ->  owner unit
CATS = ["視線被擋", "號誌時間太短", "待轉區讓人困惑", "標線看不清楚", "沒有人行空間", "車速太快", "違停擋住視線", "大車進出", "路面不平"]
CAUSES = {  # category -> [(cause, owner, [what people say])]
    "視線被擋": [
        ("轉角變電箱", "台電", ["轉角的變電箱剛好擋住，右轉時看不到斑馬線上的人。", "綠色電箱擋在路口，小朋友走出來根本看不到。"]),
        ("機車停在轉角", "警察局", ["轉角停滿機車，騎過去完全看不到左邊來車。", "路口轉角一排機車，出來要整台車探出去才看得到。"]),
        ("行道樹枝葉太低", "工務局養工處", ["行道樹的樹枝垂下來，把號誌和行人都擋住了。"]),
        ("招牌或圍籬", "區公所", ["轉角店家的立牌擋在人行道邊，開車看不到行人。"]),
    ],
    "號誌時間太短": [
        ("行人綠燈秒數太短", "交通局", ["綠燈才幾秒，帶著長輩過馬路走到一半就閃紅燈。", "斑馬線很長，行人綠燈卻很短，每次都要用跑的。"]),
        ("右轉車和行人同時走", "交通局", ["行人號誌一亮，右轉車也同時轉進來，常常差點被撞。"]),
        ("紅燈等太久", "交通局", ["紅燈等很久、綠燈很短，很多人乾脆闖。"]),
    ],
    "待轉區讓人困惑": [
        ("待轉格太小", "交通局", ["待轉格太小，尖峰時根本停不進去，只能停到斑馬線上。"]),
        ("待轉區旁大車貼著過", "交通局", ["待轉區畫在直行車道旁邊，等的時候大車貼著過去很恐怖。"]),
        ("兩段式左轉標誌看不到", "交通局", ["不知道這裡要不要兩段式左轉，標誌被樹擋住。"]),
    ],
    "標線看不清楚": [
        ("斑馬線磨損", "交通局", ["斑馬線磨到快看不見了。"]),
        ("夜間雨天看不到標線", "交通局", ["晚上下雨標線幾乎看不到，不知道車道在哪。"]),
        ("槽化線和車道線混在一起", "交通局", ["槽化線和車道線混在一起，第一次騎一定會騎錯。"]),
    ],
    "沒有人行空間": [
        ("人行道被機車占用", "警察局", ["人行道被機車停滿，只能走在車道上。"]),
        ("人行道太窄或中斷", "工務局養工處", ["人行道走一走就斷掉，推嬰兒車只好走馬路。"]),
        ("騎樓高低不平", "區公所", ["騎樓高高低低，長輩只能走到路邊。"]),
    ],
    "車速太快": [
        ("長直路段沒有減速設計", "交通局", ["這段路很直，車子都開很快，過馬路很難判斷距離。"]),
        ("搶黃燈", "警察局", ["下班時間很多車搶黃燈衝過路口，常聽到急煞聲。"]),
    ],
    "違停擋住視線": [
        ("路口接送臨停", "警察局", ["接送時間路口前後都是臨停，視線全被擋住。"]),
        ("公車站前違停", "警察局", ["公車站前一直有車臨停，公車只能停在外側車道。"]),
    ],
    "大車進出": [
        ("工地大車進出", "工務局", ["附近工地的大車進出頻繁，轉彎時很可怕。"]),
        ("大車右轉內輪差", "交通局", ["大車右轉的時候完全看不到旁邊的機車。"]),
    ],
    "路面不平": [
        ("管線挖掘後沒修平", "管線單位", ["挖完管線補的地方凹凸不平，騎過去很晃。"]),
        ("人孔蓋高低差", "管線單位", ["人孔蓋比路面低一截，晚上看不到。"]),
        ("積水與坑洞", "工務局養工處", ["雨天這裡會積水，還有坑洞。"]),
    ],
}
FIX = {  # what the city did when it fixed the main problem of a category
    "視線被擋": ("協調台電遷移轉角變電箱、劃設禁止停車紅線", "台電、交通局"),
    "號誌時間太短": ("行人綠燈延長 8 秒、增設行人專用時相", "交通局"),
    "待轉區讓人困惑": ("重劃待轉區、加設機車停等區", "交通局"),
    "標線看不清楚": ("重新繪製斑馬線與車道線，改用高反光標線", "交通局"),
    "沒有人行空間": ("拓寬人行道並加設阻車柱", "工務局養工處"),
    "車速太快": ("增設減速標線與測速照相", "交通局、警察局"),
    "違停擋住視線": ("劃設紅線並加強取締", "警察局"),
    "大車進出": ("規劃大車進出動線、加設反射鏡", "交通局"),
    "路面不平": ("路面刨鋪、調整人孔蓋高度", "工務局養工處"),
}
MINOR = {  # small repairs: done without a city update, so they do not open a new stage
    ("視線被擋", "行道樹枝葉太低"): (["修剪路口行道樹"], "工務局養工處"),
    ("視線被擋", "機車停在轉角"): (["轉角劃設禁止停車紅線"], "交通局"),
    ("標線看不清楚", "斑馬線磨損"): (["補繪斑馬線"], "交通局"),
    ("標線看不清楚", "夜間雨天看不到標線"): (["加設路面反光導標"], "交通局"),
    ("路面不平", "積水與坑洞"): (["修補坑洞"], "工務局養工處"),
    ("路面不平", "人孔蓋高低差"): (["調整人孔蓋高度"], "管線單位"),
    ("沒有人行空間", "人行道被機車占用"): (["清除人行道上的機車", "加強拖吊"], "警察局"),
    ("違停擋住視線", "路口接送臨停"): (["加強取締路口臨停"], "警察局"),
    ("車速太快", "搶黃燈"): (["加設路口違規照相"], "警察局"),
}
PRAISE = {
    "視線被擋": "變電箱移走之後，右轉終於看得到斑馬線上的人了。",
    "號誌時間太短": "行人綠燈變長了，長輩可以慢慢走完。",
    "待轉區讓人困惑": "待轉區重畫之後清楚多了，不會再停到斑馬線上。",
    "標線看不清楚": "新的標線晚上下雨也看得到。",
    "沒有人行空間": "人行道拓寬了，推嬰兒車不用再走馬路。",
    "車速太快": "畫了減速標線之後，車子真的慢下來了。",
    "違停擋住視線": "路口的違停變少了，視線好很多。",
    "大車進出": "大車改走別的路線，騎車安心多了。",
    "路面不平": "路面重鋪之後很平，騎過去不會晃了。",
}
USERS = ["行人", "機車", "汽車", "自行車", "公車乘客"]
TIME_LABELS = ["上學上班尖峰", "白天", "下班尖峰", "夜間"]
STAGES = ["收集中", "已收到", "現勘中", "已排程", "改善中", "已改善"]
DATA_START, DATA_NOW = (2025, 1), (2026, 9)  # mock reports cover Jan 2025 – Sep 2026


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


def ym(t):
    return f"{t[0]}-{t[1]:02d}"


def months_between(a, b):  # inclusive, a and b are (year, month)
    return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1


def prev_month(t):
    return (t[0] - 1, 12) if t[1] == 1 else (t[0], t[1] - 1)


def split_categories(total, main, rng):
    w = [6 if c == main[0] else 3 if c == main[1] else rng.random() * 0.8 for c in CATS]
    return dict(sorted(zip(CATS, scale_to(w, total, rng)), key=lambda kv: -kv[1]))


def split_causes(cat_counts, rng):
    out = {}
    for c, n in cat_counts.items():
        if n <= 0:
            continue
        opts = CAUSES[c]
        w = [3.0] + [0.6 + rng.random() * 1.4 for _ in opts[1:]]
        out[c] = {cause: v for (cause, _, _), v in sorted(zip(opts, scale_to(w, n, rng)), key=lambda kv: -kv[1]) if v > 0}
    return out


def owner_of(cat, cause):
    return next(o for (cz, o, _) in CAUSES[cat] if cz == cause)


def present_first(cat_counts):
    return next((c for c, v in cat_counts.items() if v > 0), None)


def stage_summary(n, cat_counts, causes):
    c1 = next(iter(cat_counts))
    cz, v = next(iter(causes[c1].items()))
    return f"{n} 位用路人回報，最常提到「{c1}」，其中 {v} 人說是「{cz}」。"


order = sorted(chosen, key=lambda k: (-inters[k]["acc_recent"], k))
partial_fix = next(k for k in order if arche[k] == "hot")  # one place where the first fix did not solve it

locations = []
for n, k in enumerate(order):
    d = inters[k]
    r = random.Random(SEED * 1000 + n)
    kind = arche[k]
    lid = f"L{n + 1:02d}"
    if kind in ("hot", "early"):
        negatives = r.randint(42, 70)
    elif kind == "blind":
        negatives = r.randint(4, 30)
    elif kind == "praise":
        negatives = r.randint(3, 9)
    else:
        negatives = r.randint(1, 12)
    if d["district"] != MAIN_DISTRICT and kind != "praise":
        # mock: fewer people pass the edge of the area, so fewer reports — this is what the district quota is for
        negatives = max(1, round(negatives * 0.45))

    updated = kind == "praise" or k == partial_fix
    main = r.sample(CATS, 2)
    timeline = []
    positives = 0
    if updated:
        # stage 1: before the city's fix; its main problem is what the city fixed
        fixed_cat = main[0]
        upd = (2025, r.randint(8, 10)) if kind == "praise" else (2025, 12)
        before = r.randint(30, 60) if kind == "praise" else r.randint(45, 58)
        cats1 = split_categories(before, [fixed_cat, main[1]], r)
        causes1 = split_causes(cats1, r)
        timeline.append({"type": "stage", "n": 1, "start": ym(DATA_START), "end": ym(prev_month(upd)),
                         "months": months_between(DATA_START, prev_month(upd)), "concern": before, "praise": 0,
                         "top": [[c, v] for c, v in list(cats1.items())[:3] if v > 0],
                         "top_cause": [fixed_cat, *next(iter(causes1[fixed_cat].items()))],
                         "summary": stage_summary(before, cats1, causes1)})
        fix_text, fix_unit = FIX[fixed_cat]
        timeline.append({"type": "update", "date": f"{ym(upd)}-{r.randint(3, 27):02d}", "unit": fix_unit, "text": fix_text})
        if kind == "praise":
            positives = r.randint(14, 30)
            main = [c for c in main if c != fixed_cat] + [c for c in CATS if c not in main][:1]  # the fixed problem fades
        else:
            # the first fix did not help: about the same number of reports per month as before
            negatives = round(before / months_between(DATA_START, prev_month(upd)) * months_between(upd, DATA_NOW) * 0.9)
            positives = r.randint(2, 5)
        timeline.append({"type": "stage", "n": 2, "start": ym(upd), "end": None, "months": months_between(upd, DATA_NOW), "current": True})
    else:
        fixed_cat = None
        timeline.append({"type": "stage", "n": 1, "start": ym(DATA_START), "end": None, "months": months_between(DATA_START, DATA_NOW), "current": True})

    cat_counts = split_categories(negatives, main, r)
    causes = split_causes(cat_counts, r)
    user_w = [0.25 + r.random() * 0.15, 0.42 + r.random() * 0.2, 0.12 + r.random() * 0.1, 0.04 + r.random() * 0.06, 0.05 + r.random() * 0.06]
    users = dict(zip(USERS, scale_to(user_w, negatives + positives, r)))
    hours = scale_to(hourly(r, night=r.random() < 0.3), negatives, r)
    severity = dict(zip(["感覺不安", "差點發生事故", "曾經擦撞"], scale_to([0.5, 0.38 + r.random() * 0.1, 0.08], negatives, r)))

    owners = []  # units behind the top two causes of the top two problems
    for c in [c for c, v in cat_counts.items() if v > 0][:2]:
        for cz, v in list(causes[c].items())[:2]:
            o = owner_of(c, cz)
            if v >= 2 and o not in owners:
                owners.append(o)
    if not owners and present_first(cat_counts):  # few reports: still name the unit behind the top cause
        c0 = present_first(cat_counts)
        owners.append(owner_of(c0, next(iter(causes[c0]))))
    if len(owners) >= 3:
        owners.append("區公所（會勘）")

    comments = []
    for c in [c for c, v in cat_counts.items() if v > 0][:2]:
        for cz in list(causes[c])[:2]:
            texts = next(t for (z, _, t) in CAUSES[c] if z == cz)
            comments.append({"tone": "concern", "category": c, "cause": cz, "text": r.choice(texts), "user": r.choice(USERS[:3])})
    if positives and fixed_cat:
        comments.append({"tone": "praise", "category": fixed_cat, "text": PRAISE[fixed_cat], "user": r.choice(USERS[:3])})
        if positives >= 10:
            comments.append({"tone": "praise", "category": fixed_cat, "text": "謝謝市府，這個路口終於改了。", "user": r.choice(USERS[:3])})

    # comments belong to the current stage: date them inside it
    cur_start = tuple(int(x) for x in timeline[-1]["start"].split("-"))
    span = months_between(cur_start, DATA_NOW)
    for c in comments:
        k2 = r.randrange(span)
        y, m = cur_start[0] + (cur_start[1] - 1 + k2) // 12, (cur_start[1] - 1 + k2) % 12 + 1
        c["date"] = f"{y}/{m:02d}"
    comments.sort(key=lambda c: c["date"], reverse=True)
    peak = max(range(4), key=lambda i: [sum(hours[6:10]), sum(hours[10:16]), sum(hours[16:20]), sum(hours[20:24]) + sum(hours[0:6])][i])
    top_user = max(users, key=users.get)
    present = [c for c, v in cat_counts.items() if v > 0]
    summary = f"{negatives} 位用路人回報這裡，以{top_user}為主，多在{TIME_LABELS[peak]}。"
    if present:
        cz, v = next(iter(causes[present[0]].items()))
        summary += f"最常提到的是「{present[0]}」（其中 {v} 人說是「{cz}」）" + (f"，其次是「{present[1]}」" if len(present) > 1 else "") + "。"
    if positives:
        summary += f"另有 {positives} 人表示這裡「變好了」。"

    locations.append({
        "id": lid, "name": "／".join(d["names"]), "district": d["district"], "lon": round(d["lon"], 6), "lat": round(d["lat"], 6),
        "real": {"acc_by_year": d["acc_by_year"], "years": YEARS, "acc_recent": d["acc_recent"], "a1_total": d["a1_total"], "a1_recent": d["a1_recent"],
                 "level": "high" if d["acc_recent"] >= ACC_HIGH else "low"},
        "mock": True,
        "reports": {"concern": negatives, "praise": positives, "categories": cat_counts, "causes": causes, "users": users,
                    "hours": hours, "severity": severity},
        "_kind": kind,
        "_stage": "現勘中" if k == partial_fix else r.choice(["已收到", "現勘中", "已排程", "改善中"] if kind == "hot" else ["已收到", "現勘中"]),
        "owners": owners, "summary": summary, "comments": comments, "timeline": timeline,
    })

# "Many reports" is relative to this area (top 30%), the same ranking logic as "many accidents".
concerns = np.array([L["reports"]["concern"] for L in locations])
REPORT_HIGH = int(math.ceil(np.percentile(concerns, REPORT_HIGH_PCT)))
REPORT_SOME = int(math.ceil(np.percentile(concerns, REPORT_SOME_PCT)))
for L in locations:
    rp = L["reports"]
    rp["level"] = "high" if rp["concern"] >= REPORT_HIGH else "low"
    L["improved"] = rp["praise"] > rp["concern"]
    L["care"] = "many" if rp["concern"] >= REPORT_HIGH else "some" if rp["concern"] >= REPORT_SOME else "few"
    q = (L["real"]["level"], rp["level"])
    L["quadrant"] = {("high", "high"): "priority", ("low", "high"): "prevent", ("high", "low"): "blind", ("low", "low"): "calm"}[q]
    L["route"], L["route_reason"] = "none", ""
# Two ways onto the city's list: each district's own ranking (same quota for every district), and the fast track.
for dist in sorted({L["district"] for L in locations}):
    board = sorted([L for L in locations if L["district"] == dist and not L["improved"]], key=lambda L: (-L["reports"]["concern"], L["id"]))
    for i, L in enumerate(board, 1):
        L["district_rank"] = i
    for i, L in enumerate(board[:N_DISTRICT], 1):
        L["route"] = "district"
        L["route_reason"] = f"{dist}本月關心排行第 {i} 名，送市府處理（每區前 {N_DISTRICT} 名）。"
# Fast track, real: few reports but a fatal crash happened here (open data).
low_with_death = sorted([L for L in locations if L["route"] == "none" and L["care"] != "many" and L["real"]["a1_recent"] > 0 and not L["improved"]],
                        key=lambda L: (-L["real"]["acc_recent"], L["id"]))
for L in low_with_death[:N_FAST_REAL]:
    L["route"] = "fast"
    L["route_reason"] = f"回報只有 {L['reports']['concern']} 人，但這裡近三年（{RECENT[0]}–{RECENT[1]}）發生過 {L['real']['a1_recent']} 件死亡事故（真實資料），直接送審。"
# Fast track, mock: one person reported a collision with a photo.
for L in locations:  # many people care, but this month's slots are taken
    if L["route"] == "none" and L["care"] == "many":
        L["route"] = "next"
        L["route_reason"] = f"{L['district']}本月關心排行第 {L['district_rank']} 名，本區名額已滿，下個月優先處理。"
for L in sorted(locations, key=lambda L: L["id"]):
    if L["route"] == "none" and L["care"] == "few" and not L["improved"] and L["reports"]["severity"].get("曾經擦撞", 0) >= 1:
        L["route"] = "fast"
        L["route_reason"] = "回報人數少，但有人回報「曾經擦撞」並附上照片（示意），直接送審。"
        break
for L in locations:
    kind, stage = L.pop("_kind"), L.pop("_stage")
    if kind == "praise":
        L["stage"] = "已改善"
    elif any(t["type"] == "update" for t in L["timeline"]) and L["route"] in ("district", "next"):
        L["stage"] = stage  # fixed once, still many reports: re-survey
    elif L["route"] == "district" and L["district_rank"] == 1:
        L["stage"] = stage
    elif L["route"] in ("fast", "district"):
        L["stage"] = "已收到"
    else:
        L["stage"] = "收集中"

# Repair log per intersection: date, what was done, which reported problem it addresses.
# A separate RNG per location, so adding this does not change any other mock number.
for L in locations:
    rr = random.Random(SEED + int(L["id"][1:]))
    L["repairs"] = []
    for i, t in enumerate(L["timeline"]):
        if t["type"] != "update":
            continue
        cat, cause, n = L["timeline"][i - 1]["top_cause"]
        L["repairs"].append({"kind": "update", "date": t["date"], "unit": t["unit"],
                             "items": re.split(r"[、，]", t["text"]), "solves": [{"cat": cat, "cause": cause, "n": n}]})
    if L["repairs"] or not (L["stage"] != "收集中" or rr.random() < 0.3):
        continue
    cands = [(c, cz, v) for c in [c for c, v in L["reports"]["categories"].items() if v > 0][:3]
             for cz, v in L["reports"]["causes"][c].items() if (c, cz) in MINOR and v >= 2]
    if cands:
        c, cz, v = cands[0]
        items, unit = MINOR[(c, cz)]
        L["repairs"].append({"kind": "minor", "date": f"2026-{rr.randint(3, 8):02d}-{rr.randint(2, 27):02d}", "unit": unit,
                             "items": items, "solves": [{"cat": c, "cause": cz, "n": v}]})

(OUT / "locations.json").write_text(json.dumps(locations, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
meta = {
    "area": "中壢火車站周邊", "bbox": [WEST, SOUTH, EAST, NORTH], "years": YEARS, "recent": list(RECENT),
    "acc_high_threshold": ACC_HIGH, "report_high_threshold": REPORT_HIGH, "report_some_threshold": REPORT_SOME,
    "report_high_pct": REPORT_HIGH_PCT, "report_some_pct": REPORT_SOME_PCT, "district_quota": N_DISTRICT,
    "districts": dict(Counter(L["district"] for L in locations)), "snap_m": SNAP_M, "cluster_m": CLUSTER_M,
    "n_intersections_found": len(inters), "seed": SEED, **area,
    "quadrants": dict(Counter(L["quadrant"] for L in locations)),
    "care": dict(Counter(L["care"] for L in locations)), "data_start": ym(DATA_START), "data_now": ym(DATA_NOW),
    "cause_owner": {c: {cz: o for (cz, o, _) in v} for c, v in CAUSES.items()},
    "updated": sum(any(t["type"] == "update" for t in L["timeline"]) for L in locations),
    "repairs": sum(len(L["repairs"]) for L in locations), "routes": dict(Counter(L["route"] for L in locations)),
    "sources": {
        "accidents": "桃園市政府開放資料「桃園市A1及A2類道路交通事故」https://data.gov.tw/dataset/46364（真實資料）",
        "roads": "© OpenStreetMap contributors（ODbL）",
        "reports": "示意資料：由 data-prep/prepare.py 以固定亂數種子產生，非真實市民回報",
    },
}
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(meta, ensure_ascii=False, indent=1))
