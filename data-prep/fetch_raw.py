"""Download the raw inputs for the demo into data-prep/raw/.

- OpenStreetMap roads, railway and stations around Zhongli station (Overpass API, ODbL)
- Taoyuan A1/A2 accident records 2019–2025 (ROC 108–114), Taoyuan open data (dataset 46364)

Usage: python data-prep/fetch_raw.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).parent / "raw"
RAW.mkdir(exist_ok=True)
UA = {"User-Agent": "taoyuan-near-miss-demo (student research)"}

BBOX = (24.944, 121.208, 24.968, 121.242)  # south, west, north, east
OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = f"""[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|primary_link|secondary_link|tertiary_link|living_street)$"]{BBOX};
  way["railway"="rail"]{BBOX};
  node["railway"="station"]{BBOX};
);
out geom tags;"""

ACCIDENT_BASE = "https://opendata.tycg.gov.tw/api/dataset/d06dd55d-aac7-4b17-9211-82cbf467cc2d/resource"
ACCIDENT_RESOURCES = {
    108: "f2fd3c7c-4331-4ace-900d-724f5af5aab2",
    109: "f09b983d-d2e1-415a-81d5-7afe6347f954",
    110: "bab715d5-d0d5-4fcf-9fb8-e24dd52f9ab9",
    111: "af934167-c82d-4ca9-92e7-9ec69074ce1f",
    112: "e88f783c-6375-43b7-93d6-6ec2a839da8b",
    113: "16f535c0-2c16-4e1d-a103-d10e55c78fbb",
    114: "e8a4e4b6-ab84-4365-b612-fd0f38e7c011",
}


def fetch(url, dest, data=None):
    if dest.exists() and dest.stat().st_size > 0:
        print("skip (exists):", dest.name)
        return
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.write_bytes(r.read())
    print("saved:", dest.name, dest.stat().st_size, "bytes")
    time.sleep(1)


if __name__ == "__main__":
    fetch(OVERPASS, RAW / "osm.json", data=urllib.parse.urlencode({"data": QUERY}).encode())
    json.loads((RAW / "osm.json").read_text(encoding="utf-8"))  # fail loudly on a bad response
    for roc, rid in ACCIDENT_RESOURCES.items():
        fetch(f"{ACCIDENT_BASE}/{rid}/download", RAW / f"accidents_{roc}.csv")
