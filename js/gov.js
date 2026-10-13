/* 市府端（承辦人員）— mock city view: this month's cases, AI summaries, and the three actions. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var A, S, U;
  var GROUPS = [
    { route: "rank", name: "全區排行", note: function () { return "全區最多人關心的前 " + S.meta.rank_quota + " 名"; } },
    { route: "district", name: "各區名額", note: function () { return "各行政區自己的前 " + S.meta.district_quota + " 名"; } },
    { route: "fast", name: "快速通道", note: function () { return "回報少但情況嚴重"; } }
  ];
  var replied = [];

  function today() {
    var d = new Date(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return { ym: d.getFullYear() + "-" + m, date: d.getFullYear() + "-" + m + "-" + dd, label: d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月" };
  }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5); m -= 1; if (!m) { y -= 1; m = 12; } return y + "-" + String(m).padStart(2, "0"); }

  function topCauses(L, n) {
    var r = L.reports, cats = Object.keys(r.categories).filter(function (c) { return r.categories[c] > 0 && r.causes[c]; })
      .sort(function (a, b) { return r.categories[b] - r.categories[a]; }).slice(0, n);
    return cats.map(function (c) {
      var cz = r.causes[c];
      return '<li><b>' + U.esc(c) + " " + r.categories[c] + " 人</b><span>" + Object.keys(cz).slice(0, 3).map(function (k) {
        return U.esc(k) + " " + cz[k] + '<span class="owner sm">' + U.esc(U.ownerOf(c, k)) + "</span>";
      }).join("、") + "</span></li>";
    }).join("");
  }

  function caseCard(L) {
    var site = L.owners.length >= 3;
    return '<article class="case case-' + L.route + '" id="case-' + L.id + '">' +
      '<header><button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + '</button><span class="case-meta">' + U.esc(L.district) + "・" + U.esc(L.stage) + "</span></header>" +
      '<p class="case-reason">' + U.esc(L.route_reason) + "</p>" +
      '<p class="case-stats"><span><b class="mono">' + L.reports.concern + '</b> 人回報<span class="badge mock">示意</span></span><span>近三年事故 <b class="mono">' + L.real.acc_recent + "</b> 件" +
      (L.real.a1_total ? "・死亡 <b class=\"mono\">" + L.real.a1_total + "</b> 件" : "") + '<span class="badge real">真實</span></span></p>' +
      '<div class="case-ai"><p class="b-label">AI 摘要</p><p>' + U.esc(U.summaryOf(L)) + "</p></div>" +
      '<ul class="case-causes">' + topCauses(L, 2) + "</ul>" +
      '<p class="case-owners">建議權責單位：' + L.owners.map(function (o) { return '<span class="owner sm">' + U.esc(o) + "</span>"; }).join(" ") +
      (site ? '<span class="flag">　牽涉多個單位，建議會勘</span>' : "") + "</p>" +
      '<div class="case-actions"><button class="btn small" data-act="1999" data-id="' + L.id + '">產生 1999 案件</button>' +
      '<button class="btn small" data-act="update" data-id="' + L.id + '">發布市府更新</button>' +
      '<button class="btn small" data-act="decline" data-id="' + L.id + '">評估後不改善</button></div>' +
      '<div class="case-area" id="area-' + L.id + '"></div>' +
      "</article>";
  }

  function render() {
    var t = today();
    var cases = S.locs.filter(function (L) { return ["rank", "district", "fast"].indexOf(L.route) >= 0; });
    var next = S.locs.filter(function (L) { return L.route === "next"; });
    var count = function (r) { return cases.filter(function (L) { return L.route === r; }).length; };
    var thanks = [];
    S.locs.forEach(function (L) {
      if (!U.hasUpdate(L)) return;
      L.comments.filter(function (c) { return c.tone === "praise"; }).slice(0, 1).forEach(function (c) { thanks.push({ L: L, c: c }); });
    });
    var units = {};
    S.locs.forEach(function (L) { L.timeline.forEach(function (x) { if (x.type === "update") units[L.id] = x.unit; }); });
    var html =
      '<p class="eyebrow">DEMO ・ 市府端（承辦人員）</p>' +
      '<h1 class="ptitle">' + t.label + "・本月案件</h1>" +
      '<p class="lede">系統每月把市民回報整理成案件：同一個路口合併成一案，AI 寫好摘要並建議權責單位。承辦不用逐筆看回報。</p>' +
      '<div class="stats"><div class="stat"><b>' + cases.length + '</b><span>本月送審</span></div>' +
      '<div class="stat"><b>' + cases.filter(function (L) { return L.owners.length >= 3; }).length + '</b><span>建議會勘</span></div>' +
      '<div class="stat"><b>' + next.length + '</b><span>下個月優先</span></div></div>' +
      '<p class="note">本月送審：全區排行 ' + count("rank") + " 件、各區名額 " + count("district") + " 件、快速通道 " + count("fast") + " 件。案件數由名額控制，不會因為回報暴增而壓垮承辦。</p>" +
      GROUPS.map(function (g) {
        var list = cases.filter(function (L) { return L.route === g.route; });
        return '<div class="sec"><div class="sec-h"><h3>' + g.name + "（" + list.length + "）</h3><span class=\"src\">" + g.note() + "</span></div>" +
          (list.length ? list.map(caseCard).join("") : '<p class="note">本月沒有案件。</p>') + "</div>";
      }).join("") +
      (replied.length ? '<div class="sec"><div class="sec-h"><h3>本月已回覆（' + replied.length + "）</h3></div>" + replied.map(function (x) {
        return '<p class="accnote"><b>' + U.esc(x.name) + "</b>：" + U.esc(x.text) + "</p>";
      }).join("") + "</div>" : "") +
      '<div class="sec"><div class="sec-h"><h3>本月市民感謝</h3><span class="badge mock">示意</span></div>' +
      '<p class="note">市民在改善完成後說的「變好了」，每月彙整寄給負責單位的主管。</p>' +
      '<ul class="voices">' + thanks.map(function (x) {
        return '<li class="thanks"><p>「' + U.esc(x.c.text) + "」</p><small>" + U.esc(x.L.name) + "・" + x.L.reports.praise + " 人說變好了・轉寄：" + U.esc(units[x.L.id] || "負責單位") + " 主管</small></li>";
      }).join("") + "</ul></div>" +
      '<div class="sec"><p class="note"><b>資料說明</b>　回報、案件、摘要、權責單位與 1999 案號皆為示意資料；事故件數為桃園市政府開放資料。</p></div>';
    $("pin").innerHTML = html;
    $("pin").querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        var L = S.byId[b.dataset.go];
        S.map.easeTo({ center: [L.lon, L.lat], zoom: Math.max(S.map.getZoom(), 15.6), duration: 600 });
        U.pulse(L.id);
      });
    });
    $("pin").querySelectorAll("[data-act]").forEach(function (b) { b.addEventListener("click", function () { act(b.dataset.act, S.byId[b.dataset.id]); }); });
  }

  function act(kind, L) {
    var area = $("area-" + L.id);
    if (kind === "1999") {
      L.case_no = L.case_no || "TY-" + today().ym.replace("-", "").slice(2) + "-" + (1000 + parseInt(L.id.slice(1), 10) * 37 % 9000);
      var req = {
        service_code: "traffic-safety", service_name: Object.keys(L.reports.categories)[0],
        description: U.summaryOf(L), lat: L.lat, long: L.lon, address_string: "桃園市" + L.district + L.name,
        agency_responsible: L.owners.join("、"), requested_datetime: today().date,
        attributes: { reports: L.reports.concern, route: L.route, accidents_3y: L.real.acc_recent }
      };
      area.innerHTML = '<p class="accnote">已產生 1999 案件，案號 <b class="mono">' + L.case_no + '</b>（示意）。正式版會用國際通用的 Open311 格式自動送進 1999 系統：</p><pre class="json">' + U.esc(JSON.stringify(req, null, 2)) + "</pre>";
      return;
    }
    if (kind === "update") {
      area.innerHTML = '<form class="gform" novalidate><label for="u-text-' + L.id + '">修了什麼（市民會看到）</label>' +
        '<input id="u-text-' + L.id + '" placeholder="例：重劃待轉區、加設機車停等區">' +
        '<label for="u-unit-' + L.id + '">負責單位</label><select id="u-unit-' + L.id + '">' + L.owners.map(function (o) { return "<option>" + U.esc(o) + "</option>"; }).join("") + "</select>" +
        '<p class="gerr" hidden>請填寫「修了什麼」，市民會看到這段說明。</p>' +
        '<button class="btn small primary" type="submit">發布更新</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var text = $("u-text-" + L.id).value.trim();
        if (!text) { area.querySelector(".gerr").hidden = false; return; }
        publishUpdate(L, text, $("u-unit-" + L.id).value);
      });
      $("u-text-" + L.id).focus();
      return;
    }
    if (kind === "decline") {
      area.innerHTML = '<form class="gform" novalidate><label for="d-text-' + L.id + '">評估結果與理由（必填，市民會看到）</label>' +
        '<textarea id="d-text-' + L.id + '" rows="3" placeholder="例：現勘後此處車流與視距符合規範，改以加強取締違停處理"></textarea>' +
        '<p class="gerr" hidden>請填寫理由。不改善也要讓市民知道為什麼。</p>' +
        '<button class="btn small primary" type="submit">送出回覆</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var text = $("d-text-" + L.id).value.trim();
        if (!text) { area.querySelector(".gerr").hidden = false; return; }
        L.decision = { title: "評估後不改善", date: today().date.replace(/-/g, "/"), text: text };
        L.stage = "評估後不改善"; L.route = "none"; L.route_reason = "";
        replied.push({ name: L.name, text: "評估後不改善：" + text });
        U.renderMarkers(); render();
      });
      return;
    }
  }

  /* A city update closes the current stage and opens a new one; "變好了" opens for citizens. */
  function publishUpdate(L, text, unit) {
    var t = today(), stages = L.timeline.filter(function (x) { return x.type === "stage"; }), cur = stages[stages.length - 1];
    cur.current = false; cur.end = prevYm(t.ym); cur.concern = L.reports.concern; cur.praise = L.reports.praise; cur.summary = U.summaryOf(L);
    L.timeline.push({ type: "update", date: t.date, unit: unit, text: text });
    L.timeline.push({ type: "stage", n: cur.n + 1, start: t.ym, end: null, months: 1, current: true });
    var r = L.reports;
    r.concern = 0; r.praise = 0; r.causes = {};
    Object.keys(r.categories).forEach(function (k) { r.categories[k] = 0; });
    Object.keys(r.users).forEach(function (k) { r.users[k] = 0; });
    Object.keys(r.severity).forEach(function (k) { r.severity[k] = 0; });
    r.hours = r.hours.map(function () { return 0; });
    L.stage = "已改善"; L.route = "none"; L.route_reason = "";
    U.refresh(L);
    replied.push({ name: L.name, text: "已發布更新：" + text + "（" + unit + "）。曾回報的市民會收到通知，市民端已開放「這裡變好了」。" });
    U.renderMarkers(); render(); U.pulse(L.id);
  }

  function focus(id) {
    var card = $("case-" + id);
    if (card) {
      card.scrollIntoView({ block: "start", behavior: "smooth" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    } else {
      var L = S.byId[id];
      $("pin").insertAdjacentHTML("afterbegin", '<p class="accnote gnote">「' + U.esc(L.name) + "」本月沒有送審（" + U.esc(L.route === "next" ? "下個月優先" : "回報累積中") + "）。</p>");
      $("panel").scrollTop = 0;
    }
  }

  function setView(v) {
    S.view = v;
    document.querySelectorAll("#viewseg button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.view === v); });
    document.body.classList.toggle("gov", v === "gov");
    if (v === "gov") { S.sel = null; if (A.report) A.report.close(); render(); U.renderMarkers(); }
    else U.renderOverview();
    $("panel").scrollTop = 0;
  }

  function boot() {
    A = window.DemoApp; S = A.state; U = A.util;
    document.querySelectorAll("#viewseg button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });
  }
  window.GovView = { render: render, focus: focus, setView: setView, publishUpdate: publishUpdate };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
