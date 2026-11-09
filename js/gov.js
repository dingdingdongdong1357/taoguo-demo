/* 市府端（承辦人員）— mock city view: this month's cases, AI summaries, and the three actions. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var A, S, U;
  var GROUPS = [
    { route: "district", name: "各區排行", note: function () { return "每個行政區前 " + S.meta.district_quota + " 名，每區名額一樣"; } },
    { route: "fast", name: "急件", note: function () { return "人數還少，但有急迫訊號"; } }
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
      '<header>' + (L.prio ? '<b class="pn" title="本月處理順序">' + L.prio + "</b>" : "") + '<button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + '</button><span class="case-meta">' + U.esc(L.district) + "・" + U.esc(L.stage) + "</span></header>" +
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
      '<div class="case-actions"><button class="btn small" data-act="done" data-id="' + L.id + '">登錄完工</button>' +
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
      out += '<p class="sent">✓ 已派案給 <b>' + U.esc(L.dispatched.lead) + "</b>（" + L.dispatched.date + "）・1999 案號 <b class=\"mono\">" + U.esc(L.case_no) + "</b></p>" +
        '<details class="o311"><summary>看送進 1999 的資料（Open311 格式，示意）</summary><pre class="json">' + U.esc(JSON.stringify(L.case_req, null, 2)) + "</pre></details>" +
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

  /* Recently rising, not on this month's list: not a case (the quota stays), a reminder to look before it piles up. */
  function risingSec(cases) {
    var list = S.locs.filter(function (L) { return L.trend.rising && !L.improved && cases.indexOf(L) < 0; });
    if (!list.length) return "";
    return '<div class="sec"><div class="sec-h"><h3>' + U.RISE_TAG + "最近變多（" + list.length + '）</h3><span class="src">本區急件已滿，提醒主動看</span></div>' +
      '<p class="note">回報總數還不多、沒有進入本月名單，但最近 ' + S.meta.rising.window + " 個月突然變多。路口可能正在變危險（新開店家、施工改道、新設施擋視線），建議趁事故累積之前先現勘。</p>" +
      list.map(function (L) {
        var n = U.trendNumbers(L);
        return '<article class="case case-rise" id="case-' + L.id + '"><header><button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + '</button><span class="case-meta">' + U.esc(L.district) + "・共 " + L.reports.concern + " 人回報</span></header>" +
          '<p class="case-reason">每月回報 ' + n.before + " → " + n.recent + " 人（最近 " + S.meta.rising.window + " 個月）・近三年事故 " + L.real.acc_recent + ' 件<span class="badge real">真實</span></p>' +
          '<div class="case-ai"><p class="b-label">AI 摘要</p><p>' + U.esc(U.summaryOf(L)) + "</p></div></article>";
      }).join("") + "</div>";
  }

  /* 處理順序：名額決定「哪些」案件進來（每區前 3 名＋急件，不變）；這裡只排「先處理哪一件」。
     規則看得到、可以解釋：① 近三年有死亡事故 ② 急件 ③ 事故排名與回報排名的平均（0–100，和散布圖同一套）。 */
  function priority(cases) {
    var R0 = U.ranks();
    var score = function (L) { return (R0[L.id].x + R0[L.id].y) / 2; };
    var list = cases.slice().sort(function (a, b) {
      return (b.real.a1_recent > 0) - (a.real.a1_recent > 0) || (b.route === "fast") - (a.route === "fast") || score(b) - score(a) || (a.id < b.id ? -1 : 1);
    });
    list.forEach(function (L, i) {
      L.prio = i + 1;
      L.prioWhy = (L.real.a1_recent ? ["死亡事故 " + L.real.a1_recent + " 件"] : []).concat(L.route === "fast" ? ["急件"] : [])
        .concat(["事故排 " + R0[L.id].x, "回報排 " + R0[L.id].y]);
    });
    return list;
  }
  function prioSec(list) {
    return '<div class="sec"><div class="sec-h"><h3>本月處理順序</h3><span class="src">先處理上面的</span></div>' +
      '<p class="note">排序規則：① 近三年有死亡事故 ② 急件 ③ 事故排名和回報排名的平均（0＝最少，100＝最多）。只決定先後，不改變名額。</p>' +
      '<ol class="prio">' + list.map(function (L) {
        return '<li><button class="prow" data-go="' + L.id + '"><b class="pn">' + L.prio + '</b><span class="nm">' + U.esc(L.name) + "<small>" + U.esc(L.district) + "・" + U.esc(L.dispatched ? "已派案" : "待派案") + "</small></span>" +
          '<span class="why">' + L.prioWhy.map(function (w) { return '<i class="' + (w.indexOf("死亡") === 0 ? "w-dead" : w === "急件" ? "w-fast" : "") + '">' + U.esc(w) + "</i>"; }).join("") + "</span></button></li>";
      }).join("") + "</ol></div>";
  }
  function render() {
    var t = today();
    var cases = priority(S.locs.filter(function (L) { return ["district", "fast"].indexOf(L.route) >= 0; }));
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
      '<p class="note">第一次用？按 <button type="button" class="qmark inline" id="govhelp" aria-label="市府端使用說明">?</button> 看六步驟操作說明。</p>' +
      '<div class="stats"><div class="stat"><b>' + cases.length + '</b><span>本月送審</span></div>' +
      '<div class="stat"><b>' + cases.filter(function (L) { return !L.dispatched; }).length + '</b><span>待派案</span></div>' +
      '<div class="stat"><b>' + cases.filter(function (L) { return L.owners.length >= 3; }).length + '</b><span>建議會勘</span></div>' +
      '<div class="stat"><b>' + next.length + '</b><span>下個月優先</span></div></div>' +
      '<p class="note">本月送審：各區排行 ' + count("district") + " 件（" + Object.keys(S.meta.districts).length + " 區 × 每區 " + S.meta.district_quota + " 名）、急件 " + count("fast") + " 件。案件數由名額控制，不會因為回報暴增而壓垮承辦。</p>" +
      prioSec(cases) +
      GROUPS.map(function (g) {
        var list = cases.filter(function (L) { return L.route === g.route; });
        return '<div class="sec"><div class="sec-h"><h3>' + g.name + "（" + list.length + "）</h3><span class=\"src\">" + g.note() + "</span></div>" +
          (list.length ? list.map(caseCard).join("") : '<p class="note">本月沒有案件。</p>') + "</div>";
      }).join("") +
      risingSec(cases) +
      (deferred.length ? '<div class="sec"><div class="sec-h"><h3>延到下個月（' + deferred.length + '）</h3><span class="src">承辦調整，下個月優先</span></div>' + deferred.map(deferredCard).join("") + "</div>" : "") +
      (fixes.length ? '<div class="sec"><div class="sec-h"><h3>權責對照表修正建議（' + fixes.length + '）</h3></div><p class="note">局處退回改派的理由，彙整給交通局更新權責對照表，下次 AI 就不會再建議錯。</p>' + fixes.map(function (x) {
        return '<p class="accnote">「' + U.esc(x.cause) + "」：" + U.esc(x.from) + " → " + U.esc(x.to || "待確認") + "（" + U.esc(x.reason) + "）</p>";
      }).join("") + "</div>" : "") +
      (adjusted.length ? '<div class="sec"><div class="sec-h"><h3>本月調整紀錄（' + adjusted.length + '）</h3></div><p class="note">AI 建議和承辦決定不同時會留下紀錄，方便主管查核，也用來改進 AI 的建議。</p>' + adjusted.map(function (x) {
        return '<p class="accnote"><b>' + U.esc(x.name) + "</b>：" + U.esc(x.text) + "<small>　" + x.date + "</small></p>";
      }).join("") + "</div>" : "") +
      doneSec() +
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
    $("govhelp").addEventListener("click", function () { U.openGuide(0); });
    $("pin").querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        var L = S.byId[b.dataset.go];
        if (S.map) S.map.easeTo({ center: [L.lon, L.lat], zoom: Math.max(S.map.getZoom(), 15.6), duration: 600 });
        U.pulse(L.id);
        if (!$("case-" + L.id)) quickCard(L);
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

  /* Confirming a dispatch opens the 1999 case (Open311 GeoReport v2 style payload); no separate button. */
  function open1999(L) {
    L.case_no = L.case_no || "TY-" + today().ym.replace("-", "").slice(2) + "-" + (1000 + parseInt(L.id.slice(1), 10) * 37 % 9000);
    L.case_req = {
      service_code: "traffic-safety", service_name: Object.keys(L.reports.categories).sort(function (a, b) { return L.reports.categories[b] - L.reports.categories[a]; })[0],
      description: U.summaryOf(L), lat: L.lat, long: L.lon, address_string: "桃園市" + L.district + L.name,
      agency_responsible: leadOf(L), agency_assisting: L.owners.filter(function (o) { return o !== leadOf(L); }).join("、"), requested_datetime: today().date,
      attributes: { case_no: L.case_no, reports: L.reports.concern, route: L.route, accidents_3y: L.real.acc_recent }
    };
  }

  /* 完工建議：依施工單位列出這個路口回報裡、該單位負責的原因 */
  var FIX_VERB = { "台電": "遷移", "警察局": "加強取締", "區公所": "移除", "管線單位": "修補" };
  function fixChips(L, target, unit) {
    var r = L.reports, out = [];
    Object.keys(r.causes || {}).forEach(function (c) {
      Object.keys(r.causes[c]).forEach(function (k) {
        var o = U.ownerOf(c, k);
        if (!unit || o === unit) out.push({ k: k, n: r.causes[c][k], o: o });
      });
    });
    out.sort(function (a, b) { return b.n - a.n; });
    out = out.slice(0, 4);
    if (!out.length) return '<p class="note">' + (unit ? U.esc(unit) + " 在這個路口沒有對應的回報原因，請確認施工單位。" : "") + "</p>";
    return '<div class="chips">' + out.map(function (x) {
      var v = (FIX_VERB[x.o] || "改善") + "：" + x.k;
      return '<button type="button" class="chip" data-fill="' + target + L.id + '" data-v="' + U.esc(v) + '">' + U.esc(v) + "（" + x.n + " 人）</button>";
    }).join("") + "</div>";
  }
  function bindChips(root) {
    root.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () { var i = $(b.dataset.fill); i.value = i.value ? i.value + "、" + b.dataset.v : b.dataset.v; i.focus(); });
    });
  }
  function doneSec() {
    var list = S.locs.filter(function (L) { return L.doneMonth; });
    if (!list.length) return "";
    return '<div class="sec"><div class="sec-h"><h3>✓ 本月已完工（' + list.length + "）</h3></div><p class=\"note\">完工的路口留在這裡，點名稱可以回到地圖上看；1 個月後會回診，市民說沒變就退回。</p>" +
      list.map(function (L) {
        return '<p class="done-row"><button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + "</button>　" + U.esc(L.doneMonth.date) + "・" + U.esc(L.doneMonth.text) + "（" + U.esc(L.doneMonth.unit) + "）</p>";
      }).join("") + "</div>";
  }

  function setProgress(L, stage) {
    var area = $("area-" + L.id);
    if (stage !== "已排程") {
      L.stage = stage; L.schedule = null;
      replied.push({ name: L.name, text: "處理進度更新為「" + stage + "」，市民端同步顯示。" });
      U.renderMarkers(); render(); focusCard(L.id); return;
    }
    area.innerHTML = '<form class="gform" novalidate><label for="s-plan-' + L.id + '">預計怎麼改（市民會看到）</label>' + fixChips(L, "s-plan-") + '<input id="s-plan-' + L.id + '" placeholder="例：遷移轉角變電箱">' +
      '<label for="s-ym-' + L.id + '">預計完工月份（市民會看到）</label><input id="s-ym-' + L.id + '" type="month">' +
      '<p class="gerr" hidden>請填預計完工月份，市民才知道大概要等多久。</p><button class="btn small primary" type="submit">更新為已排程</button></form>';
    bindChips(area);
    area.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var ym = $("s-ym-" + L.id).value;
      if (!/^\d{4}-\d{2}$/.test(ym)) { area.querySelector(".gerr").hidden = false; return; }
      L.stage = "已排程"; L.schedule = ym; L.plan = $("s-plan-" + L.id).value.trim() || null;
      replied.push({ name: L.name, text: "已排程，預計 " + ym.replace("-", " 年 ") + " 月完工" + (L.plan ? "（" + L.plan + "）" : "") + "。曾回報的市民會收到 LINE 通知，地圖上會標 🚧。" });
      U.renderMarkers(); render(); focusCard(L.id);
    });
  }

  function act(kind, L) {
    var area = $("area-" + L.id);
    if (kind === "dispatch") {
      L.dispatched = { lead: leadOf(L), date: today().date.replace(/-/g, "/") }; L.returned = null; open1999(L);
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
      L.lead = to2; L.dispatched = { lead: to2, date: today().date.replace(/-/g, "/") }; open1999(L);
      logAdjust(L, "改派主責給「" + to2 + "」"); L.returned = null;
      render(); focusCard(L.id); return;
    }
    if (kind === "schedule-chips") return;
    if (kind === "done") {
      area.innerHTML = '<form class="gform" novalidate>' +
        '<label for="c-unit-' + L.id + '">施工單位</label><select id="c-unit-' + L.id + '">' + L.owners.map(function (o) { return "<option" + (o === leadOf(L) ? " selected" : "") + ">" + U.esc(o) + "</option>"; }).join("") + "</select>" +
        '<label for="c-text-' + L.id + '">修了什麼（市民會看到）</label><div id="c-chips-' + L.id + '">' + fixChips(L, "c-text-", leadOf(L)) + '</div>' +
        '<input id="c-text-' + L.id + '" placeholder="點上面的建議，或自己寫">' +
        solvesHTML(L, "cs-") +
        '<label class="major"><input type="checkbox" id="c-major-' + L.id + '"> 這是重大改善，要重新比較改善前後的回報數</label>' +
        '<p class="note">不論是否勾選，都會寫入維修紀錄、通知曾回報的市民、開放「這裡變好了」，並在 1 個月後回診。勾選後時間線會從今天切出新階段（例如重劃待轉區）；補繪標線、修剪樹木這類小修不用勾。</p>' +
        '<p class="gerr" hidden>請填寫「修了什麼」，並勾選處理了哪些問題。</p>' +
        '<button class="btn small primary" type="submit">登錄完工</button></form>';
      area.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        var text = $("c-text-" + L.id).value.trim(), solves = pickedSolves(L, "cs-"), unit = $("c-unit-" + L.id).value;
        if (!text || !solves.length) { area.querySelector(".gerr").hidden = false; return; }
        if ($("c-major-" + L.id).checked) { publishUpdate(L, text, unit, solves); return; }
        L.repairs = L.repairs || [];
        L.repairs.push({ kind: "minor", date: today().date, unit: unit, items: itemsOf(text), solves: solves });
        L.stage = "已改善"; L.route = "none"; L.route_reason = ""; L.schedule = null; L.plan = null;
        L.doneMonth = { date: today().date.replace(/-/g, "/"), text: text, unit: unit };
        replied.push({ name: L.name, text: "登錄完工：" + text + "（" + unit + "）。曾回報的市民會收到通知，可以說「這裡變好了」，1 個月後回診。" });
        U.renderMarkers(); render();
      });
      $("c-unit-" + L.id).addEventListener("change", function () { $("c-chips-" + L.id).innerHTML = fixChips(L, "c-text-", this.value); bindChips(area); });
      bindChips(area);
      $("c-text-" + L.id).focus();
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
    L.stage = "已改善"; L.route = "none"; L.route_reason = ""; L.plan = null;
    L.doneMonth = { date: t.date.replace(/-/g, "/"), text: text, unit: unit };
    U.refresh(L);
    replied.push({ name: L.name, text: "登錄完工（重大改善，開新階段）：" + text + "（" + unit + "）。曾回報的市民會收到通知，可以說「這裡變好了」，1 個月後回診。" });
    U.renderMarkers(); render(); U.pulse(L.id);
  }

  function focus(id) {
    var card = $("case-" + id);
    if (card) {
      card.scrollIntoView({ block: "start", behavior: "smooth" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    } else {
      quickCard(S.byId[id]);
    }
  }

  /* 承辦主動查看：任何路口都能叫出 AI 摘要；需要時可主動列入本月案件 */
  function quickCard(L) {
    var old = $("quick"); if (old) old.remove();
    var tags = [];
    if (L.trend.rising && !L.improved) tags.push('<span class="qtag rise">' + U.RISE_TAG + "最近變多</span>");
    if (L.improved) tags.push('<span class="qtag ok">✓ 已改善</span>');
    var Q = { priority: "危險", prevent: "潛在危險", calm: "相對安全" };
    tags.push('<span class="qtag">' + Q[L.quadrant] + "</span>");
    var html = '<article class="case quick" id="quick"><header><button class="case-name" data-go="' + L.id + '">' + U.esc(L.name) + '</button><span class="case-meta">' + U.esc(L.district) + "・" + U.esc(L.route === "next" ? "下個月優先" : L.stage) + "</span></header>" +
      '<p class="qtags">' + tags.join("") + '<span class="note">本月沒有送審，承辦主動查看</span></p>' +
      '<p class="case-stats"><span><b class="mono">' + L.reports.concern + '</b> 人回報<span class="badge mock">示意</span></span><span>近三年事故 <b class="mono">' + L.real.acc_recent + "</b> 件" +
      (L.real.a1_recent ? "・死亡 <b class=\"mono\">" + L.real.a1_recent + "</b> 件" : "") + '<span class="badge real">真實</span></span></p>' +
      (L.trend.rising && !L.improved ? '<p class="case-reason">每月回報 ' + U.trendNumbers(L).before + " → " + U.trendNumbers(L).recent + " 人</p>" : "") +
      '<div class="case-ai"><p class="b-label">AI 摘要</p><p>' + U.esc(U.summaryOf(L)) + "</p></div>" +
      '<ul class="case-causes">' + topCauses(L, 2) + "</ul>" +
      '<div class="case-actions">' + (L.improved ? "" : '<button class="btn small" id="qadd">主動列入本月案件</button>') + '<button class="btn small ghost" id="qclose">關閉</button></div></article>';
    $("pin").insertAdjacentHTML("afterbegin", html);
    $("panel").scrollTop = 0;
    $("qclose").addEventListener("click", function () { $("quick").remove(); });
    var add = $("qadd");
    if (add) add.addEventListener("click", function () {
      L.route = "fast"; L.route_reason = "承辦主動列入：" + (L.trend.rising ? "最近回報變多" : "承辦查看後判斷需要處理");
      U.renderMarkers(); render(); focus(L.id);
    });
    U.pulse(L.id);
  }

  function setView(v) {
    S.view = v;
    document.querySelectorAll("#viewseg button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.view === v); });
    document.body.classList.toggle("gov", v === "gov");
    U.setScat(v === "gov" ? window.innerWidth > 820 : S.layer === "compare");
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
