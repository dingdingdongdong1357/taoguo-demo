/* CP3 browser test. Run in the page console (served over http):
     await (await fetch('checks/browser_test.js')).text().then(eval)
   or: eval(await (await fetch('checks/browser_test.js')).text())
   Resolves to { pass, fail, failures[] }. Mutates in-memory demo state (reload afterwards). */
(async function () {
  var fails = [], passes = [];
  function check(ok, msg) { (ok ? passes : fails).push(msg); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, ms) { for (var t = 0; t < (ms || 20000); t += 200) { if (fn()) return true; await sleep(200); } return false; }
  var errors = [];
  var origErr = console.error;
  console.error = function () { errors.push([].slice.call(arguments).join(" ")); origErr.apply(console, arguments); };
  window.addEventListener("error", function (e) { errors.push(String(e.message)); });

  check(await until(function () { return document.body.dataset.mapReady === "1"; }, 40000), "地圖載入完成");
  var A = window.DemoApp, S = A.state, m = S.map;
  check(Object.keys(S.markers).length === S.locs.length, "每個路口都有標記：" + S.locs.length);

  // markers sit where the map says they are
  var box = m.getContainer().getBoundingClientRect(), bad = [];
  S.locs.forEach(function (L) {
    var p = m.project([L.lon, L.lat]), r = S.markers[L.id].el.getBoundingClientRect();
    var dx = r.left + r.width / 2 - (box.left + p.x), dy = r.top + r.height / 2 - (box.top + p.y);
    if (Math.hypot(dx, dy) > 3) bad.push(L.id + "(" + Math.round(dx) + "," + Math.round(dy) + ")");
  });
  check(bad.length === 0, "標記位置與地圖座標吻合（誤差 ≤ 3px）" + (bad.length ? "：" + bad.slice(0, 5).join(" ") : ""));

  // layers
  ["accidents", "compare", "reports"].forEach(function (layer) {
    A.setLayer(layer);
    var el = S.markers[S.locs[0].id].el;
    var ok = layer === "accidents" ? el.classList.contains("acc") : layer === "compare" ? el.classList.contains("quad") : !el.classList.contains("acc") && !el.classList.contains("quad");
    check(ok, "圖層切換：" + layer);
    check(document.getElementById("legend").textContent.trim().length > 4, "圖例有內容：" + layer);
  });

  // filter
  var chip = document.querySelector('#filters .chip[data-u="機車"]');
  chip.click();
  var L0 = S.locs[0];
  check(S.markers[L0.id].el.querySelector(".n").textContent === String(L0.reports.users["機車"]), "運具篩選後數字＝該運具人數");
  chip.click();
  check(S.markers[L0.id].el.querySelector(".n").textContent === String(L0.reports.concern), "取消篩選後數字＝全部回報");

  // profile
  var L = S.locs.filter(function (x) { return x.quadrant === "prevent"; })[0];
  A.select(L.id, false);
  var secs = document.querySelectorAll("#pin .sec").length;
  check(secs >= 8, "小檔案區塊數 ≥ 8：" + secs);
  var note = document.querySelector("#pin .accnote").textContent;
  var total = L.real.acc_by_year.reduce(function (a, b) { return a + b; }, 0);
  check(note.indexOf(String(total)) >= 0 && note.indexOf(String(L.real.acc_recent)) >= 0, "小檔案的真實事故數字與資料一致");
  check(document.querySelectorAll("#pin .badge.mock").length >= 5 && document.querySelectorAll("#pin .badge.real").length >= 1, "小檔案標示真實／示意");

  // report flow
  var before = L.reports.concern;
  S.me = null;
  A.report.open({});
  function clickOpt(text) {
    var b = [].slice.call(document.querySelectorAll("#chat .opt")).filter(function (x) { return x.textContent === text; }).pop();
    if (!b) throw new Error("找不到選項：" + text);
    b.click();
  }
  try {
    clickOpt("就是我");
    clickOpt("這裡要注意");
    clickOpt(L.name);
    var cats = [].slice.call(document.querySelectorAll("#chat .opts")).pop().querySelectorAll(".opt");
    cats[0].click();
    clickOpt("上學上班尖峰");
    clickOpt("差點發生事故");
    clickOpt("略過，直接送出");
    await sleep(300);
    check(L.reports.concern === before + 1, "送出後回報數 +1");
    var rank = document.querySelector("#chat .done .rank b");
    check(rank && rank.textContent === String(before + 1), "顯示「你是第 N 位」");
    check(S.markers[L.id].el.querySelector(".n").textContent === String(before + 1), "地圖標記數字同步更新");
    clickOpt("關閉");
    check(document.getElementById("phone").hidden, "回報視窗可以關閉");
    A.select(L.id, false);
    check(document.querySelector("#pin .summary").textContent.indexOf((before + 1) + " 位") === 0, "AI 摘要人數同步更新");
  } catch (e) { check(false, "回報流程：" + e.message); }

  // quick "我也遇過"
  try {
    A.select(L.id, false);
    var b2 = L.reports.concern;
    document.getElementById("metoo").click();
    clickOpt("對，就是這個");
    clickOpt("下班尖峰");
    clickOpt("感覺不安");
    clickOpt("送出");
    await sleep(200);
    check(L.reports.concern === b2 + 1, "「我也遇過」快速流程 +1");
    clickOpt("關閉");
  } catch (e) { check(false, "我也遇過流程：" + e.message); }

  console.error = origErr;
  check(errors.length === 0, "沒有 JavaScript 錯誤" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));
  return { pass: passes.length, fail: fails.length, failures: fails };
})();
