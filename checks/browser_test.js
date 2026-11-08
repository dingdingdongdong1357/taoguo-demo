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

  // a real tap on a marker opens its profile (pointer events, as on a phone)
  var T = S.locs[1], tel = S.markers[T.id].el, tr = tel.getBoundingClientRect();
  var opts = { bubbles: true, clientX: tr.left + tr.width / 2, clientY: tr.top + tr.height / 2, pointerId: 1, pointerType: "touch", isPrimary: true };
  tel.dispatchEvent(new PointerEvent("pointerdown", opts));
  tel.dispatchEvent(new PointerEvent("pointerup", opts));
  check(S.sel === T.id && document.querySelector(".ptitle").textContent === T.name, "點路口標記會打開小檔案");
  A.select(T.id, false); document.getElementById("back").click();
  check(S.sel === null, "「回到全部路口」可以返回");
  check(!document.getElementById("filters"), "地圖上沒有運具篩選（方案 B）");
  check(document.querySelectorAll(".mk.care-many, .mk.care-some, .mk.care-few, .mk.improved").length === S.locs.length, "標記用關心程度呈現（不是天氣）");
  check(document.querySelectorAll("#pin .brow").length > 0 && document.querySelectorAll("#pin .btabs button").length >= 2, "概覽有各區排行與行政區切換");
  var tabs = document.querySelectorAll("#pin .btabs button"); tabs[1].click();
  check(document.querySelector("#pin .btabs button[aria-selected=true]").textContent === tabs[1].textContent, "可以切換到另一個行政區的排行");

  // search by road name (overview) — B1
  A.select(S.locs[0].id, false); document.getElementById("back").click();
  var q = document.getElementById("q"), road = S.locs[0].name.split("／")[0];
  q.value = road; q.dispatchEvent(new Event("input"));
  var hits = document.querySelectorAll("#qres .brow");
  check(hits.length > 0 && [].every.call(hits, function (h) { return h.textContent.indexOf(road) >= 0; }), "搜尋路名會列出相符路口：" + road);
  hits[0].click();
  check(S.sel !== null, "點搜尋結果會打開小檔案");
  A.select(S.locs[0].id, false); document.getElementById("back").click();

  // stage timeline and causes — B4, B7, D4
  var U = S.locs.filter(function (x) { return x.timeline.some(function (t) { return t.type === "update"; }); })[0];
  var N = S.locs.filter(function (x) { return !x.timeline.some(function (t) { return t.type === "update"; }) && !(x.repairs || []).length; })[0];
  A.select(U.id, false);
  check(document.querySelectorAll("#pin .tl-upd").length >= 1 && !!document.querySelector("#pin .cmp"), "有市府更新的路口顯示時間線與改善前後比較");
  check(!document.getElementById("better").disabled, "市府更新後可以按「這裡變好了」");
  check(document.querySelectorAll("#pin .causes .cause li").length > 0, "小檔案顯示具體原因與權責單位");
  A.select(N.id, false);
  check(document.getElementById("better").disabled && !document.querySelector("#pin .cmp"), "沒有更新的路口不能按「這裡變好了」");

  // profile
  var L = S.locs.filter(function (x) { return x.quadrant === "prevent"; })[0];
  A.select(L.id, false);
  var secs = document.querySelectorAll("#pin .sec").length;
  check(secs >= 8, "小檔案區塊數 ≥ 8：" + secs);
  var note = document.querySelector("#pin .accnote").textContent;
  var total = L.real.acc_by_year.reduce(function (a, b) { return a + b; }, 0);
  check(note.indexOf(String(total)) >= 0 && note.indexOf(String(L.real.acc_recent)) >= 0, "小檔案的真實事故數字與資料一致");
  check(document.querySelectorAll("#pin .routes li").length === 2, "小檔案說明兩條送審路徑（各區排行、快速通道）");
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
    var quick = [].slice.call(document.querySelectorAll("#chat .opt")).some(function (x) { return x.textContent === L.name; });
    if (quick) clickOpt(L.name);
    else {
      clickOpt("我去地圖上點");  // pick on the map with a real tap on the marker
      var me2 = S.markers[L.id].el, r2 = me2.getBoundingClientRect();
      var o2 = { bubbles: true, clientX: r2.left + r2.width / 2, clientY: r2.top + r2.height / 2, pointerId: 2, pointerType: "touch", isPrimary: true };
      me2.dispatchEvent(new PointerEvent("pointerdown", o2));
      me2.dispatchEvent(new PointerEvent("pointerup", o2));
      check(!document.getElementById("phone").classList.contains("peek"), "在地圖上點路口後，回報視窗恢復");
    }
    var cats = [].slice.call(document.querySelectorAll("#chat .opts")).pop().querySelectorAll(".opt");
    cats[0].click();
    clickOpt("上學上班尖峰");
    clickOpt("每天");
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
    check(document.querySelector("#pin .summary").textContent.indexOf((before + 1) + " 位") >= 0, "AI 摘要人數同步更新");
  } catch (e) { check(false, "回報流程：" + e.message); }

  // quick "我也遇過"
  try {
    A.select(L.id, false);
    var b2 = L.reports.concern;
    document.getElementById("metoo").click();
    clickOpt("對，就是這個");
    clickOpt("下班尖峰");
    clickOpt("常常");
    clickOpt("感覺不安");
    clickOpt("送出");
    await sleep(200);
    check(L.reports.concern === b2 + 1, "「我也遇過」快速流程 +1");
    clickOpt("關閉");
  } catch (e) { check(false, "我也遇過流程：" + e.message); }

  // repair log per intersection
  try {
    var withLog = S.locs.filter(function (L) { return (L.repairs || []).length; });
    var UP = withLog.filter(function (L) { return L.repairs.some(function (x) { return x.kind === "update"; }); })[0];
    A.select(UP.id, false);
    var rps = document.querySelectorAll("#repairs .rp");
    check(rps.length === UP.repairs.length && rps[0].textContent.indexOf(UP.repairs[0].date.replace(/-/g, "/")) >= 0, "路口小檔案有維修紀錄：日期、修了什麼");
    check(document.querySelector("#repairs .rp-solves") && document.querySelector("#repairs .rtrend"), "維修紀錄寫出處理了哪個問題，市府更新另有前後每月回報比較");
    var NO = S.locs.filter(function (L) { return !(L.repairs || []).length; })[0];
    A.select(NO.id, false);
    check(document.querySelectorAll("#repairs .rp").length === 0 && document.getElementById("repairs").textContent.indexOf("還沒有維修紀錄") >= 0, "沒有維修紀錄的路口會說明");
  } catch (e) { check(false, "維修紀錄：" + e.message); }

  // report flow: emergency notice, search inside the chat, plate-number guard — C2, C15, C18
  try {
    S.me = { user: "行人", color: "#1D5C8A" };
    A.report.open({ mode: "concern" });
    check(document.getElementById("chat").textContent.indexOf("1999") >= 0, "回報開頭提醒緊急狀況打 1999");
    var rs = document.getElementById("rsearch"), target = S.locs[2];
    rs.value = target.name.split("／")[1]; rs.dispatchEvent(new Event("input"));
    clickOpt(target.name);
    check(R2loc() === target.id, "回報時可以搜尋路名選路口");
    [].slice.call(document.querySelectorAll("#chat .opts")).pop().querySelector(".opt").click();
    clickOpt("夜間"); clickOpt("遇過一次"); clickOpt("感覺不安");
    var b0 = target.reports.concern;
    document.getElementById("rtext").value = "有台車 ABC-1234 一直停在這裡";
    clickOpt("送出");
    check(target.reports.concern === b0 && !!document.getElementById("rtext"), "留言有車牌時不送出");
    document.getElementById("rtext").value = "晚上這裡很暗";
    clickOpt("送出");
    check(target.reports.concern === b0 + 1, "拿掉車牌後可以送出");
    check(document.querySelector("#chat .done .mine").textContent.indexOf("遇過一次") >= 0, "完成畫面列出我回報的內容");
    clickOpt("關閉");
  } catch (e) { check(false, "回報流程（搜尋、提醒）：" + e.message); }
  function R2loc() { return A.report.ctx && A.report.ctx.loc; }

  // city view (市府端) — P0-7
  try {
    var G = window.GovView;
    G.setView("gov");
    var nCases = S.locs.filter(function (x) { return ["district", "fast"].indexOf(x.route) >= 0; }).length;
    check(document.body.classList.contains("gov") && document.querySelectorAll("#pin .case:not(.case-rise)").length === nCases, "市府端列出本月送審案件：" + nCases + " 件");
    var C1 = S.locs.filter(function (x) { return x.route === "district"; })[0];
    var card = document.getElementById("case-" + C1.id);
    check(card.querySelector(".case-ai").textContent.indexOf(C1.reports.concern + " 位") >= 0 && card.querySelectorAll(".case-causes li").length > 0, "案件卡有 AI 摘要與具體原因");
    check(!card.querySelector('[data-act="1999"]') && !card.querySelector('[data-act="update"]') && !card.querySelector('[data-act="minor"]'), "沒有獨立的 1999、市府更新、小修按鈕");
    card.querySelector('[data-act="dispatch"]').click();
    var pre = document.querySelector("#case-" + C1.id + " .o311 pre");
    check(C1.case_no && !!pre && JSON.parse(pre.textContent).lat === C1.lat && document.querySelector("#case-" + C1.id + " .sent").textContent.indexOf(C1.case_no) >= 0, "確認派案時自動產生 1999 案件（Open311 格式）");
    document.getElementById("case-" + C1.id).querySelector('[data-act="done"]').click();
    var f = document.querySelector("#area-" + C1.id + " form");
    f.dispatchEvent(new Event("submit", { cancelable: true }));
    check(!document.querySelector("#area-" + C1.id + " .gerr").hidden, "登錄完工沒填內容會提醒");
    document.getElementById("c-text-" + C1.id).value = "重劃待轉區、加設機車停等區";
    document.getElementById("c-major-" + C1.id).checked = true;
    f.dispatchEvent(new Event("submit", { cancelable: true }));
    check((C1.repairs || []).some(function (x) { return x.kind === "update" && x.solves.length; }), "發布更新同時寫入維修紀錄與處理的問題");
    check(C1.timeline.filter(function (t) { return t.type === "update"; }).length >= 1 && C1.reports.concern === 0 && !document.getElementById("case-" + C1.id), "重大改善：開新階段、案件移出清單");
    // manual adjustments: owners and this month's plan
    var C3 = S.locs.filter(function (x) { return x.route === "district" && x.id !== C1.id; })[0], ai3 = C3.owners.slice();
    var sel = document.getElementById("case-" + C3.id).querySelector(".oadd");
    sel.value = sel.options[1].value; sel.dispatchEvent(new Event("change"));
    var added = sel.options[1].value;
    check(C3.owners.indexOf(added) >= 0 && document.getElementById("case-" + C3.id).querySelector(".aiorig"), "承辦可以加入權責單位，並保留 AI 原建議");
    document.getElementById("case-" + C3.id).querySelector('.ox[data-rm="' + added + '"]').click();
    check(C3.owners.join() === ai3.join(), "承辦可以移除權責單位");
    document.getElementById("case-" + C3.id).querySelector('[data-act="dispatch"]').click();
    var j3 = JSON.parse(document.querySelector("#case-" + C3.id + " .o311 pre").textContent);
    check([j3.agency_responsible].concat(j3.agency_assisting ? j3.agency_assisting.split("、") : []).sort().join() === C3.owners.slice().sort().join(), "1999 案件用承辦調整後的權責單位（主責＋協辦）");
    document.getElementById("case-" + C3.id).querySelector('[data-act="defer"]').click();
    var f3 = document.querySelector("#area-" + C3.id + " form");
    f3.dispatchEvent(new Event("submit", { cancelable: true }));
    check(!f3.querySelector(".gerr").hidden && !C3.deferred, "延到下個月沒選理由會擋下");
    document.getElementById("f-why-" + C3.id).value = "本月人力已滿";
    f3.dispatchEvent(new Event("submit", { cancelable: true }));
    check(C3.route === "next" && C3.route_reason.indexOf("本月人力已滿") >= 0 && document.querySelector("#case-" + C3.id + '.case-next'), "延到下個月：案件移到延後區，市民端看得到理由");
    check(document.getElementById("pin").textContent.indexOf("本月調整紀錄") >= 0, "承辦調整留下紀錄");
    document.querySelector('[data-act="undefer"][data-id="' + C3.id + '"]').click();
    check(C3.route === "district" && !C3.deferred, "可以改回本月處理");
    var C4 = S.locs.filter(function (x) { return ["district", "fast"].indexOf(x.route) >= 0 && x.id !== C1.id && x.id !== C3.id; })[0], n4 = (C4.repairs || []).length;
    var st4 = C4.timeline.filter(function (t) { return t.type === "stage"; }).length;
    document.getElementById("case-" + C4.id).querySelector('[data-act="done"]').click();
    var f4 = document.querySelector("#area-" + C4.id + " form");
    document.getElementById("c-text-" + C4.id).value = "補繪斑馬線、修剪路口行道樹";
    f4.dispatchEvent(new Event("submit", { cancelable: true }));
    check(C4.repairs.length === n4 + 1 && C4.repairs[n4].kind === "minor" && C4.repairs[n4].items.length === 2 && C4.repairs[n4].solves.length >= 1, "登錄完工（沒勾重大改善）：寫入維修紀錄");
    check(C4.timeline.filter(function (t) { return t.type === "stage"; }).length === st4 && C4.stage === "已改善" && !document.getElementById("case-" + C4.id), "沒勾重大改善：不開新階段，案件結案");
    // dispatch: confirm, send back with a reason, reassign; progress update with a month
    var D = S.locs.filter(function (x) { return x.route === "fast"; })[1] || S.locs.filter(function (x) { return x.route === "fast"; })[0];
    document.getElementById("case-" + D.id).querySelector('[data-act="dispatch"]').click();
    check(D.dispatched && document.getElementById("case-" + D.id).querySelector(".dispatch .sent"), "派案窗口確認派案給主責單位");
    document.getElementById("case-" + D.id).querySelector('[data-act="return"]').click();
    var fr = document.querySelector("#area-" + D.id + " form");
    fr.dispatchEvent(new Event("submit", { cancelable: true }));
    check(!fr.querySelector(".gerr").hidden && !D.returned, "退回改派沒寫理由會擋下");
    document.getElementById("r-why-" + D.id).value = "該路口為省道，屬公路局養護";
    document.getElementById("r-to-" + D.id).value = "公路局（省道）";
    fr.dispatchEvent(new Event("submit", { cancelable: true }));
    check(D.returned && !D.dispatched && document.getElementById("pin").textContent.indexOf("權責對照表修正建議") >= 0, "退回後回到派案窗口，並產生權責對照表修正建議");
    document.getElementById("case-" + D.id).querySelector('[data-act="reassign"]').click();
    check(D.lead === "公路局（省道）" && D.dispatched && D.dispatched.lead === "公路局（省道）" && !D.returned, "改派給建議單位並成為主責");
    var sg = document.getElementById("case-" + D.id).querySelector(".stg");
    sg.value = "已排程"; sg.dispatchEvent(new Event("change"));
    var fs = document.querySelector("#area-" + D.id + " form");
    fs.dispatchEvent(new Event("submit", { cancelable: true }));
    check(!fs.querySelector(".gerr").hidden && D.stage !== "已排程", "已排程沒填預計月份會擋下");
    document.getElementById("s-ym-" + D.id).value = "2026-12";
    fs.dispatchEvent(new Event("submit", { cancelable: true }));
    check(D.stage === "已排程" && D.schedule === "2026-12", "承辦更新處理進度為已排程");
    G.setView("citizen"); A.select(D.id, false);
    check(document.getElementById("pin").textContent.indexOf("預計 2026 年 12 月") >= 0 && document.querySelector("#pin .owner.lead"), "市民端看得到處理進度、預計完工月份與主責單位");
    A.select(C4.id, false);
    check(!document.getElementById("better").disabled && document.querySelectorAll("#repairs .rp").length === C4.repairs.length, "小修完工後市民一樣可以說「這裡變好了」，維修紀錄看得到");
    S.board = D.district; A.util.renderOverview();
    var row = Array.prototype.filter.call(document.querySelectorAll(".board .brow"), function (b) { return b.dataset.id === D.id; })[0];
    var C3row = Array.prototype.filter.call(document.querySelectorAll(".board .brow"), function (b) { return b.dataset.id === C3.id; })[0];
    check((!row || row.textContent.indexOf("已排程（12 月）") >= 0) && (!C3row || C3row.textContent.indexOf("已派案") >= 0 || C3row.textContent.indexOf("現勘中") >= 0), "各區排行的標籤顯示市府的處理進度");
    G.setView("gov");
    var C2 = S.locs.filter(function (x) { return x.route === "fast"; })[0];
    document.getElementById("case-" + C2.id).querySelector('[data-act="decline"]').click();
    var f2 = document.querySelector("#area-" + C2.id + " form");
    f2.dispatchEvent(new Event("submit", { cancelable: true }));
    check(!document.querySelector("#area-" + C2.id + " .gerr").hidden && !C2.decision, "評估後不改善沒填理由會擋下");
    document.getElementById("d-text-" + C2.id).value = "現勘後視距符合規範，改以加強取締違停處理";
    f2.dispatchEvent(new Event("submit", { cancelable: true }));
    check(C2.decision && C2.stage === "評估後不改善", "填了理由才能結案");
    G.setView("citizen");
    A.select(C1.id, false);
    check(!document.getElementById("better").disabled && document.querySelectorAll("#pin .tl-upd").length >= 1, "市府更新後，市民端時間線出現更新、開放「變好了」");
    A.select(C2.id, false);
    check(document.getElementById("pin").textContent.indexOf("現勘後視距符合規範") >= 0, "市民端看得到不改善的理由");
  } catch (e) { check(false, "市府端：" + e.message); }

  // 最近變多（示意）：地圖標記、概覽清單、小檔案、市府端提醒
  try {
    var A2 = window.DemoApp, S2 = A2.state, Rs = S2.locs.filter(function (x) { return x.trend.rising; });
    check(Rs.length === S2.meta.rising.count && Rs.every(function (x) { return A2.util.risingOf(x); }), "最近變多的判定和資料一致");
    if (window.GovView) window.GovView.setView("citizen");
    A2.setLayer("reports"); A2.util.renderOverview();
    check(Rs.every(function (x) { return S2.markers[x.id].el.querySelector(".rsb"); }) &&
      S2.locs.filter(function (x) { return !x.trend.rising; }).every(function (x) { return !S2.markers[x.id].el.querySelector(".rsb"); }), "只有最近變多的路口有 ↑ 標記");
    check(document.querySelector("#legend .rsb") && document.getElementById("pin").textContent.indexOf("最近變多") >= 0, "圖例與概覽有「最近變多」");
    A2.select(Rs[0].id, false);
    check(document.querySelectorAll("#pin .trend .tb").length === Rs[0].trend.counts.length && document.querySelector("#pin .cmp.rise"), "小檔案顯示每月回報與最近變多說明");
    if (window.GovView) {
      window.GovView.setView("gov");
      check(Rs.every(function (x) { return x.route === "district" || x.route === "fast" || document.getElementById("case-" + x.id); }), "市府端列出沒進名單的最近變多路口");
      window.GovView.setView("citizen");
    }
  } catch (e) { check(false, "最近變多：" + e.message); }

  console.error = origErr;
  check(errors.length === 0, "沒有 JavaScript 錯誤" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));
  return { pass: passes.length, fail: fails.length, failures: fails };
})();
