// Annotated screenshots for the proposal (圖 4, 圖 5). Numbered badges are drawn on the live page
// at the elements they explain, then captured at 2x. Compose with: python checks/compose_figures.py
// Usage: (serve the demo first, e.g. python dev_server.py)  node checks/figures.mjs "<path to chrome.exe>" [port]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chrome = process.argv[2];
const base = `http://127.0.0.1:${process.argv[3] || 8765}/`;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "annotated");
mkdirSync(outDir, { recursive: true });

// each item: CSS selector (first match), badge number, badge corner
const shots = [
  {
    name: "fig4_citizen", hash: "#profile-L20", w: 1600, h: 1100,
    prep: `DemoApp.state.map.jumpTo({center:[121.2235,24.9555], zoom:14.35});`,
    items: [
      { sel: '.mk[data-id="L17"]', n: 1, at: "tr" },
      { sel: ".mk .rtb", n: 2, at: "tl" },
      { sel: '.mk[data-id="L20"]', n: 3, at: "tr" },
      { sel: "#layers", n: 4, at: "tr" },
      { sel: "#pin .big", n: 5, at: "tl" },
      { sel: "#pin .cmp", n: 6, at: "tl" },
      { sel: "#pin .tl-upd > div", n: 7, at: "tl" },
    ],
  },
  {
    name: "fig5_report", hash: "#report", w: 390, h: 844, mobile: true,
    items: [
      { sel: "#chat .done .rank", n: 1, at: "tl" },
      { sel: "#chat .done .stage", n: 2, at: "tl" },
      { sel: "#chat .done .mine", n: 3, at: "tr" },
    ],
  },
  {
    name: "fig5_gov", hash: "#gov", w: 1600, h: 1000,
    items: [
      { sel: "#viewseg", n: 4, at: "tr" },
      { sel: "#pin .stats", n: 5, at: "tl" },
      { sel: "#pin .case .case-ai", n: 6, at: "tl" },
      { sel: "#pin .case .case-causes", n: 7, at: "tl" },
      { sel: "#pin .case .dispatch", n: 8, at: "tl" },
    ],
  },
];

const annotateJS = (items) => `(() => {
  const items = ${JSON.stringify(items)};
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none";
  document.body.appendChild(layer);
  const missing = [];
  for (const it of items) {
    const el = document.querySelector(it.sel);
    if (!el) { missing.push(it.sel); continue; }
    const r = el.getBoundingClientRect(), pad = 4;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;border:3px solid #E2B11B;border-radius:6px;box-shadow:0 0 0 1.5px #1F2427;" +
      "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + 2 * pad) + "px;height:" + (r.height + 2 * pad) + "px";
    layer.appendChild(box);
    const b = document.createElement("div"), s = 30;
    const x = it.at.includes("r") ? r.right + pad - s / 2 : r.left - pad - s / 2;
    const y = it.at.includes("b") ? r.bottom + pad - s / 2 : r.top - pad - s / 2;
    b.textContent = it.n;
    b.style.cssText = "position:fixed;width:" + s + "px;height:" + s + "px;border-radius:50%;background:#E2B11B;color:#1F2427;" +
      "border:2.5px solid #1F2427;display:grid;place-items:center;font:800 17px/1 'IBM Plex Mono',monospace;" +
      "left:" + Math.max(2, Math.min(innerWidth - s - 2, x)) + "px;top:" + Math.max(2, Math.min(innerHeight - s - 2, y)) + "px";
    layer.appendChild(b);
  }
  return missing;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9334;
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--hide-scrollbars", `--user-data-dir=${mkdtempSync(join(tmpdir(), "fig-"))}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page").webSocketDebuggerUrl; } catch { await sleep(200); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

await send("Page.enable");
let ok = true;
for (const s of shots) {
  await send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: !!s.mobile });
  await send("Page.navigate", { url: base + "?fig=" + Date.now() + s.hash });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { await sleep(250); ready = (await evaluate("document.body && document.body.dataset.mapReady")) === "1"; }
  if (s.prep) await evaluate(s.prep);
  await sleep(2200);
  const missing = await evaluate(annotateJS(s.items));
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, s.name + ".png"), Buffer.from(shot.result.data, "base64"));
  console.log(s.name, ready ? "ok" : "MAP NOT READY", missing && missing.length ? "missing: " + missing.join(", ") : "");
  if (!ready || (missing && missing.length)) ok = false;
}
ws.close(); proc.kill();
process.exit(ok ? 0 : 1);
