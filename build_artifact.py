"""Make dist/index.html for publishing as a claude.ai Artifact.

The Artifact host supplies its own <!doctype>/<html>/<head>/<body>, so this strips those wrappers
from index.html and keeps everything else (title, fonts, stylesheet, scripts) unchanged.
css/, js/ and data/ are published alongside it with the same relative paths.
Usage: python build_artifact.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
html = (ROOT / "index.html").read_text(encoding="utf-8")
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", head)
out = ROOT / "dist"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(head.strip() + "\n" + body.strip() + "\n", encoding="utf-8")
print("wrote", out / "index.html")
