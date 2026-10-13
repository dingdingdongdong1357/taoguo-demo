"""Compose the proposal figures from annotated screenshots (run checks/figures.mjs first).

圖 4 = citizen view (map + location profile with the stage timeline)
圖 5 = citizen report on a phone, side by side with the city view
Usage: python checks/compose_figures.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "screenshots" / "annotated"
OUT = ROOT.parent / "圖"  # 01_差一點地圖/圖
OUT.mkdir(parents=True, exist_ok=True)
BG, INK, MUTED = (236, 238, 234), (31, 36, 39), (89, 98, 106)
FONT = r"C:\Windows\Fonts\msjhbd.ttc"


def label(draw, xy, text, size):
    draw.text(xy, text, fill=INK, font=ImageFont.truetype(FONT, size))


# 圖 4: the annotated citizen view as is
Image.open(SRC / "fig4_citizen.png").convert("RGB").save(OUT / "圖4_市民端_地圖與路口小檔案.png", dpi=(300, 300))

# 圖 5: phone (left) + city view (right), same height, with captions on top
phone = Image.open(SRC / "fig5_report.png").convert("RGB")
gov = Image.open(SRC / "fig5_gov.png").convert("RGB")
h = phone.height
gov = gov.resize((round(gov.width * h / gov.height), h), Image.LANCZOS)
pad, gap, top = 60, 80, 150
W = pad + phone.width + gap + gov.width + pad
H = top + h + pad
canvas = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(canvas)
label(d, (pad, 45), "市民端：用手機回報", 56)
label(d, (pad + phone.width + gap, 45), "市府端：承辦人員看到的本月案件", 56)
canvas.paste(phone, (pad, top))
d.rectangle([pad - 3, top - 3, pad + phone.width + 2, top + h + 2], outline=INK, width=4)
canvas.paste(gov, (pad + phone.width + gap, top))
d.rectangle([pad + phone.width + gap - 3, top - 3, pad + phone.width + gap + gov.width + 2, top + h + 2], outline=INK, width=4)
canvas.save(OUT / "圖5_市民回報與市府端.png", dpi=(300, 300))
print("saved", OUT / "圖4_市民端_地圖與路口小檔案.png", OUT / "圖5_市民回報與市府端.png", canvas.size)
