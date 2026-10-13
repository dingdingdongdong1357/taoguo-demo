/* 市府端（承辦人員）— mock city view: this month's cases, AI summaries, and the three actions. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var A, S, U;
  var GROUPS = [
    { route: "district", name: "各區排行", note: function () { return "每個行政區前 " + S.meta.district_quota + " 名，每區名額一樣"; } },
    { route: "fast", name: "快速通道", note: function () { return "回報少但情況嚴重"; } }
  ];
  var replied = [], adjusted = [];
  var DEFER = ["本月人力已滿", "已有工程計畫，會一併處理", "需要更多回報確認", "需要其他機關先處理"];
  function units() {
    var u = {};
    Object.keys(S.meta.cause_owner).forEach(function (c) { Object.keys(S.meta.cause_owner[c]).forEach(function (k) { u[S.meta.cause_owner[c][k]] = 1; }); });
    u["公路局（省道）"] = 1;  // roads the city does not run: a common reason to send a case back
    return Object.keys(u);
  }
  /* 主責: the one unit that answers for the case and updates its status; the rest are 協辦. */
  function leadOf(L) {
    if (L.lead && L.owners.indexOf(L.lead) >= 0) return L.lead;
    return L.owners.filter(function (o) { return o.indexOf("會勘") < 0; })[0] || L.owners[0];
  }
  var PROGRESS = ["已收到", "現勘中", "已排程", "改善中"];
  function aiOwners(L) { if (!L.ai_owners) L.ai_owners = L.owners.slice(); return L.ai_owners; }
  function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }

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
      (L.real.a1_recent ? "・死亡 <b class=\"mono\">" + L.real.a1_recent + "</b> 件" : "") + '<span class="badge real">真實</span></span></p>' +
      '<div class="case-ai"><p class="b-label">AI 摘要</p><p>' + U.esc(U.summaryOf(L)) + "</p></div>" +
      '<ul class="case-causes">' + topCauses(L, 2) + "</ul>" +
      ownersHTML(L, site) +
      dispatchHTML(L) +
      '<div class="case-plan"><span class="b-label">處理進度</span><select class="stg" data-id="' + L.id + '" aria-label="更新處理進度">' +
      PROGRESS.map(function (s) { return "<option" + (L.stage === s ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
      (L.schedule ? '<small class="sched">預計 ' + L.schedule.replace("-", " 年 ") + " 月完工</small>" : "") + '<small class="sched">市民同步看得到</small></div>' +
      '<div class="case-plan"><span class="b-label">本月安排</span><div class="seg plan" role="group" aria-label="本月安排">' +
      '<button type="button" aria-pressed="true">本月處理</button><button type="button" data-act="defer" data-id="' + L.id + '" aria-pressed="false">延到下個月</button></div></div>' +
      '<div class="case-actions"><button class="btn small" data-act="1999" data-id="' + L.id + '">產生 1999 案件</button>' +
      '<button class="btn small" data-act="update" data-id="' + L.id + '">發布市府更新</button>' +
      '<button class="btn small" data-act="minor" data-id="' + L.id + '">登錄小修</button>' +
      '<button class="btn small" data-act="decline" data-id="' + L.id + '">評估後不改善</button></div>' +
      '<div class="case-area" id="area-' + L.id + '"></div>' +
      "</article>";
  }

  /* AI suggests the units; the case officer can add or remove them. Changes are logged next to the AI's suggestion. */
  function ownersHTML(L, site) {
    var ai = aiOwners(L), changed = !sameSet(ai, L.owners), rest = units().filter(function (u) { return L.owners.indexOf(u) < 0; });
    var lead = leadOf(L);
    return '<div class="case-owners"><span>權責單位' + (changed ? "（承辦已調整）" : "（AI 建議，可調整）") + "：</span>" +
      L.owners.map(function (o) {
        var isLead = o === lead;
        return '<span class="owner sm ed' + (isLead ? " lead" : "") + '">' + (isLead ? '<b class="role">主責</b>' : '<button type="button" class="role" data-lead="' + U.esc(o) + '" data-id="' + L.id + '" title="設為主責">協辦</button>') +
          U.esc(o) + (L.owners.length > 1 ? '<button type="button" class="ox" data-rm="' + U.esc(o) + '" data-id="' + L.id + '" aria-label="移除' + U.esc(o) + '">×</button>' : "") + "</span>";
      }).join(" ") +
      (rest.length ? ' <select class="oadd" data-id="' + L.id + '" aria-label="加入權責單位"><option value="">＋ 加入單位</option>' + rest.map(function (u) { return "<option>" + U.esc(u) + "</option>"; }).join("") + "</select>" : "") +
      (site ? '<span class="flag">　牽涉多個單位，建議會勘</span>' : "") +
      (changed ? '<small class="aiorig">AI 原建議：' + U.esc(ai.join("、")) + "</small>" : "") + "</div>";
  }
  /* Dispatch: the window confirms the AI's suggestion; the lead unit can send it back with a reason. */
  function dispatchHTML(L) {
    var lead = leadOf(L), out = '<div class="dispatch">';
    if (L.returned) {
      out += '<p class="returned"><b>' + U.esc(L.returned.from) + " 退回</b>（" + L.returned.date + "）：" + U.esc(L.returned.reason) +
        (L.returned.suggest ? "；建議改派：" + U.esc(L.returned.suggest) : "") + "</p>" +
        (L.returned.suggest ? '<button class="btn small" data-act="reassign" data-id="' + L.id + '">改派給 ' + U.esc(L.returned.suggest) + "</button>" : "");
    }
    if (L.dispatched) {
      out += '<p class="sent">✓ 已派案給 <b>' + U.esc(L.dispatched.lead) + "</b>（" + L.dispatched.date + "）</p>" +
        '<button class="btn small ghost" data-act="return" data-id="' + L.id + '">示範：以 ' + U.esc(L.dispatched.lead) + " 身分退回改派</button>";
    } else {
      out += '<p class="pending">待派案窗口確認：主責 <b>' + U.esc(lead) + "</b></p>" +
        '<button class="btn small primary" data-act="dispatch" data-id="' + L.id + '">確認派案</button>';
    }
    return out + "</div>";
  }
  var fixes = [];  // suggested corrections to the cause → unit table, from send-backs

  function logAdjust(L, text) { adjusted.push({ name: L.name, text: text, date: today().date.replace(/-/g, "/") }); }
  function setOwners(L, owners, what) {
    aiOwners(L); L.owners = owners; L.dispatched = null; logAdjust(L, what); render(); focusCard(L.id);
  }
  function focusCard(id) { var c = $("case-" + id); if (c) c.scrollIntoView({ block: "nearest" }); }

  function deferredCard(L) {
    return '<article class="case case-next" id="case-' + L.id + '"><header><button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + '</button><span class="case-meta">' + U.esc(L.district) + "・" + L.reports.concern + " 人回報</span></header>" +
      '<p class="case-reason">原本：' + U.esc(L.deferred.prev_reason) + "</p>" +
      '<p class="case-reason"><b>延後理由：</b>' + U.esc(L.deferred.reason) + "（市民端會顯示「排入下個月」與這個理由）</p>" +
      '<div class="case-actions"><button class="btn small" data-act="undefer" data-id="' + L.id + '">改回本月處理</button></div></article>';
  }

  function render() {
    var t = today();
    var cases = S.locs.filter(function (L) { return ["district", "fast"].indexOf(L.route) >= 0; });
    var deferred = S.locs.filter(function (L) { return L.deferred; });
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
      '<p class="lede">系統每月把市民回報整理成案件：同一個路口合併成一案，AI 寫好摘要並建議權責單位。承辦不用逐筆看回報；權責單位和本月要不要處理，承辦都可以手動調整。</p>' +
      '<div class="stats"><div class="stat"><b>' + cases.length + '</b><span>本月送審</span></div>' +
      '<div class="stat"><b>' + cases.filter(function (L) { return !L.dispatched; }).length + '</b><span>待派案</span></div>' +
      '<div class="stat"><b>' + cases.filter(function (L) { return L.owners.length >= 3; }).length + '</b><span>建議會勘</span></div>' +
      '<div class="stat"><b>' + next.length + '</b><span>下個月優先</span></div></div>' +
      '<p class="note">本月送審：各區排行 ' + count("district") + " 件（" + Object.keys(S.meta.districts).length + " 區 × 每區 " + S.meta.district_quota + " 名）、快速通道 " + count("fast") + " 件。案件數由名額控制，不會因為回報暴增而壓垮承辦。</p>" +
      GROUPS.map(function (g) {
        var list = cases.filter(function (L) { return L.route === g.route; });
        return '<div class="sec"><div class="sec-h"><h3>' + g.name + "（" + list.length + "）</h3><span class=\"src\">" + g.note() + "</span></div>" +
          (list.length ? list.map(caseCard).join("") : '<p class="note">本月沒有案件。</p>') + "</div>";
      }).join("") +
      (deferred.length ? '<div class="sec"><div class="sec-h"><h3>延到下個月（' + deferred.length + '）</h3><span class="src">承辦調整，下個月優先</span></div>' + deferred.map(deferredCard).join("") + "</div>" : "") +
      (fixes.length ? '<div class="sec"><div class="sec-h"><h3>權責對照表修正建議（' + fixes.length + '）</h3></div><p class="note">局處退回改派的理由，彙整給交通局更新權責對照表，下次 AI 就不會再建議錯。</p>' + fixes.map(function (x) {
        return '<p class="accnote">「' + U.esc(x.cause) + "」：" + U.esc(x.from) + " → " + U.esc(x.to || "待確認") + "（" + U.esc(x.reason) + "）</p>";
      }).join("") + "</div>" : "") +
      (adjusted.length ? '<div class="sec"><div class="sec-h"><h3>本月調整紀錄（' + adjusted.length + '）</h3></div><p class="note">AI 建議和承辦決定不同時會留下紀錄，方便主管查核，也用來改進 AI 的建議。</p>' + adjusted.map(function (x) {
        return '<p class="accnote"><b>' + U.esc(x.name) + "</b>：" + U.esc(x.text) + "<small>　" + x.date + "</small></p>";
      }).join("") + "</div>" : "") +
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
    $("pin").querySelectorAll("[data-rm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var L = S.byId[b.dataset.id], o = b.dataset.rm;
        setOwners(L, L.owners.filter(function (x) { return x !== o; }), "移除權責單位「" + o + "」");
      });
    });
    $("pin").querySelectorAll("[data-lead]").forEach(function (b) {
      b.addEventListener("click", function () {
        var L = S.byId[b.dataset.id]; aiOwners(L); L.lead = b.dataset.lead; L.dispatched = null;
        logAdjust(L, "主責改為「" + L.lead + "」"); render(); focusCard(L.id);
      });
    });
    $("pin").querySelectorAll(".stg").forEach(function (sel) {
      sel.addEventListener("change", function () { setProgress(S.byId[sel.dataset.id], sel.value); });
    });
    $("pin").querySelectorAll(".oadd").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var L = S.byId[sel.dataset.id], o = sel.value;
        if (o) setOwners(L, L.owners.concat([o]), "加入權責單位「" + o + "」");
      });
    });
  }

  /* Which reported problems this repair addresses: ticked by the case officer, shown to citizens. */
  function solvesHTML(L, pre) {
    var r = L.reports, cats = Object.keys(r.categories).filter(function (c) { return r.categories[c] > 0; })
      .sort(function (a, b) { return r.categories[b] - r.categories[a]; });
    return '<fieldset class="gsolves"><legend>處理了哪些問題（可複選，市民會看到）</legend>' + cats.map(function (c, i) {
      return '<label><input type="checkbox" name="' + pre + L.id + '" value="' + U.esc(c) + '"' + (i === 0 ? " checked" : "") + "> " + U.esc(c) + "（" + r.categories[c] + " 人）</label>";
    }).join("") + "</fieldset>";
  }
  function pickedSolves(L, pre) {
    var r = L.reports;
    return Array.prototype.map.call(document.querySelectorAll('input[name="' + pre + L.id + '"]:checked'), function (x) {
      var cz = r.causes[x.value] || {}, top = Object.keys(cz).sort(function (a, b) { return cz[b] - cz[a]; })[0] || "";
      return { cat: x.value, cause: top, n: r.categories[x.value] };
    });
  }
  function itemsOf(text) { return text.split(/[、，,]/).map(function (x) { return x.trim(); }).filter(Boolean); }

  function setProgress(L, stage) {
    var area = $("area-" + L.id);
    if (stage !== "已排程") {
      L.stage = stage; L.schedule = null;
      replied.push({ name: L.name, text: "處理進度更新為「" + stage + "」，市民端同步顯示。" });
      U.renderMarkers(); render(); focusCard(L.id); return;
    }
    area.innerHTML = '<form class="gform" novalidate><label for="s-ym-' + L.id + '">預計完工月份（市民會看到）</label><input id="s-ym-' + L.id + '" type="month">' +
      '<p class="gerr" hidden>請填預計完工月份，市民才知道大概要等多久。</p><button class="btn small primary" type="submit">更新為已排程</button></form>';
    area.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var ym = $("s-ym-" + L.id).value;
      if (!/^\d{4}-\d{2}$/.test(ym)) { area.querySelector(".gerr").hidden = false; return; }
      L.stage = "已排程"; L.schedule = ym;
      replied.push({ name: L.name, text: "已排程，預計 " + ym.replace("-", " 年 ") + " 月完工。曾回報的市民會收到 LINE 通知。" });
      U.renderMarkers(); render(); focusCard(L.id);
    });
  }

  function act(kind, L) {
    var area = $("area-" + L.id);
    if (kind === "dispatch") {
      L.dispatched = { lead: leadOf(L), date: today().date.replace(/-/g, "/") }; L.returned = null;
      if (L.stage === "收集中") L.stage = "已收到";
      render(); focusCard(L.id); return;
    }
    if (kind === "return") {
      var lead = leadOf(L), others = units().filter(function (u) { return u !== lead; });
      area.innerHTML = '<form class="gform" novalidate><p class="note">局處收到案件後，如果不屬於自己，可以退回派案窗口，但一定要寫理由，不能擱著。</p>' +
        '<label for="r-why-' + L.id + '">退回理由（必填）</label><textarea id="r-why-' + L.id + '" rows="2" placeholder="例：該路口為省道，屬公路局養護"></textarea>' +
        '<label for="r-to-' + L.id + '">建議改派給（選填）</label><select id="r-to-' + L.id + '"><option value="">不確定</option>' + others.map(function (u) { return "<option>" + U.esc(u) + "</option>"; }).join("") + "</select>" +
        '<p class="gerr" hidden>請寫退回理由。</p><button class="btn small primary" type="submit">退回派案窗口</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var why = $("r-why-" + L.id).value.trim(), to = $("r-to-" + L.id).value;
        if (!why) { area.querySelector(".gerr").hidden = false; return; }
        var r = L.reports, cat = Object.keys(r.categories).sort(function (a, b) { return r.categories[b] - r.categories[a]; })[0];
        var cz = r.causes[cat] || {}, cause = Object.keys(cz).sort(function (a, b) { return cz[b] - cz[a]; })[0] || cat;
        L.returned = { from: lead, reason: why, suggest: to, date: today().date.replace(/-/g, "/") }; L.dispatched = null;
        fixes.push({ cause: cause, from: lead, to: to, reason: why });
        logAdjust(L, lead + " 退回：" + why + (to ? "；建議改派 " + to : ""));
        render(); focusCard(L.id);
      });
      return;
    }
    if (kind === "reassign") {
      var to2 = L.returned.suggest; aiOwners(L);
      if (L.owners.indexOf(to2) < 0) L.owners = [to2].concat(L.owners);
      L.lead = to2; L.dispatched = { lead: to2, date: today().date.replace(/-/g, "/") };
      logAdjust(L, "改派主責給「" + to2 + "」"); L.returned = null;
      render(); focusCard(L.id); return;
    }
    if (kind === "1999") {
      L.case_no = L.case_no || "TY-" + today().ym.replace("-", "").slice(2) + "-" + (1000 + parseInt(L.id.slice(1), 10) * 37 % 9000);
      var req = {
        service_code: "traffic-safety", service_name: Object.keys(L.reports.categories)[0],
        description: U.summaryOf(L), lat: L.lat, long: L.lon, address_string: "桃園市" + L.district + L.name,
        agency_responsible: leadOf(L), agency_assisting: L.owners.filter(function (o) { return o !== leadOf(L); }).join("、"), requested_datetime: today().date,
        attributes: { reports: L.reports.concern, route: L.route, accidents_3y: L.real.acc_recent }
      };
      area.innerHTML = '<p class="accnote">已產生 1999 案件，案號 <b class="mono">' + L.case_no + '</b>（示意）。正式版會用國際通用的 Open311 格式自動送進 1999 系統：</p><pre class="json">' + U.esc(JSON.stringify(req, null, 2)) + "</pre>";
      return;
    }
    if (kind === "update") {
      area.innerHTML = '<form class="gform" novalidate><label for="u-text-' + L.id + '">修了什麼（市民會看到）</label>' +
        '<input id="u-text-' + L.id + '" placeholder="例：重劃待轉區、加設機車停等區">' +
        '<label for="u-unit-' + L.id + '">負責單位</label><select id="u-unit-' + L.id + '">' + L.owners.map(function (o) { return "<option>" + U.esc(o) + "</option>"; }).join("") + "</select>" +
        solvesHTML(L, "us-") +
        '<p class="gerr" hidden>請填寫「修了什麼」，並勾選處理了哪些問題。</p>' +
        '<button class="btn small primary" type="submit">發布更新</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var text = $("u-text-" + L.id).value.trim(), solves = pickedSolves(L, "us-");
        if (!text || !solves.length) { area.querySelector(".gerr").hidden = false; return; }
        publishUpdate(L, text, $("u-unit-" + L.id).value, solves);
      });
      $("u-text-" + L.id).focus();
      return;
    }
    if (kind === "minor") {
      area.innerHTML = '<form class="gform" novalidate><p class="note">小修（例如補繪斑馬線、修剪行道樹）會記在路口的維修紀錄，但不開新階段。</p>' +
        '<label for="m-text-' + L.id + '">修了什麼（市民會看到）</label><input id="m-text-' + L.id + '" placeholder="例：補繪斑馬線、修剪路口行道樹">' +
        '<label for="m-unit-' + L.id + '">施工單位</label><select id="m-unit-' + L.id + '">' + L.owners.map(function (o) { return "<option>" + U.esc(o) + "</option>"; }).join("") + "</select>" +
        solvesHTML(L, "ms-") +
        '<p class="gerr" hidden>請填寫「修了什麼」，並勾選處理了哪些問題。</p>' +
        '<button class="btn small primary" type="submit">登錄維修</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var text = $("m-text-" + L.id).value.trim(), solves = pickedSolves(L, "ms-");
        if (!text || !solves.length) { area.querySelector(".gerr").hidden = false; return; }
        L.repairs = L.repairs || [];
        L.repairs.push({ kind: "minor", date: today().date, unit: $("m-unit-" + L.id).value, items: itemsOf(text), solves: solves });
        replied.push({ name: L.name, text: "登錄小修：" + text + "。市民在路口小檔案的維修紀錄看得到。" });
        render(); focusCard(L.id);
      });
      $("m-text-" + L.id).focus();
      return;
    }
    if (kind === "defer") {
      area.innerHTML = '<form class="gform" novalidate><label for="f-why-' + L.id + '">為什麼延到下個月（市民會看到）</label>' +
        '<select id="f-why-' + L.id + '"><option value="">請選擇</option>' + DEFER.map(function (d) { return "<option>" + d + "</option>"; }).join("") + "</select>" +
        '<p class="gerr" hidden>請選擇理由。</p>' +
        '<button class="btn small primary" type="submit">延到下個月</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var why = $("f-why-" + L.id).value;
        if (!why) { area.querySelector(".gerr").hidden = false; return; }
        L.deferred = { prev_route: L.route, prev_reason: L.route_reason, reason: why };
        L.route = "next"; L.route_reason = "承辦排入下個月：" + why + "。";
        logAdjust(L, "AI 列入本月，承辦延到下個月（" + why + "）");
        U.renderMarkers(); render(); focusCard(L.id);
      });
      return;
    }
    if (kind === "undefer") {
      L.route = L.deferred.prev_route; L.route_reason = L.deferred.prev_reason; delete L.deferred;
      logAdjust(L, "改回本月處理");
      U.renderMarkers(); render(); focusCard(L.id);
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
  function publishUpdate(L, text, unit, solves) {
    var t = today(), stages = L.timeline.filter(function (x) { return x.type === "stage"; }), cur = stages[stages.length - 1];
    cur.current = false; cur.end = prevYm(t.ym); cur.concern = L.reports.concern; cur.praise = L.reports.praise; cur.summary = U.summaryOf(L);
    var rc = L.reports.categories;
    cur.top = Object.keys(rc).filter(function (c) { return rc[c] > 0; }).sort(function (a, b) { return rc[b] - rc[a]; }).map(function (c) { return [c, rc[c]]; });
    L.timeline.push({ type: "update", date: t.date, unit: unit, text: text });
    var cz = L.reports.causes, c0 = cur.top_cause ? cur.top_cause[0] : null;
    solves = solves || (c0 ? [{ cat: c0, cause: cur.top_cause[1], n: cur.top_cause[2] }] : []);
    L.repairs = L.repairs || [];
    L.repairs.push({ kind: "update", date: t.date, unit: unit, items: itemsOf(text), solves: solves });
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
