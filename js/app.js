/* 差一點地圖 demo — map, layers, location profile and the report flow. */
(function () {
  "use strict";
  var K = window.SVGKit;
  var USERS = ["行人", "機車", "汽車", "自行車", "公車乘客"];
  var CATS = ["視線被擋", "號誌時間太短", "待轉區讓人困惑", "標線看不清楚", "沒有人行空間", "車速太快", "違停擋住視線", "大車進出", "路面不平"];
  var STAGES = ["收集中", "已收到", "現勘中", "已排程", "改善中", "已改善"];
  var TIMES = [["上學上班尖峰", 8], ["白天", 13], ["下班尖峰", 18], ["夜間", 22]];
  var SEVERITY = ["感覺不安", "差點發生事故", "曾經擦撞"];
  var PRAISE_OPTS = ["標線變清楚", "號誌時間變長", "人行空間變好", "違停變少", "其他"];
  var COLORS = ["#C46A00", "#1D5C8A", "#2B7A57", "#B23F2C", "#7B4E9E", "#E2B11B"];
  var QUAD = {
    priority: { name: "優先改善", short: "優先", v: "--q-priority", desc: "事故多，也很多人覺得危險。" },
    prevent: { name: "提早預防", short: "預防", v: "--q-prevent", desc: "事故還不多，但很多人覺得危險。這是熱點分析看不到、本提案最想找出來的地方。" },
    blind: { name: "可能的盲點", short: "盲點", v: "--q-blind", desc: "事故多，回報卻很少。可能大家習慣了，市府可以主動檢視。" },
    calm: { name: "相對安全", short: "安全", v: "--q-calm", desc: "事故少，覺得危險的人也少。" }
  };
  var CARE_TEXT = { many: "很多人關心這裡", some: "有人關心這裡", few: "回報還少：資訊不足，不代表安全" };
  var ROUTE = {
    rank: { name: "全區排行", tag: "", desc: function () { return "每月全區最多人關心的前 " + S.meta.rank_quota + " 名"; } },
    district: { name: "各區排行", tag: "區", desc: function () { return "每個行政區自己的前 " + S.meta.district_quota + " 名，人少的區也有名額"; } },
    fast: { name: "快速通道", tag: "快", desc: function () { return "回報少但情況嚴重：曾經擦撞並附照片、發生過死亡事故，或里長、學校代表回報"; } }
  };
  function careText(L) { return L.improved ? "多數人說這裡變好了" : CARE_TEXT[L.care]; }
  function careBadge(L, size) {
    return '<span class="cb care-' + L.care + (L.improved ? " improved" : "") + '" style="width:' + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.36) + 'px">' +
      (L.improved ? "✓" : L.reports.concern) + "</span>";
  }

  var S = { roads: null, locs: [], meta: null, byId: {}, board: null, layer: "reports", sel: null, me: null, map: null, markers: {}, labels: [] };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function fmt(n) { return Number(n).toLocaleString("zh-TW"); }

  /* ---------------- derived values (same rules as data-prep/prepare.py) ---------------- */
  function careOf(L) {
    var c = L.reports.concern;
    return c >= S.meta.report_high_threshold ? "many" : c >= S.meta.report_some_threshold ? "some" : "few";
  }
  function quadOf(L) {
    var hiA = L.real.acc_recent >= S.meta.acc_high_threshold, hiR = L.reports.concern >= S.meta.report_high_threshold;
    return hiA ? (hiR ? "priority" : "blind") : (hiR ? "prevent" : "calm");
  }
  /* Same template as data-prep/prepare.py, recomputed so it stays true after new reports. */
  function summaryOf(L) {
    var r = L.reports, h = r.hours, s = function (a, b) { return sum(h.slice(a, b)); };
    var bands = [s(6, 10), s(10, 16), s(16, 20), s(20, 24) + s(0, 6)], peak = bands.indexOf(Math.max.apply(null, bands));
    var top = USERS.slice().sort(function (a, b) { return (r.users[b] || 0) - (r.users[a] || 0); })[0];
    var cats = Object.keys(r.categories).filter(function (c) { return r.categories[c] > 0; }).sort(function (a, b) { return r.categories[b] - r.categories[a]; });
    var out = r.concern + " 位用路人回報這裡，以" + top + "為主，多在" + TIMES[peak][0] + "。";
    if (cats.length) {
      var cz = r.causes && r.causes[cats[0]] ? Object.keys(r.causes[cats[0]])[0] : null;
      out += "最常提到的是「" + cats[0] + "」" + (cz ? "（其中 " + r.causes[cats[0]][cz] + " 人說是「" + cz + "」）" : "") +
        (cats[1] ? "，其次是「" + cats[1] + "」" : "") + "。";
    }
    if (r.praise) out += "另有 " + r.praise + " 人表示這裡「變好了」。";
    return out;
  }
  function hasUpdate(L) { return L.timeline.some(function (t) { return t.type === "update"; }); }
  function perMonth(n, months) { return Math.round(n / Math.max(months, 1) * 10) / 10; }
  /* Before/after: compare the last finished stage with the current one, per month (stages differ in length). */
  function compareStages(L) {
    var stages = L.timeline.filter(function (t) { return t.type === "stage"; });
    if (stages.length < 2) return null;
    var prev = stages[stages.length - 2], cur = stages[stages.length - 1];
    var a = perMonth(prev.concern, prev.months), b = perMonth(L.reports.concern, cur.months);
    return { before: a, after: b, better: b <= a * 0.5 };
  }
  function refresh(L) {
    L.care = careOf(L);
    L.improved = L.reports.praise > L.reports.concern;
    L.quadrant = quadOf(L);
    if (L.route === "none" && L.care === "many") { L.route = "next"; L.route_reason = "很多人關心，排入下個月的名額。"; }
  }

  /* ---------------- map ---------------- */
  function themeColors() {
    return { bg: K.cssVar("--bg"), ink: K.cssVar("--ink"), surface: K.cssVar("--surface"), asphalt: K.cssVar("--asphalt"),
      asphalt2: K.cssVar("--asphalt-2"), lane: K.cssVar("--lane"), marking: K.cssVar("--marking"), line: K.cssVar("--line") };
  }
  function mapStyle() {
    var c = themeColors();
    var isRoad = ["==", ["get", "kind"], "road"], rank = ["get", "rank"];
    return {
      version: 8,
      sources: { roads: { type: "geojson", data: S.roads } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": c.bg } },
        { id: "rail", type: "line", source: "roads", filter: ["==", ["get", "kind"], "rail"], paint: { "line-color": c.ink, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 17, 6] } },
        { id: "rail-tie", type: "line", source: "roads", filter: ["==", ["get", "kind"], "rail"], paint: { "line-color": c.surface, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 3], "line-dasharray": [2, 2] } },
        { id: "road-minor", type: "line", source: "roads", filter: ["all", isRoad, ["<=", rank, 2]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": c.asphalt2, "line-opacity": 0.55, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 0.6, 16, 3.5, 18, 10] } },
        { id: "road-major", type: "line", source: "roads", filter: ["all", isRoad, [">=", rank, 3]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": c.asphalt, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, ["*", 0.6, rank], 16, ["*", 2.4, rank], 18, ["*", 6, rank]] } },
        { id: "road-lane", type: "line", source: "roads", minzoom: 15, filter: ["all", isRoad, [">=", rank, 3]],
          paint: { "line-color": c.lane, "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 18, 1.4], "line-dasharray": [4, 5] } },
        { id: "road-yellow-a", type: "line", source: "roads", minzoom: 15.5, filter: ["all", isRoad, [">=", rank, 5]],
          paint: { "line-color": c.marking, "line-width": ["interpolate", ["linear"], ["zoom"], 15.5, 0.6, 18, 1.6], "line-offset": ["interpolate", ["linear"], ["zoom"], 15.5, 1.2, 18, 3] } },
        { id: "road-yellow-b", type: "line", source: "roads", minzoom: 15.5, filter: ["all", isRoad, [">=", rank, 5]],
          paint: { "line-color": c.marking, "line-width": ["interpolate", ["linear"], ["zoom"], 15.5, 0.6, 18, 1.6], "line-offset": ["interpolate", ["linear"], ["zoom"], 15.5, -1.2, 18, -3] } }
      ]
    };
  }
  function recolorMap() {
    if (!S.map || !S.map.isStyleLoaded()) return;
    var c = themeColors(), m = S.map;
    m.setPaintProperty("bg", "background-color", c.bg);
    m.setPaintProperty("rail", "line-color", c.ink);
    m.setPaintProperty("rail-tie", "line-color", c.surface);
    m.setPaintProperty("road-minor", "line-color", c.asphalt2);
    m.setPaintProperty("road-major", "line-color", c.asphalt);
    m.setPaintProperty("road-lane", "line-color", c.lane);
    m.setPaintProperty("road-yellow-a", "line-color", c.marking);
    m.setPaintProperty("road-yellow-b", "line-color", c.marking);
  }

  function initMap() {
    var b = S.meta.bbox;
    var map = new maplibregl.Map({
      container: "map", style: mapStyle(), center: [121.2257, 24.9545], zoom: 14.2, minZoom: 12.6, maxZoom: 18.5,
      maxBounds: [[b[0] - 0.01, b[1] - 0.008], [b[2] + 0.01, b[3] + 0.008]], attributionControl: false, dragRotate: false, pitchWithRotate: false
    });
    map.touchZoomRotate.disableRotation();
    S.map = map;
    map.on("load", function () {
      addLabels();
      buildMarkers();
      fitAll(false);
      onZoom();
      applyHash();
      document.body.dataset.mapReady = "1";
    });
    map.on("zoom", onZoom);
    map.on("zoomend", function () { renderMarkers(); });
    $("zin").addEventListener("click", function () { map.zoomIn(); });
    $("zout").addEventListener("click", function () { map.zoomOut(); });
  }
  function onZoom() { $("map").classList.toggle("hide-labels", S.map.getZoom() < 13.9); }
  function fitAll(animate) {
    var lons = S.locs.map(function (L) { return L.lon; }), lats = S.locs.map(function (L) { return L.lat; });
    var narrow = window.innerWidth <= 820;
    S.map.fitBounds([[Math.min.apply(null, lons), Math.min.apply(null, lats)], [Math.max.apply(null, lons), Math.max.apply(null, lats)]], {
      padding: narrow ? { top: 110, bottom: window.innerHeight * 0.44 + 30, left: 30, right: 30 } : { top: 110, bottom: 90, left: 40, right: 70 },
      duration: animate ? 600 : 0, maxZoom: 15.5
    });
  }

  function addLabels() {
    var best = {};
    S.roads.features.forEach(function (f) {
      var p = f.properties;
      if (p.kind !== "road" || !p.name || p.rank < 3) return;
      var cs = f.geometry.coordinates, len = 0;
      for (var i = 1; i < cs.length; i++) len += Math.hypot(cs[i][0] - cs[i - 1][0], cs[i][1] - cs[i - 1][1]);
      if (!best[p.name] || best[p.name].len < len) best[p.name] = { len: len, mid: cs[Math.floor(cs.length / 2)], rank: p.rank };
    });
    var placed = [];
    Object.keys(best).sort(function (a, c) { return best[c].rank - best[a].rank || best[c].len - best[a].len; }).forEach(function (name) {
      var m = best[name].mid;
      if (placed.some(function (q) { return Math.hypot((q[0] - m[0]) * 101000, (q[1] - m[1]) * 110540) < 260; })) return;
      if (placed.length >= 22) return;
      placed.push(m);
      var el = document.createElement("div");
      el.className = "roadlabel";
      el.textContent = name;
      new maplibregl.Marker({ element: el }).setLngLat(m).addTo(S.map);
    });
    S.roads.features.forEach(function (f) {
      // only the operating station; OSM also lists stations still under construction
      if (f.properties.kind !== "station" || !/中壢/.test(f.properties.name || "")) return;
      var el = document.createElement("div");
      el.className = "stationlabel";
      el.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 6h6" stroke="currentColor" stroke-width="1.6"/></svg>' + esc(f.properties.name.replace(/車站$/, "") + "車站");
      new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(S.map);
    });
  }

  function buildMarkers() {
    S.locs.forEach(function (L) {
      // MapLibre owns the wrapper's classes and transform; we restyle only the inner button
      var wrap = document.createElement("div");
      var el = document.createElement("button");
      el.type = "button";
      // Handle the tap ourselves: the map treats a press as the start of a drag, which can
      // swallow the click on touch screens and inside embedded frames.
      var down = null, lastTap = 0;
      el.addEventListener("pointerdown", function (e) { e.stopPropagation(); down = { x: e.clientX, y: e.clientY }; });
      el.addEventListener("pointerup", function (e) {
        e.stopPropagation();
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) { lastTap = Date.now(); onMarker(L.id); }
        down = null;
      });
      ["mousedown", "touchstart", "dblclick"].forEach(function (t) { el.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
      el.addEventListener("click", function (e) { e.stopPropagation(); if (Date.now() - lastTap > 500) onMarker(L.id); }); // keyboard Enter/Space
      wrap.appendChild(el);
      var mk = new maplibregl.Marker({ element: wrap }).setLngLat([L.lon, L.lat]).addTo(S.map);
      S.markers[L.id] = { el: el, wrap: wrap, mk: mk };
    });
    renderMarkers();
  }
  function renderMarkers() {
    var zf = S.map ? Math.max(0.6, Math.min(1, (S.map.getZoom() - 11.6) / 2.8)) : 1;
    S.locs.forEach(function (L) {
      if (!S.markers[L.id]) return; // map not ready yet
      var el = S.markers[L.id].el, sel =S.sel === L.id ? " sel" : "", size, html, cls, label;
      if (S.layer === "accidents") {
        var a = L.real.acc_recent;
        size = Math.round((22 + Math.sqrt(a) * 2.8) * zf);
        cls = "mk acc" + (L.real.level === "high" ? "" : " low");
        html = String(a);
        label = L.name + "，近三年事故 " + a + " 件（真實資料）";
      } else if (S.layer === "compare") {
        var q = QUAD[L.quadrant];
        size = 26;
        cls = "mk quad";
        html = q.short;
        el.style.background = "var(" + q.v + ")";
        el.style.borderColor = "var(--surface)";
        label = L.name + "：" + q.name;
      } else {
        var v = L.reports.concern;
        size = Math.round((30 + Math.min(Math.sqrt(v) * 3.2, 30)) * zf);
        cls = "mk care-" + L.care + (L.improved ? " improved" : "");
        html = '<span class="n">' + (L.improved ? "✓" : v) + "</span>" +
          (ROUTE[L.route] && ROUTE[L.route].tag ? '<i class="rtb">' + ROUTE[L.route].tag + "</i>" : "");
        label = L.name + "，回報 " + v + " 人（示意資料），" + careText(L);
      }
      if (S.layer !== "compare") { el.style.background = ""; el.style.borderColor = ""; }
      el.className = cls + sel;
      S.markers[L.id].wrap.style.zIndex = sel ? "5" : "";
      el.style.width = el.style.height = size + "px";
      if (S.layer === "compare") el.style.height = "26px";
      el.innerHTML = html;
      el.setAttribute("aria-label", label);
      el.title = L.name;
    });
    renderLegend();
  }
  function pulse(id) {
    var el = S.markers[id] && S.markers[id].el;
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  function renderLegend() {
    var h;
    if (S.layer === "accidents") {
      h = '<div class="row"><span class="li"><span class="badge real">真實資料</span></span>數字＝近三年（' + S.meta.recent.join("–") + "）路口 35 公尺內事故件數</div>" +
        '<div class="row"><span class="li"><i style="width:12px;height:12px;border-radius:50%;background:var(--ink);display:inline-block"></i>本區前 20%（≥ ' + S.meta.acc_high_threshold + ' 件）</span><span class="li"><i style="width:12px;height:12px;border-radius:50%;border:2px solid var(--ink);display:inline-block"></i>其他</span></div>';
    } else if (S.layer === "compare") {
      h = '<div class="row">' + Object.keys(QUAD).map(function (k) {
        return '<span class="li"><i style="width:12px;height:12px;background:var(' + QUAD[k].v + ');display:inline-block;border-radius:2px"></i>' + QUAD[k].name + "</span>";
      }).join("") + '</div><div class="row">事故（真實）× 回報（示意）</div>';
    } else {
      var sw = function (c, t, txt) { return '<span class="li"><span class="cb care-' + c + '" style="width:18px;height:18px;font-size:10px">' + t + "</span>" + txt + "</span>"; };
      h = '<div class="row">' + sw("many", "", "很多人關心") + sw("some", "", "有人關心") + sw("few", "", "回報還少") + sw("few improved", "✓", "變好了") + "</div>" +
        '<div class="row"><span class="li"><i class="rtb static">快</i>快速通道</span><span class="li"><i class="rtb static">區</i>各區名額</span><span class="li"><span class="badge mock">示意資料</span></span>數字＝回報人數</div>';
    }
    $("legend").innerHTML = h;
  }

  /* ---------------- controls ---------------- */
  function setLayer(layer) {
    S.layer = layer;
    document.querySelectorAll("#layers button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.layer === layer); });
    renderMarkers();
    if (!S.sel) renderOverview();
  }
  /* ---------------- panel: overview ---------------- */
  function renderOverview() {
    S.sel = null;
    var counts = { priority: 0, prevent: 0, blind: 0, calm: 0 };
    S.locs.forEach(function (L) { counts[L.quadrant]++; });
    var totalReports = sum(S.locs.map(function (L) { return L.reports.concern + L.reports.praise; }));
    var pick = function (q, key) {
      return S.locs.filter(function (L) { return L.quadrant === q; }).sort(function (a, b) { return key(b) - key(a); })[0];
    };
    var picks = [
      pick("prevent", function (L) { return L.reports.concern; }),
      pick("priority", function (L) { return L.reports.concern; }),
      pick("blind", function (L) { return L.real.acc_recent; }),
      pick("calm", function (L) { return L.reports.praise; })
    ].filter(Boolean);
    var html = '<p class="eyebrow">DEMO ・ 中壢火車站周邊</p>' +
      '<h1 class="ptitle">哪裡讓人「差一點」出事？</h1>' +
      '<p class="lede">市民回報差點出事的路口，其他人可以按「我也遇過」。地圖把市民的經驗和真實事故放在一起看，找出還沒出事、但大家都覺得危險的地方。</p>' +
      '<p class="note">點地圖上的圓圈，看每個路口的小檔案；右上角「＋ 我要回報」可以體驗回報流程。</p>' +
      '<div class="search"><input id="q" type="search" autocomplete="off" placeholder="搜尋路名，例如：延平路" aria-label="搜尋路名"><ul class="qres" id="qres"></ul></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + fmt(S.meta.accidents_recent) + '</b><span>近三年事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + fmt(S.meta.a1_recent) + '</b><span>其中死亡事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + fmt(totalReports) + '</b><span>市民回報<br><span class="badge mock">示意</span></span></div></div>' +
      '<div class="sec"><div class="sec-h"><h3>四種路口</h3><span class="src">事故（真實）× 回報（示意）</span></div><div class="quadgrid">' +
      ["prevent", "priority", "blind", "calm"].map(function (k) {
        var q = QUAD[k];
        return '<button class="qcard" style="--qc:var(' + q.v + ')" data-quad="' + k + '"><b>' + q.name + "</b><span>" + q.desc + "</span><em>" + counts[k] + " 個路口</em></button>";
      }).join("") + "</div></div>" +
      boardHTML() +
      '<div class="sec"><div class="sec-h"><h3>從這幾個路口看起</h3></div><div class="picks">' +
      picks.map(function (L) {
        return '<button class="pick" data-id="' + L.id + '">' + careBadge(L, 30) + '<span><span class="nm">' + esc(L.name) + '</span><br><span class="sub">' + QUAD[L.quadrant].name + "・回報 " + L.reports.concern + " 人・近三年事故 " + L.real.acc_recent + " 件</span></span></button>";
      }).join("") + "</div></div>" +
      '<div class="sec"><p class="note"><b>資料說明</b>　事故：' + esc(S.meta.sources.accidents) + "。回報、留言、處理進度與權責單位皆為示意資料，用來展示系統運作方式。道路：" + esc(S.meta.sources.roads) + "。</p></div>";
    $("pin").innerHTML = html;
    $("pin").querySelectorAll(".pick, .brow").forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.id, true); }); });
    $("q").addEventListener("input", function () {
      var hits = searchLocs(this.value);
      $("qres").innerHTML = this.value.trim() ? (hits.length ? hits.map(function (L) {
        return '<li><button class="brow" data-id="' + L.id + '">' + careBadge(L, 24) + '<span class="nm">' + esc(L.name) + '</span><span class="mono v">' + esc(L.district) + "</span></button></li>";
      }).join("") : '<li class="note">找不到符合的路口。Demo 只有中壢火車站周邊 ' + S.locs.length + " 個路口。</li>") : "";
      $("qres").querySelectorAll(".brow").forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.id, true); }); });
    });
    $("pin").querySelectorAll(".btabs button").forEach(function (b) { b.addEventListener("click", function () { S.board = b.dataset.d; renderOverview(); }); });
    $("pin").querySelectorAll(".qcard").forEach(function (b) {
      b.addEventListener("click", function () {
        setLayer("compare");
        S.locs.filter(function (L) { return L.quadrant === b.dataset.quad; }).forEach(function (L) { pulse(L.id); });
      });
    });
    renderMarkers();
  }

  function searchLocs(q) {
    q = (q || "").trim().replace(/台/g, "臺");
    if (!q) return [];
    return S.locs.filter(function (L) { return L.name.replace(/台/g, "臺").indexOf(q) >= 0; })
      .sort(function (a, b) { return b.reports.concern - a.reports.concern; }).slice(0, 6);
  }

  /* Each district keeps its own ranking, so quieter districts are not drowned out. */
  var ROUTE_LABEL = { rank: "全區排行", district: "各區名額", fast: "快速通道", next: "下個月優先", none: "收集中" };
  function boardHTML() {
    var dists = Object.keys(S.meta.districts).sort(function (a, b) { return S.meta.districts[b] - S.meta.districts[a]; });
    var d = S.board && dists.indexOf(S.board) >= 0 ? S.board : dists[0];
    var rows = S.locs.filter(function (L) { return L.district === d && !L.improved; })
      .sort(function (a, b) { return b.reports.concern - a.reports.concern; }).slice(0, 5);
    return '<div class="sec"><div class="sec-h"><h3>各區關心排行（本月）</h3><span class="badge mock">示意</span></div>' +
      '<p class="note">每個行政區有自己的排行榜。全區前 ' + S.meta.rank_quota + " 名、各區前 " + S.meta.district_quota + " 名，加上快速通道，會送市府處理。</p>" +
      '<div class="tabs btabs" role="tablist">' + dists.map(function (x) {
        return '<button role="tab" data-d="' + x + '" aria-selected="' + (x === d) + '">' + x + "</button>";
      }).join("") + "</div>" +
      '<ol class="board">' + rows.map(function (L, i) {
        return '<li><button class="brow" data-id="' + L.id + '"><b class="mono">' + (i + 1) + '</b><span class="nm">' + esc(L.name) + '</span><span class="mono v">' + L.reports.concern + ' 人</span><span class="rt rt-' + L.route + '">' + ROUTE_LABEL[L.route] + "</span></button></li>";
      }).join("") + "</ol></div>";
  }

  /* ---------------- panel: location profile ---------------- */
  function select(id, fly) {
    S.sel = id;
    var L = S.byId[id];
    renderProfile(L);
    renderMarkers();
    if (fly) S.map.easeTo({ center: [L.lon, L.lat], zoom: Math.max(S.map.getZoom(), 15.6), duration: 600 });
    $("panel").classList.add("expanded");
    $("panel").scrollTop = 0;
  }
  function onMarker(id) {
    if (R.waitingForPick) { R.pickLocation(id); return; }
    select(id, false);
  }

  function crowdHTML(users, max) {
    var out = "", shown = 0, total = sum(USERS.map(function (u) { return users[u] || 0; }));
    var scale = total > max ? max / total : 1;
    USERS.forEach(function (u) {
      var n = Math.round((users[u] || 0) * scale);
      for (var i = 0; i < n && shown < max; i++, shown++) out += K.mini(K.userColor(u), 20);
    });
    return out;
  }

  /* Specific causes: what the AI would pull out of the text, voice and photos (mock), with the unit in charge. */
  function causesHTML(L, cats) {
    var rows = cats.filter(function (c) { return L.reports.causes && L.reports.causes[c]; }).map(function (c) {
      var cz = L.reports.causes[c];
      return '<div class="cause"><b>' + esc(c) + "</b><ul>" + Object.keys(cz).slice(0, 3).map(function (k) {
        return "<li><span>" + esc(k) + '</span><span class="mono">' + cz[k] + ' 人</span><span class="owner sm">' + esc(ownerOf(c, k)) + "</span></li>";
      }).join("") + "</ul></div>";
    }).join("");
    return rows ? '<div class="causes"><p class="b-label">具體原因（AI 整理）<span class="badge mock">示意</span></p>' + rows + "</div>" : "";
  }
  function ownerOf(cat, cause) { return (S.meta.cause_owner[cat] || {})[cause] || "待確認"; }

  function timelineHTML(L) {
    var cmp = compareStages(L), out = "";
    if (cmp) {
      out += '<p class="cmp ' + (cmp.better ? "good" : "same") + '">改善前每月約 <b>' + cmp.before + "</b> 人回報 → 改善後每月約 <b>" + cmp.after + "</b> 人" +
        (cmp.better ? "：明顯減少" : "：沒有明顯減少，建議再次現勘") + "</p>";
    }
    out += '<ol class="tl">' + L.timeline.map(function (t) {
      if (t.type === "update") {
        return '<li class="tl-upd"><span class="tl-dot"></span><div><b>市府更新　' + esc(t.date.replace(/-/g, "/")) + "</b><p>" + esc(t.text) + '</p><small>' + esc(t.unit) + "</small></div></li>";
      }
      var cur = t.current, n = cur ? L.reports.concern : t.concern, pr = cur ? L.reports.praise : t.praise;
      var period = t.start.replace("-", "/") + "–" + (t.end ? t.end.replace("-", "/") : "現在") + "（" + t.months + " 個月）";
      return '<li class="tl-stage' + (cur ? " cur" : "") + '"><span class="tl-dot"></span><div><b>第 ' + t.n + " 階段" + (cur ? "（目前）" : "") + '</b><small>' + period + "</small>" +
        "<p>" + n + " 人回報要注意" + (pr ? "、" + pr + " 人說變好了" : "") + "，每月約 " + perMonth(n, t.months) + " 人</p>" +
        '<p class="tl-sum">' + esc(cur ? summaryOf(L) : t.summary) + "</p></div></li>";
    }).join("") + "</ol>";
    if (!hasUpdate(L)) out += '<p class="note">市府還沒有更新這個路口。市府完成改善並發布更新後，會開始新的階段，也才開放「這裡變好了」。</p>';
    return out;
  }

  function renderProfile(L) {
    var r = L.reports, q = QUAD[L.quadrant], stageIdx = STAGES.indexOf(L.stage);
    var cats = Object.keys(r.categories).filter(function (c) { return r.categories[c] > 0; }).sort(function (a, b) { return r.categories[b] - r.categories[a]; }).slice(0, 5);
    var catMax = cats.length ? r.categories[cats[0]] : 1;
    var sevTotal = sum(SEVERITY.map(function (s) { return r.severity[s] || 0; })) || 1;
    var concernC = L.comments.filter(function (c) { return c.tone === "concern"; });
    var praiseC = L.comments.filter(function (c) { return c.tone === "praise"; });
    var accSum = sum(L.real.acc_by_year);
    var html =
      '<button class="back" id="back">← 回到全部路口</button>' +
      '<div class="titlerow"><div class="wx">' + careBadge(L, 52) + '</div><div><p class="eyebrow">路口小檔案</p><h1 class="ptitle">' + esc(L.name) + '</h1></div></div>' +
      '<div class="tagsrow"><span class="qtag" style="--qc:var(' + q.v + ');background:var(' + q.v + ')">' + q.name + '</span><span class="stagetag">處理進度：' + L.stage + "</span></div>" +
      '<p class="wxline">' + careText(L) + "・" + esc(L.district) + "</p>" +

      '<div class="sec"><div class="sec-h"><h3>有多少人也遇過</h3><span class="badge mock">示意</span></div>' +
      '<div class="big"><b class="mono">' + r.concern + '</b><span>人回報這裡要注意' + (r.praise ? "・" + r.praise + " 人說變好了" : "") + "</span></div>" +
      '<div class="crowd" aria-hidden="true">' + crowdHTML(r.users, 40) + "</div>" +
      '<div class="ulegend">' + USERS.map(function (u) { return '<span><i style="background:' + K.userColor(u) + '"></i>' + u + " " + (r.users[u] || 0) + "</span>"; }).join("") + "</div>" +
      '<div class="actions"><button class="btn primary" id="metoo">我也遇過</button><button class="btn" id="better"' + (hasUpdate(L) ? "" : ' disabled title="市府更新後才開放"') + '>這裡變好了</button></div>' +
      (hasUpdate(L) ? "" : '<p class="note">市府更新後才能說「這裡變好了」。</p>') + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>AI 摘要</h3><span class="badge mock">示意</span></div><p class="summary">' + esc(summaryOf(L)) + "</p></div>" +

      '<div class="sec"><div class="sec-h"><h3>什麼時候、遇到什麼</h3><span class="badge mock">示意</span></div>' +
      '<div class="twocol"><div>' + K.ring24(r.hours, 128) + '</div><div class="bars">' +
      cats.map(function (c) {
        return '<div class="bar"><div class="lbl"><span>' + c + '</span><div class="track"><div class="fill" style="width:' + Math.round(r.categories[c] / catMax * 100) + '%"></div></div></div><span class="v">' + r.categories[c] + "</span></div>";
      }).join("") + "</div></div>" +
      causesHTML(L, cats.slice(0, 3)) +
      '<div class="sevbar" aria-hidden="true">' + SEVERITY.map(function (s, i) {
        return '<span style="width:' + ((r.severity[s] || 0) / sevTotal * 100).toFixed(1) + "%;background:" + ["var(--line)", "var(--cloudy)", "var(--storm)"][i] + '"></span>';
      }).join("") + "</div>" +
      '<div class="sevlegend">' + SEVERITY.map(function (s, i) {
        return '<span><i style="display:inline-block;width:9px;height:9px;margin-right:4px;background:' + ["var(--line)", "var(--cloudy)", "var(--storm)"][i] + '"></i>' + s + " " + (r.severity[s] || 0) + "</span>";
      }).join("") + "</div></div>" +

      '<div class="sec"><div class="sec-h"><h3>真實事故紀錄</h3><span class="badge real">真實資料</span></div>' +
      K.accBars(L.real.years, L.real.acc_by_year, S.meta.recent) +
      '<p class="accnote">' + L.real.years[0] + "–" + L.real.years[L.real.years.length - 1] + " 年共 <b>" + accSum + "</b> 件，近三年 <b>" + L.real.acc_recent + "</b> 件" +
      (L.real.a1_total ? "，其中死亡事故 <b>" + L.real.a1_total + "</b> 件" : "") + "。" +
      (L.real.level === "high" ? "近三年事故數在本區前 20%。" : "近三年事故數不在本區前 20%。") + "</p>" +
      '<p class="note">路口 35 公尺內的 A1、A2 事故。來源：桃園市政府開放資料。</p></div>' +

      '<div class="sec"><div class="sec-h"><h3>兩邊對照</h3></div><p class="accnote"><b style="color:var(' + q.v + ')">' + q.name + "</b>：" + q.desc + "</p></div>" +

      '<div class="sec"><div class="sec-h"><h3>時間線</h3><span class="badge mock">示意</span></div>' + timelineHTML(L) + "</div>" +
      '<div class="sec"><div class="sec-h"><h3>處理進度</h3><span class="badge mock">示意</span></div><ol class="steps">' +
      STAGES.map(function (s, i) { return '<li class="' + (i < stageIdx ? "is-done" : i === stageIdx ? "is-now" : "") + '"><i></i>' + s + "</li>"; }).join("") + "</ol>" +
      "</div>" +
      '<div class="sec"><div class="sec-h"><h3>怎麼送到市府</h3><span class="badge mock">示意</span></div><ul class="routes">' +
      ["rank", "district", "fast"].map(function (k) {
        return '<li class="' + (L.route === k ? "on" : "") + '"><b>' + (ROUTE[k].tag ? '<i class="rtb static">' + ROUTE[k].tag + "</i>" : "") + ROUTE[k].name + "</b><span>" + ROUTE[k].desc() + "</span></li>";
      }).join("") + "</ul>" +
      '<p class="accnote">' + esc(L.route_reason || "回報還在累積，這個月還沒進入名單。") + "</p>" +
      (L.district_rank ? '<p class="note">' + esc(L.district) + "本月關心排行第 " + L.district_rank + " 名</p>" : "") + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>誰管這裡</h3><span class="badge mock">示意</span></div><div class="owners">' +
      L.owners.map(function (o) { return '<span class="owner">' + esc(o) + "</span>"; }).join("") + "</div>" +
      (L.owners.length >= 3 ? '<p class="flag">牽涉 3 個以上單位，建議會勘</p>' : "") + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>市民怎麼說</h3><span class="badge mock">示意</span></div>' +
      '<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-t="concern">要注意 ' + concernC.length + '</button><button role="tab" aria-selected="false" data-t="praise">變好了 ' + praiseC.length + "</button></div>" +
      '<ul class="voices" id="voices"></ul></div>' +

      "";
    $("pin").innerHTML = html;
    var showVoices = function (tone) {
      var list = tone === "praise" ? praiseC : concernC;
      $("voices").innerHTML = list.length ? list.map(function (c) {
        return '<li class="voice">' + K.avatar(c.user, K.userColor(c.user), 30) + "<div><p>" + esc(c.text) + "</p><small>" + c.user + (c.category ? "・" + c.category : "") + "</small></div></li>";
      }).join("") : '<li class="note">還沒有人這樣說。</li>';
      $("pin").querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.t === tone); });
    };
    showVoices("concern");
    $("pin").querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { showVoices(b.dataset.t); }); });
    $("back").addEventListener("click", function () { renderOverview(); });
    $("metoo").addEventListener("click", function () { R.open({ loc: L.id, mode: "concern", quick: true }); });
    $("better").addEventListener("click", function () { R.open({ loc: L.id, mode: "praise" }); });
  }

  /* ---------------- report flow (simulated chat) ---------------- */
  var R = {
    waitingForPick: false, ctx: null,
    open: function (opts) {
      R.ctx = { loc: opts.loc || null, mode: opts.mode || null, quick: !!opts.quick, cat: null, time: null, freq: null, sev: null, praise: null };
      $("phone").hidden = false;
      $("chat").innerHTML = "";
      R.bot("嗨！這是「差一點地圖」的回報小幫手（示意）。");
      R.bot('這裡用來回報「差點出事、讓人害怕」的路口。<br><b>緊急狀況</b>（大坑洞、號誌全滅、路樹倒塌）請直接打 <b>1999</b>；有人受傷請打 <b>110／119</b>。');
      if (!S.me) R.stepAvatar(); else R.afterAvatar();
    },
    close: function () { $("phone").hidden = true; R.waitingForPick = false; $("phone").classList.remove("peek"); },
    scroll: function () { var c = $("chat"); c.scrollTop = c.scrollHeight; },
    bot: function (html) { var d = document.createElement("div"); d.className = "msg bot"; d.innerHTML = html; $("chat").appendChild(d); R.scroll(); return d; },
    me: function (text) { var d = document.createElement("div"); d.className = "msg me"; d.textContent = text; $("chat").appendChild(d); R.scroll(); },
    opts: function (list, onPick) {
      var w = document.createElement("div"); w.className = "opts";
      list.forEach(function (t) {
        var b = document.createElement("button"); b.className = "opt"; b.type = "button"; b.textContent = t;
        b.addEventListener("click", function () { w.remove(); R.me(t); onPick(t); });
        w.appendChild(b);
      });
      $("chat").appendChild(w); R.scroll();
      return w;
    },
    stepAvatar: function () {
      R.bot("先選一個代表你的小角色：你平常怎麼移動？");
      var st = { user: "機車", color: COLORS[0] };
      var box = document.createElement("div"); box.className = "avatarpick";
      var preview = document.createElement("div");
      var draw = function () { preview.innerHTML = K.avatar(st.user, st.color, 56); };
      draw();
      box.appendChild(preview);
      var right = document.createElement("div"); right.style.display = "flex"; right.style.flexDirection = "column"; right.style.gap = "8px";
      var us = document.createElement("div"); us.className = "opts";
      USERS.forEach(function (u) {
        var b = document.createElement("button"); b.className = "opt"; b.type = "button"; b.textContent = u; b.setAttribute("aria-pressed", u === st.user);
        b.addEventListener("click", function () { st.user = u; us.querySelectorAll(".opt").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); });
        us.appendChild(b);
      });
      var sw = document.createElement("div"); sw.className = "swatches";
      COLORS.forEach(function (c, i) {
        var b = document.createElement("button"); b.className = "swatch"; b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "顏色 " + (i + 1)); b.setAttribute("aria-pressed", c === st.color);
        b.addEventListener("click", function () { st.color = c; sw.querySelectorAll(".swatch").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); });
        sw.appendChild(b);
      });
      right.appendChild(us); right.appendChild(sw);
      box.appendChild(right);
      $("chat").appendChild(box);
      var ok = document.createElement("div"); ok.className = "opts";
      var go = document.createElement("button"); go.className = "opt"; go.type = "button"; go.textContent = "就是我"; go.setAttribute("aria-pressed", "true");
      go.addEventListener("click", function () {
        S.me = st; box.remove(); ok.remove();
        var d = document.createElement("div"); d.className = "msg me ava"; d.innerHTML = K.avatar(st.user, st.color, 44); $("chat").appendChild(d);
        R.afterAvatar();
      });
      ok.appendChild(go); $("chat").appendChild(ok); R.scroll();
    },
    afterAvatar: function () {
      if (!R.ctx.mode) {
        R.bot("你想說的是？");
        R.opts(["這裡要注意", "這裡變好了"], function (t) { R.ctx.mode = t === "這裡變好了" ? "praise" : "concern"; R.stepWhere(); });
      } else R.stepWhere();
    },
    stepWhere: function () {
      if (R.ctx.loc) { R.announce(); return; }
      R.bot("在地圖上點一下那個路口，或搜尋路名。");
      var box = document.createElement("div"); box.className = "rsearch";
      box.innerHTML = '<input id="rsearch" type="search" autocomplete="off" placeholder="搜尋路名，例如：中豐路" aria-label="搜尋路口">';
      var list = document.createElement("div"); list.className = "opts";
      var choose = function (L) { R.waitingForPick = false; box.remove(); list.remove(); R._pickWidget = null; R.ctx.loc = L.id; R.announce(); };
      var draw = function (q) {
        var hits = q.trim() ? searchLocs(q) : S.locs.slice().sort(function (a, b) { return (b.reports.concern + b.reports.praise) - (a.reports.concern + a.reports.praise); }).slice(0, 4);
        list.innerHTML = "";
        hits.forEach(function (L) {
          var b = document.createElement("button"); b.className = "opt"; b.type = "button"; b.textContent = L.name;
          b.addEventListener("click", function () { choose(L); });
          list.appendChild(b);
        });
        var m = document.createElement("button"); m.className = "opt"; m.type = "button"; m.textContent = "我去地圖上點";
        m.addEventListener("click", function () { $("phone").classList.add("peek"); R.bot("好，點地圖上任何一個路口。"); });
        list.appendChild(m);
        if (q.trim() && !hits.length) { var e = document.createElement("span"); e.className = "note"; e.textContent = "找不到符合的路口"; list.insertBefore(e, m); }
      };
      box.querySelector("input").addEventListener("input", function () { draw(this.value); });
      draw("");
      $("chat").appendChild(box); $("chat").appendChild(list); R.scroll();
      R.waitingForPick = true;
      R._pickWidget = { remove: function () { box.remove(); list.remove(); } };
    },
    pickLocation: function (id) {
      R.waitingForPick = false; $("phone").classList.remove("peek");
      if (R._pickWidget) { R._pickWidget.remove(); R._pickWidget = null; }
      R.ctx.loc = id; R.me(S.byId[id].name); R.announce(true);
    },
    announce: function (fromPick) {
      R.waitingForPick = false;
      var L = S.byId[R.ctx.loc];
      if (!fromPick) R.me(L.name);
      pulse(L.id);
      var n = R.ctx.mode === "praise" ? L.reports.praise : L.reports.concern;
      var crowd = '<div class="crowd" style="margin-top:6px">' + crowdHTML(L.reports.users, 24) + "</div>";
      if (R.ctx.mode === "praise" && !hasUpdate(L)) {
        R.bot("這個路口市府還沒有發布改善更新，等改善完成後才能說「這裡變好了」。要改成回報這裡要注意嗎？");
        R.opts(["改成回報要注意", "關閉"], function (t) { if (t === "關閉") R.close(); else { R.ctx.mode = "concern"; R.announce(true); } });
        return;
      }
      if (R.ctx.mode === "praise") {
        R.bot(n ? "已經有 <b>" + n + "</b> 人說這裡變好了。" + crowd : "你是第一個說這裡變好了的人！");
        R.bot("哪裡變好了？");
        R.opts(PRAISE_OPTS, function (t) { R.ctx.praise = t; R.finish(); });
        return;
      }
      R.bot(n ? "這裡已經有 <b>" + n + "</b> 人說過要注意，你不是一個人。" + crowd : "你是第一個回報這裡的人。");
      var top = Object.keys(L.reports.categories).sort(function (a, b) { return L.reports.categories[b] - L.reports.categories[a]; })[0];
      if (R.ctx.quick && top) {
        R.bot("你遇到的也是「" + top + "」嗎？");
        R.opts(["對，就是這個", "是別的狀況"], function (t) {
          if (t === "對，就是這個") { R.ctx.cat = top; R.stepTime(); } else R.stepCat();
        });
      } else R.stepCat();
    },
    stepCat: function () { R.bot("遇到什麼狀況？"); R.opts(CATS, function (t) { R.ctx.cat = t; R.stepTime(); }); },
    stepTime: function () { R.bot("大概什麼時候？"); R.opts(TIMES.map(function (t) { return t[0]; }), function (t) { R.ctx.time = t; R.stepFreq(); }); },
    stepFreq: function () { R.bot("多常遇到？"); R.opts(["每天", "常常", "遇過一次"], function (t) { R.ctx.freq = t; R.stepSev(); }); },
    stepSev: function () { R.bot("有多危險？"); R.opts(SEVERITY, function (t) { R.ctx.sev = t; R.stepText(); }); },
    stepText: function () {
      R.bot("想多說一點嗎？請描述路口的狀況，<b>不要寫出個人姓名、店名或車牌</b>。可以打字，正式版也可以直接錄語音（可說台語）。");
      var w = document.createElement("div"); w.style.alignSelf = "stretch"; w.style.display = "flex"; w.style.flexDirection = "column"; w.style.gap = "6px";
      w.innerHTML = '<label class="note" for="rtext">補充說明（選填）</label><textarea id="rtext" maxlength="200" placeholder="例如：右轉時看不到斑馬線上的人"></textarea>';
      var o = document.createElement("div"); o.className = "opts";
      ["送出", "略過，直接送出"].forEach(function (t) {
        var b = document.createElement("button"); b.className = "opt"; b.type = "button"; b.textContent = t;
        b.addEventListener("click", function () {
          var v = $("rtext").value.trim();
          if (/[A-Z]{2,3}-?\d{3,4}|\d{3,4}-?[A-Z]{2,3}/i.test(v)) { R.bot("看起來有車牌號碼，請刪掉後再送出。我們回報的是路口，不是某個人。"); return; }
          w.remove(); o.remove();
          if (v) R.me(v);
          R.ctx.text = v; R.finish();
        });
        o.appendChild(b);
      });
      $("chat").appendChild(w); $("chat").appendChild(o); R.scroll();
    },
    finish: function () {
      var L = S.byId[R.ctx.loc], r = L.reports, u = S.me.user;
      var before = r.users[u] || 0;
      if (R.ctx.mode === "praise") {
        r.praise += 1;
        L.comments.unshift({ tone: "praise", text: R.ctx.praise === "其他" ? "這裡變好了。" : R.ctx.praise + "了。", user: u, mine: true });
      } else {
        r.concern += 1;
        r.categories[R.ctx.cat] = (r.categories[R.ctx.cat] || 0) + 1;
        var hr = (TIMES.filter(function (t) { return t[0] === R.ctx.time; })[0] || TIMES[1])[1];
        r.hours[hr] += 1;
        r.severity[R.ctx.sev] = (r.severity[R.ctx.sev] || 0) + 1;
        if (R.ctx.text) L.comments.unshift({ tone: "concern", category: R.ctx.cat, text: R.ctx.text, user: u, mine: true });
      }
      r.users[u] = before + 1;
      refresh(L);
      var rank = R.ctx.mode === "praise" ? r.praise : r.concern;
      var d = document.createElement("div"); d.className = "done";
      d.innerHTML = '<div class="rank">你是第<b>' + rank + "</b>位" + (R.ctx.mode === "praise" ? "說這裡變好了的人" : "回報這裡的人") + "</div>" +
        '<div class="stage"><div class="crowdline">' + crowdHTML(r.users, 14) + '</div><div class="me">' + K.avatar(S.me.user, S.me.color, 44) + '</div><div class="road"></div></div>' +
        '<p class="mine">' + esc(R.ctx.mode === "praise" ? "你說：" + R.ctx.praise : "你回報：" + R.ctx.cat + "・" + R.ctx.time + "・" + (R.ctx.freq || "") + "・" + R.ctx.sev) + "</p>" +
        '<p class="note">' + (R.ctx.mode === "praise" ? "謝謝你！我們會把這句感謝轉給負責改善的單位。" : "我們每月會把這裡整理給市府。處理有進展時，會在這裡通知你。") + "</p>" +
        '<p class="note">（示意：這筆回報只存在你這次瀏覽，不會送出）</p>';
      $("chat").appendChild(d);
      var me = d.querySelector(".stage .me"), line = d.querySelector(".crowdline");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var stageW = d.querySelector(".stage").clientWidth, lw = line.getBoundingClientRect().width;
          me.style.left = Math.min(stageW - 40, stageW / 2 + lw / 2 + 4) + "px";
        });
      });
      R.opts(["看這個路口", "再回報一個", "關閉"], function (t) {
        if (t === "看這個路口") { R.close(); select(L.id, true); }
        else if (t === "再回報一個") { var m = R.ctx.mode; R.open({ mode: m }); }
        else R.close();
      });
      renderMarkers();
      pulse(L.id);
      if (S.sel === L.id) renderProfile(L);
      else if (!S.sel) renderOverview();
      R.scroll();
    }
  };

  /* Deep links for demos and screenshots: #accidents #compare #profile-L19 #report */
  function applyHash() {
    var h = (location.hash || "").slice(1);
    if (h === "accidents" || h === "compare") setLayer(h);
    var m = /^profile-(L\d+)$/.exec(h);
    if (m && S.byId[m[1]]) select(m[1], true);
    if (h === "report") {
      var L = S.locs.filter(function (x) { return x.quadrant === "prevent"; }).sort(function (a, b) { return b.reports.concern - a.reports.concern; })[0];
      select(L.id, false);
      S.me = { user: "機車", color: COLORS[0] };
      R.open({ loc: L.id, mode: "concern" });
      var pick = function (t) {
        var b = [].slice.call(document.querySelectorAll("#chat .opt")).filter(function (x) { return x.textContent === t; }).pop();
        if (b) b.click();
      };
      var top = Object.keys(L.reports.categories).sort(function (a, b) { return L.reports.categories[b] - L.reports.categories[a]; })[0];
      pick(top); pick("下班尖峰"); pick("差點發生事故");
      var ta = $("rtext");
      if (ta) ta.value = "右轉時轉角被擋住，看不到斑馬線上的人。";
      pick("送出");
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    $("brand").insertAdjacentHTML("afterbegin", K.brand());
    document.querySelectorAll("#layers button").forEach(function (b) { b.addEventListener("click", function () { setLayer(b.dataset.layer); }); });
    $("report").addEventListener("click", function () { R.open({}); });
    $("phone-x").addEventListener("click", R.close);
    $("handle").addEventListener("click", function () { $("panel").classList.toggle("expanded"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("phone").hidden) R.close(); });
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", recolorMap);
    new MutationObserver(recolorMap).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    Promise.all(["data/roads.geojson", "data/locations.json", "data/meta.json"].map(function (u) {
      return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
    })).then(function (res) {
      S.roads = res[0]; S.locs = res[1]; S.meta = res[2];
      S.locs.forEach(function (L) { S.byId[L.id] = L; });
      renderOverview();
      if (!window.maplibregl) throw new Error("地圖元件沒有載入");
      initMap();
    }).catch(function (err) {
      $("map").innerHTML = '<p class="note" style="padding:24px">地圖載入失敗：' + esc(err.message) + "。請用本機伺服器開啟（見 README）。</p>";
      document.body.dataset.mapReady = "error";
    });
  }
  window.DemoApp = { state: S, select: select, setLayer: setLayer, report: R, mapStyle: mapStyle };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
