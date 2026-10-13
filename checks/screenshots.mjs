// High-resolution screenshots of the demo for the proposal, via Chrome DevTools Protocol.
// Waits until the map has really loaded (body[data-map-ready="1"]) before capturing.
// Usage: (serve the demo first, e.g. python dev_server.py)  node checks/screenshots.mjs "<path to chrome.exe>" [port]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chrome = process.argv[2];
const base = `http://127.0.0.1:${process.argv[3] || 8765}/`;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots");
const shots = [
  { name: "demo_map", hash: "", w: 1600, h: 1000 },
  { name: "demo_profile", hash: "#profile-L21", w: 1600, h: 1000 },
  { name: "demo_report", hash: "#report", w: 1600, h: 1000 },
  { name: "demo_compare", hash: "#compare", w: 1600, h: 1000 },
  { name: "demo_gov", hash: "#gov", w: 1600, h: 1000 },
  { name: "demo_accidents", hash: "#accidents", w: 1600, h: 1000 },
  { name: "demo_mobile_profile", hash: "#profile-L19", w: 390, h: 844, mobile: true },
  { name: "demo_mobile_report", hash: "#report", w: 390, h: 844, mobile: true },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9333;
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--hide-scrollbars", `--user-data-dir=${mkdtempSync(join(tmpdir(), "shot-"))}`, "about:blank"], { stdio: "ignore" });

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
for (const s of shots) {
  await send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: !!s.mobile });
  await send("Page.navigate", { url: base + "?shot=" + Date.now() + s.hash });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { await sleep(250); ready = (await evaluate("document.body && document.body.dataset.mapReady")) === "1"; }
  await sleep(2200); // let markers, fonts and the report animation settle
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(outDir, s.name + ".png"), Buffer.from(shot.result.data, "base64"));
  console.log(s.name, ready ? "ok" : "MAP NOT READY");
}
ws.close(); proc.kill();
