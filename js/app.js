/* 桃過一劫 demo — map, layers, location profile and the report flow. */
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
    priority: { name: "危險", short: "危險", v: "--q-priority", desc: "事故多：事故資料已經看得到，市府用熱點方法在處理。" },
    prevent: { name: "潛在危險", short: "潛在", v: "--q-prevent", desc: "事故還不多，但很多人覺得危險：市府看不到的盲點，要提早預防。這是本提案最想找出來的地方。" },
    calm: { name: "相對安全", short: "安全", v: "--q-calm", desc: "事故少，覺得危險的人也少：目前沒有訊號，繼續收集回報。" }
  };
  var CARE_TEXT = { many: "很多人關心這裡", some: "有人關心這裡", few: "回報還少：資訊不足，不代表安全" };
  var ROUTE = {
    district: { name: "各區排行", tag: "", desc: function () { return "每個行政區自己的前 " + S.meta.district_quota + " 名，每區名額一樣"; } },
    fast: { name: "急件", tag: "急", desc: function () { return "回報人數還少，但有急迫訊號：最近突然變多、有人曾經擦撞並附照片，或里長、學校代表回報（每區每月最多 1 件）"; } }
  };
  function careText(L) { return L.improved ? "多數人說這裡變好了" : CARE_TEXT[L.care]; }
  function careBadge(L, size) {
    return '<span class="cb care-' + L.care + (L.improved ? " improved" : "") + '" style="width:' + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.36) + 'px">' +
      (L.improved ? "✓" : L.reports.concern) + "</span>";
  }

  var S = { roads: null, locs: [], meta: null, byId: {}, board: null, view: "citizen", layer: "reports", sel: null, me: null, map: null, markers: {}, labels: [] };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* 我的回報：LINE 裡記在這支手機（同一個 LINE 帳號每個路口只計一次）；一般瀏覽器只記在這次瀏覽 */
  var HKEY = "taoguo:history:";
  function histStore() { var TL = window.TaoguoLINE; try { return TL && TL.user ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
  function histId() { var TL = window.TaoguoLINE; return TL && TL.user ? TL.user.id : "guest"; }
  function myHistory() { try { var st = histStore(); return st ? JSON.parse(st.getItem(HKEY + histId()) || "[]") : []; } catch (e) { return []; } }
  function saveHistory(list) { try { var st = histStore(); if (st) st.setItem(HKEY + histId(), JSON.stringify(list)); } catch (e) {} }
  function myReport(id, mode) { return myHistory().filter(function (h) { return h.loc === id && (!mode || h.mode === mode); })[0]; }
  function mmdd(iso) { var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function myLine(h) { return h.mode === "praise" ? "說這裡變好了（" + h.praise + "）" : h.cat + "・" + h.sev; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function fmt(n) { return Number(n).toLocaleString("zh-TW"); }

  /* ---------------- derived values (same rules as data-prep/prepare.py) ---------------- */
  function careOf(L) {
    var c = L.reports.concern;
    return c >= S.meta.report_high_threshold ? "many" : c >= S.meta.report_some_threshold ? "some" : "few";
  }
  function quadOf(L) {
    var hiA = L.real.acc_recent >= S.meta.acc_high_threshold, hiR = L.reports.concern >= S.meta.report_high_threshold;
    return hiA ? "priority" : (hiR ? "prevent" : "calm");
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
  function hasUpdate(L) { return L.timeline.some(function (t) { return t.type === "update"; }); }  // a major fix: opens a new stage
  function canPraise(L) { return hasUpdate(L) || (L.repairs || []).length > 0; }  // any logged repair opens "這裡變好了"
  /* What the city has done with a case, for citizens: the monthly quota only sends it; every later step is the city's. */
  function progressLabel(L) {
    if (L.route === "next") return "下個月優先";
    if (L.route !== "district" && L.route !== "fast") return "收集中";
    if (["現勘中", "已排程", "改善中"].indexOf(L.stage) >= 0)
      return L.stage + (L.stage === "已排程" && L.schedule ? "（" + (+L.schedule.slice(5)) + " 月）" : "");
    if (L.dispatched) return "已派案：" + L.dispatched.lead;
    return "已送市府・待派案";
  }
  function perMonth(n, months) { return Math.round(n / Math.max(months, 1) * 10) / 10; }
  /* Before/after: compare the last finished stage with the current one, per month (stages differ in length). */
  function compareStages(L) {
    var stages = L.timeline.filter(function (t) { return t.type === "stage"; });
    if (stages.length < 2) return null;
    var prev = stages[stages.length - 2], cur = stages[stages.length - 1];
    var a = perMonth(prev.concern, prev.months), b = perMonth(L.reports.concern, cur.months);
    return { before: a, after: b, better: b <= a * 0.5 };
  }
  /* "Recently rising" (mock): same rule as data-prep/prepare.py rising_of. A place can turn dangerous
     (new shop or school, road works, a new box blocking the view), so a jump matters even when the total is small. */
  function risingOf(L) {
    var R0 = S.meta.rising, c = L.trend.counts, w = R0.window;
    if (c.length < w + R0.before_min) return false;
    var recent = sum(c.slice(-w)), before = c.slice(0, -w);
    return recent >= R0.min && recent / w >= R0.ratio * (sum(before) / before.length);
  }
  function trendNumbers(L) {
    var c = L.trend.counts, w = S.meta.rising.window, before = c.slice(0, -w);
    return { recent: perMonth(sum(c.slice(-w)), w), before: perMonth(sum(before), before.length) };
  }
  function ymAdd(ym, k) {
    var y = +ym.slice(0, 4), m = +ym.slice(5) - 1 + k;
    return (y + Math.floor(m / 12)) + "/" + String(m % 12 + 1).padStart(2, "0");
  }
  var STAGE_ICON = { "現勘中": "🔍", "已排程": "🚧", "改善中": "🚧" };
  function deadTag(L) { var n = L.real.a1_recent; return n ? '<i class="a1b" title="近三年死亡事故 ' + n + ' 件">亡 ' + n + "</i>" : ""; }
  var RISE_TAG = '<i class="rsb" aria-hidden="true">↑</i>';
  /* Monthly reports in the current stage; the last months are highlighted. */
  function trendHTML(L) {
    var c = L.trend.counts, w = S.meta.rising.window, max = Math.max.apply(null, c.concat([1])), n = trendNumbers(L);
    var bars = c.map(function (v, i) {
      return '<span class="tb' + (i >= c.length - w ? " recent" : "") + '" style="height:' + Math.max(2, Math.round(v / max * 44)) + 'px" title="' + ymAdd(L.trend.start, i) + "：" + v + ' 人"></span>';
    }).join("");
    return '<div class="trend" role="img" aria-label="每月回報人數，最近 ' + w + ' 個月每月約 ' + n.recent + ' 人，之前每月約 ' + n.before + ' 人">' + bars + "</div>" +
      '<div class="trend-ax"><span>' + ymAdd(L.trend.start, 0) + "</span><span>最近 " + w + " 個月</span></div>" +
      (L.trend.rising
        ? '<p class="cmp rise">' + RISE_TAG + "最近 " + w + " 個月每月約 <b>" + n.recent + "</b> 人回報，之前每月約 <b>" + n.before + "</b> 人：<b>最近變多</b>。回報總數還不多，排行不一定排得到，但這裡可能正在變危險（例如附近新開店家、施工改道、新設施擋住視線）。這種路口會列為<b>急件</b>直接送市府（每區每月最多 1 件）。</p>"
        : '<p class="note">最近 ' + w + " 個月每月約 " + n.recent + " 人，之前每月約 " + n.before + " 人。最近 " + w + " 個月的平均達到之前的 " + S.meta.rising.ratio + " 倍、且至少 " + S.meta.rising.min + " 人，就會標示「最近變多」。</p>");
  }
  function refresh(L) {
    L.trend.rising = risingOf(L);
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
      autoReport();
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
      padding: narrow ? { top: 110, bottom: window.innerHeight * 0.44 + 30, left: 30, right: 30 } : { top: 110, bottom: 90, left: 40, right: $("scatcard") && !$("scatcard").classList.contains("closed") ? 320 : 70 },
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
      el.dataset.id = L.id;
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
        size = Math.round((16 + Math.sqrt(a) * 4.6) * zf);
        cls = "mk acc" + (L.real.level === "high" ? "" : " low");
        html = String(a) + deadTag(L);
        label = L.name + "，近三年事故 " + a + " 件" + (L.real.a1_recent ? "，其中死亡事故 " + L.real.a1_recent + " 件" : "") + "（真實資料）";
      } else if (S.layer === "compare") {
        var q = QUAD[L.quadrant];
        size = 26;
        cls = "mk quad";
        html = q.short + deadTag(L);
        el.style.background = "var(" + q.v + ")";
        el.style.borderColor = "var(--surface)";
        label = L.name + "：" + q.name;
      } else {
        var v = L.reports.concern;
        size = Math.round((24 + Math.sqrt(v) * 5.5) * zf);
        cls = "mk care-" + L.care + (L.improved ? " improved" : "");
        html = '<span class="n">' + (L.improved ? "✓" : v) + "</span>" +
          (ROUTE[L.route] && ROUTE[L.route].tag ? '<i class="rtb">' + ROUTE[L.route].tag + "</i>" : "") +
          (L.trend.rising ? RISE_TAG : "") +
          (myReport(L.id) ? '<i class="mineb" title="你回報過">我</i>' : "") +
          (STAGE_ICON[L.stage] && !L.improved ? '<i class="stb" title="' + L.stage + '">' + STAGE_ICON[L.stage] + "</i>" : "") + deadTag(L);
        label = L.name + "，回報 " + v + " 人（示意資料），" + careText(L) + (L.trend.rising ? "，最近變多" : "") + (L.real.a1_recent ? "，近三年死亡事故 " + L.real.a1_recent + " 件" : "");
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
    renderScatterCard();
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
        '<div class="row"><span class="li"><i style="width:12px;height:12px;border-radius:50%;background:var(--ink);display:inline-block"></i>本區前 20%（≥ ' + S.meta.acc_high_threshold + ' 件）</span><span class="li"><i style="width:12px;height:12px;border-radius:50%;border:2px solid var(--ink);display:inline-block"></i>其他</span><span class="li"><i class="a1b static">亡 1</i>近三年死亡事故件數（A1）</span></div>';
    } else if (S.layer === "compare") {
      h = '<div class="row">' + Object.keys(QUAD).map(function (k) {
        return '<span class="li"><i style="width:12px;height:12px;background:var(' + QUAD[k].v + ');display:inline-block;border-radius:2px"></i>' + QUAD[k].name + "</span>";
      }).join("") + '<span class="li"><i class="a1b static">亡 1</i>死亡事故件數</span></div><div class="row">事故（真實）× 回報（示意）</div>';
    } else {
      var sw = function (c, t, txt) { return '<span class="li"><span class="cb care-' + c + '" style="width:18px;height:18px;font-size:10px">' + t + "</span>" + txt + "</span>"; };
      h = '<div class="row">' + sw("many", "", "很多人關心") + sw("some", "", "有人關心") + sw("few", "", "回報還少") + sw("few improved", "✓", "變好了") + "</div>" +
        '<div class="row"><span class="li"><i class="rtb static">急</i>急件</span><span class="li"><i class="rsb static">↑</i>最近變多</span><span class="li"><i class="mineb static">我</i>我回報過</span><span class="li">🔍 現勘中</span><span class="li">🚧 施工中</span><span class="li"><i class="a1b static">亡 1</i>死亡事故（真實）</span><span class="li"><span class="badge mock">示意資料</span></span>數字＝回報人數</div>';
    }
    $("legend").innerHTML = h;
  }

  /* ---------------- scatter: accidents vs reports ----------------
     Both axes are ranks inside the demo area (0 = fewest, 100 = most), so the two can be compared:
     if residents and accident data agree, a point sits on the diagonal. */
  function prOf(v, arr) {
    var lo = arr.filter(function (x) { return x < v; }).length, eq = arr.filter(function (x) { return x === v; }).length;
    return Math.round((lo + (eq - 1) / 2) / Math.max(arr.length - 1, 1) * 100);
  }
  function ranks() {
    var acc = S.locs.map(function (L) { return L.real.acc_recent; }), rep = S.locs.map(function (L) { return L.reports.concern; });
    var out = {};
    S.locs.forEach(function (L) { out[L.id] = { x: prOf(L.real.acc_recent, acc), y: prOf(L.reports.concern, rep) }; });
    return out;
  }
  var GAP = 30;  // more than 30 rank points off the diagonal counts as "the two disagree"
  function scatterSVG(selId) {
    var R0 = ranks(), W = 320, H = 268, l = 34, t = 12, w = W - l - 12, h = H - t - 40;
    var X = function (v) { return l + (4 + v * 0.92) / 100 * w; }, Y = function (v) { return t + h - (4 + v * 0.92) / 100 * h; };
    var diag = function (d) {  // the line y = x + d, clipped to the box
      var x0 = Math.max(0, -d), x1 = Math.min(100, 100 - d);
      return "M" + X(x0) + " " + Y(x0 + d) + "L" + X(x1) + " " + Y(x1 + d);
    };
    var dots = S.locs.slice().sort(function (a, b) { return (a.id === selId) - (b.id === selId); }).map(function (L) {
      var p = R0[L.id], on = L.id === selId, dead = L.real.a1_recent > 0;
      return '<g class="sdot' + (on ? " on" : "") + '" data-id="' + L.id + '" tabindex="0" role="button" aria-label="' + esc(L.name) + "：事故排名 " + p.x + "、回報排名 " + p.y + '">' +
        "<title>" + esc(L.name) + "｜事故 " + L.real.acc_recent + " 件" + (dead ? "（死亡 " + L.real.a1_recent + " 件）" : "") + "・回報 " + L.reports.concern + " 人</title>" +
        (on ? '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="12" fill="none" stroke="var(--ink)" stroke-width="2.5"/>' : "") +
        '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (on ? 7.5 : 6) + '" fill="var(' + QUAD[L.quadrant].v + ')" stroke="' + (dead ? "#D64541" : "var(--surface)") + '" stroke-width="' + (dead ? 2.5 : 1.5) + '"/>' +
        "</g>";
    }).join("");
    var ang = (Math.atan(h / w) * 180 / Math.PI).toFixed(1);
    return '<svg class="scatter" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="散布圖：橫軸事故排名，縱軸回報排名">' +
      '<path d="M' + X(0) + " " + Y(GAP) + "L" + X(100 - GAP) + " " + Y(100) + "L" + X(0) + " " + Y(100) + 'Z" fill="var(--q-prevent)" opacity=".12"/>' +
      '<path d="M' + X(GAP) + " " + Y(0) + "L" + X(100) + " " + Y(100 - GAP) + "L" + X(100) + " " + Y(0) + 'Z" fill="var(--q-priority)" opacity=".12"/>' +
      '<rect x="' + l + '" y="' + t + '" width="' + w + '" height="' + h + '" fill="none" stroke="var(--line)"/>' +
      '<path d="' + diag(0) + '" stroke="var(--muted)" stroke-width="1.2"/>' +
      '<path d="' + diag(GAP) + '" stroke="var(--line)" stroke-dasharray="3 3"/><path d="' + diag(-GAP) + '" stroke="var(--line)" stroke-dasharray="3 3"/>' +
      '<text x="' + (l + 6) + '" y="' + (t + 16) + '" class="sl">回報多、事故少</text>' +
      '<text x="' + (l + w - 6) + '" y="' + (t + h - 8) + '" class="sl" text-anchor="end">事故多、回報少</text>' +
      '<text x="' + X(6) + '" y="' + (Y(6) - 5) + '" class="sl mute" transform="rotate(-' + ang + " " + X(6) + " " + (Y(6) - 5) + ')">兩邊一致</text>' +
      '<text x="' + (l + w / 2) + '" y="' + (H - 8) + '" class="sa" text-anchor="middle">事故排名 →（真實）</text>' +
      '<text x="12" y="' + (t + h / 2) + '" class="sa" text-anchor="middle" transform="rotate(-90 12 ' + (t + h / 2) + ')">回報排名 →（示意）</text>' +
      dots + "</svg>";
  }
  /* The one shared scatter: always on the map, every intersection is a dot, the selected one is circled. */
  function renderScatterCard() {
    var body = $("scatbody");
    if (!body || !S.locs.length) return;
    var L = S.sel && S.byId[S.sel], note;
    if (L) {
      var p = ranks()[L.id], d = p.y - p.x;
      note = "<b>" + esc(L.name) + "</b>：事故排第 " + p.x + "、回報排第 " + p.y + "。" +
        (d > GAP ? "回報明顯比事故多，市民先感覺到危險。" : d < -GAP ? "事故明顯比回報多，要問為什麼沒人回報。" : "兩邊差不多一致。");
    } else note = "每個點是一個路口，兩軸是排名（0＝最少，100＝最多）。兩邊一致就落在斜線上，離斜線越遠落差越大；紅框＝有死亡事故。點一下看路口。";
    body.innerHTML = scatterSVG(S.sel) + '<p class="scatnote">' + note + "</p>";
    bindScatter(body);
  }
  function scatterHTML(selId) {
    if (selId) {
      var p = ranks()[selId], d = p.y - p.x;
      return '<p class="note">散布圖（地圖右上角）：事故排第 <b>' + p.x + "</b>、回報排第 <b>" + p.y + "</b>（0＝最少，100＝最多）。" +
        (d > GAP ? "回報明顯比事故多：市民先感覺到危險。" : d < -GAP ? "事故明顯比回報多：要問為什麼沒人回報（例如車多但少人走路）。" : "兩邊差不多一致。") + "</p>";
    }
    var R0 = ranks(), gaps = S.locs.map(function (L) { return { L: L, d: R0[L.id].y - R0[L.id].x }; });
    var list = function (arr, txt) {
      return arr.length ? '<p class="b-label">' + txt + '</p><ol class="board">' + arr.slice(0, 3).map(function (g) {
        return '<li><button class="brow" data-id="' + g.L.id + '">' + careBadge(g.L, 24) + '<span class="nm">' + esc(g.L.name) + '</span><span class="mono v">差 ' + Math.abs(g.d) + "</span></button></li>";
      }).join("") + "</ol>" : "";
    };
    return '<div class="scatwrap"><p class="note">地圖右上角的<b>散布圖</b>把所有路口放在一起比：事故和回報一致的落在斜線上。落差最大的是：</p>' +
      list(gaps.filter(function (g) { return g.d > GAP; }).sort(function (a, b) { return b.d - a.d; }), "回報多、事故少") +
      list(gaps.filter(function (g) { return g.d < -GAP; }).sort(function (a, b) { return a.d - b.d; }), "事故多、回報少") + "</div>";
  }
  function bindScatter(root) {
    root.querySelectorAll(".sdot").forEach(function (g) {
      var go = function () { select(g.dataset.id, true); };
      g.addEventListener("click", go);
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      g.addEventListener("mouseenter", function () { pulse(g.dataset.id); });
    });
    root.querySelectorAll(".scatwrap .brow").forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.id, true); }); });
  }

  /* ---------------- 我附近: location-based view ----------------
     Reads the phone's GPS (works inside the LINE mini app). Outside the demo area it falls back to Zhongli station. */
  var STATION = { lon: 121.2257, lat: 24.9537, name: "中壢火車站" };
  function distM(a, b) {
    var dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function circleGeo(c, r) {
    var pts = [];
    for (var i = 0; i <= 64; i++) {
      var a = i / 64 * 2 * Math.PI;
      pts.push([c.lon + r * Math.cos(a) / (111320 * Math.cos(c.lat * Math.PI / 180)), c.lat + r * Math.sin(a) / 110540]);
    }
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} },
      { type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: {} }] };
  }
  function drawNearby() {
    var m = S.map, n = S.near;
    if (!m || !m.isStyleLoaded() || !n) return;
    var g = circleGeo(n.c, n.r), ink = K.cssVar("--accent") || "#1D5C8A";
    if (m.getSource("near")) m.getSource("near").setData(g);
    else {
      m.addSource("near", { type: "geojson", data: g });
      m.addLayer({ id: "near-fill", type: "fill", source: "near", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ink, "fill-opacity": 0.08 } });
      m.addLayer({ id: "near-line", type: "line", source: "near", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "near-me", type: "circle", source: "near", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": ink, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    }
    var dLon = n.r / (111320 * Math.cos(n.c.lat * Math.PI / 180)), dLat = n.r / 110540, narrow = window.innerWidth <= 820;
    m.fitBounds([[n.c.lon - dLon, n.c.lat - dLat], [n.c.lon + dLon, n.c.lat + dLat]], {
      padding: narrow ? { top: 90, bottom: window.innerHeight * 0.44 + 20, left: 20, right: 20 } : { top: 70, bottom: 70, left: 60, right: 60 }, duration: 600 });
  }
  function clearNearby() {
    S.near = null;
    var m = S.map;
    if (m && m.getSource && m.getSource("near")) m.getSource("near").setData({ type: "FeatureCollection", features: [] });
  }
  function radiusText(r) { return r >= 1000 ? r / 1000 + " 公里" : r + " 公尺"; }
  function openNearby() {
    S.sel = null;
    S.near = { c: STATION, r: (S.near && S.near.r) || 1000, status: "locating", msg: "" };
    renderMarkers();
    renderNearby();
    var fallback = function (msg) { if (!S.near) return; S.near.c = STATION; S.near.status = "demo"; S.near.msg = msg; renderNearby(); drawNearby(); };
    if (!navigator.geolocation) { fallback("這個瀏覽器不能定位，先用中壢火車站示範。"); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (!S.near) return;
      var c = { lon: pos.coords.longitude, lat: pos.coords.latitude, name: "你的位置" }, b = S.meta.bbox;
      if (c.lon < b[0] - 0.005 || c.lon > b[2] + 0.005 || c.lat < b[1] - 0.005 || c.lat > b[3] + 0.005) { fallback("你目前不在 Demo 範圍（中壢火車站周邊），先用中壢火車站示範；正式版會涵蓋全桃園。"); return; }
      S.near.c = c; S.near.status = "gps"; S.near.msg = ""; renderNearby(); drawNearby();
    }, function () { fallback("沒有取得定位權限，先用中壢火車站示範。"); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }
  function renderNearby() {
    var n = S.near;
    if (!n) return;
    var inR = S.locs.map(function (L) { return { L: L, d: distM(L, n.c) }; }).filter(function (x) { return x.d <= n.r; }).sort(function (a, b) { return a.d - b.d; });
    var acc = sum(inR.map(function (x) { return x.L.real.acc_recent; })), a1 = sum(inR.map(function (x) { return x.L.real.a1_recent; })),
      rep = sum(inR.map(function (x) { return x.L.reports.concern; })),
      worst = inR.slice().sort(function (a, b) { return b.L.reports.concern - a.L.reports.concern; })[0];
    var topCat = function (L) { return Object.keys(L.reports.categories).sort(function (a, b) { return L.reports.categories[b] - L.reports.categories[a]; })[0]; };
    var html = '<button class="back" id="back">← 回到全部路口</button>' +
      '<p class="eyebrow">我附近</p><h1 class="ptitle">' + (n.status === "locating" ? "定位中…" : esc(n.c.name) + "附近 " + radiusText(n.r) + "內") + "</h1>" +
      (n.msg ? '<p class="minenote warn">' + esc(n.msg) + "</p>" : "") +
      '<div class="seg nearseg" role="group" aria-label="範圍">' + [500, 1000, 2000].map(function (r) {
        return '<button type="button" data-r="' + r + '" aria-pressed="' + (r === n.r) + '">' + radiusText(r) + "</button>";
      }).join("") + "</div>" +
      '<div class="stats">' +
      '<div class="stat"><b>' + inR.length + "</b><span>個路口</span></div>" +
      '<div class="stat"><b>' + fmt(acc) + '</b><span>近三年事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + a1 + '</b><span>死亡事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + fmt(rep) + '</b><span>人回報要注意<br><span class="badge mock">示意</span></span></div></div>' +
      (S.types ? '<p class="accnote">範圍內的事故牽涉到：' + VEH_ORDER.map(function (k) { return k + " <b>" + sum(inR.map(function (x) { var t = typesOf(x.L); return t ? t.vehicles[k] || 0 : 0; })) + "</b> 件"; }).join("、") + "（警政署資料）。</p>" : "") +
      (worst ? '<p class="accnote">附近最多人回報的是 <b>' + esc(worst.L.name) + "</b>（" + worst.L.reports.concern + " 人），最常遇到「" + esc(topCat(worst.L)) + "」。</p>" : "") +
      '<div class="sec"><div class="sec-h"><h3>範圍內的路口（由近到遠）</h3></div>' +
      (inR.length ? '<ol class="board">' + inR.map(function (x) {
        var L = x.L;
        return '<li><button class="brow" data-id="' + L.id + '">' + careBadge(L, 24) + '<span class="nm">' + esc(L.name) +
          '<br><span class="sub">' + QUAD[L.quadrant].name + "・事故 " + L.real.acc_recent + " 件" + (L.real.a1_recent ? '（<b class="a1t">死亡 ' + L.real.a1_recent + "</b>）" : "") + (typesOf(L) && typesOf(L).vehicles["行人"] ? "・撞到行人 " + typesOf(L).vehicles["行人"] + " 件" : "") + "・回報 " + L.reports.concern + ' 人</span></span><span class="mono v">' + Math.round(x.d / 10) * 10 + " m</span></button></li>";
      }).join("") + "</ol>" : '<p class="note">這個範圍內沒有 Demo 的路口，試試把範圍放大。</p>') + "</div>" +
      '<p class="note">事故＝路口 35 公尺內的 A1、A2 事故（桃園市政府開放資料）；回報為示意資料。定位只用來畫範圍，不會記錄或上傳。</p>';
    $("pin").innerHTML = html;
    $("back").addEventListener("click", function () { renderOverview(); fitAll(true); });
    $("pin").querySelectorAll(".nearseg button").forEach(function (b) { b.addEventListener("click", function () { S.near.r = +b.dataset.r; renderNearby(); drawNearby(); }); });
    $("pin").querySelectorAll(".brow").forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.id, true); }); });
    $("panel").classList.add("expanded");
    $("panel").scrollTop = 0;
  }

  /* ---------------- controls ---------------- */
  function setLayer(layer) {
    S.layer = layer;
    document.querySelectorAll("#layers button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.layer === layer); });
    renderMarkers();
    if (!S.sel) { if (S.near) renderNearby(); else renderOverview(); }
  }
  /* ---------------- panel: overview ---------------- */
  function renderOverview() {
    S.sel = null;
    clearNearby();
    var counts = { priority: 0, prevent: 0, calm: 0 };
    S.locs.forEach(function (L) { counts[L.quadrant]++; });
    var totalReports = sum(S.locs.map(function (L) { return L.reports.concern + L.reports.praise; }));
    var pick = function (q, key) {
      return S.locs.filter(function (L) { return L.quadrant === q; }).sort(function (a, b) { return key(b) - key(a); })[0];
    };
    var picks = [
      pick("prevent", function (L) { return L.reports.concern; }),
      pick("priority", function (L) { return L.reports.concern; }),
      pick("calm", function (L) { return L.reports.praise; })
    ].filter(Boolean);
    var html = '<p class="eyebrow">DEMO ・ 中壢火車站周邊</p>' +
      '<h1 class="ptitle">哪裡讓人「差一點」出事？</h1>' +
      '<p class="lede">市民回報差點出事的路口，其他人可以按「我也遇過」。地圖把市民的經驗和真實事故放在一起看，找出還沒出事、但大家都覺得危險的地方。</p>' +
      '<p class="note">點地圖上的圓圈，看每個路口的小檔案；右上角「＋ 我要回報」可以體驗回報流程。</p>' +
      '<div class="search"><input id="q" type="search" autocomplete="off" placeholder="搜尋路名，例如：延平路" aria-label="搜尋路名"><ul class="qres" id="qres"></ul></div>' +
      myHistoryHTML() +
      '<div class="stats">' +
      '<div class="stat"><b>' + fmt(S.meta.accidents_recent) + '</b><span>近三年事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + fmt(S.meta.a1_recent) + '</b><span>其中死亡事故<br><span class="badge real">真實</span></span></div>' +
      '<div class="stat"><b>' + fmt(totalReports) + '</b><span>市民回報<br><span class="badge mock">示意</span></span></div></div>' +
      '<div class="sec"><div class="sec-h"><h3>三種路口</h3><span class="src">事故（真實）× 回報（示意）</span></div><div class="quadgrid">' +
      ["prevent", "priority", "calm"].map(function (k) {
        var q = QUAD[k];
        return '<button class="qcard" style="--qc:var(' + q.v + ')" data-quad="' + k + '"><b>' + q.name + "</b><span>" + q.desc + "</span><em>" + counts[k] + " 個路口</em></button>";
      }).join("") + "</div>" + scatterHTML(null) + "</div>" +
      risingHTML() +
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
    bindScatter($("pin"));
    $("pin").querySelectorAll(".qcard").forEach(function (b) {
      b.addEventListener("click", function () {
        setLayer("compare");
        S.locs.filter(function (L) { return L.quadrant === b.dataset.quad; }).forEach(function (L) { pulse(L.id); });
      });
    });
    renderMarkers();
  }

  function myHistoryHTML() {
    var list = myHistory().slice().reverse();
    if (!list.length) return "";
    return '<div class="sec mine"><div class="sec-h"><h3><i class="mineb static">我</i>我的回報（' + list.length + '）</h3><span class="badge mock">示意</span></div>' +
      '<ol class="board">' + list.map(function (h) {
        var L = S.byId[h.loc]; if (!L) return "";
        return '<li><button class="brow" data-id="' + L.id + '">' + careBadge(L, 24) + '<span class="nm">' + esc(L.name) + '<br><small class="note">' + mmdd(h.date) + " " + esc(myLine(h)) + (h.updates ? "・補充 " + h.updates + " 次" : "") + '</small></span><span class="rt rt-' + L.route + '">' + esc(progressLabel(L)) + "</span></button></li>";
      }).join("") + '</ol><p class="note">市府處理有進度時，會在這裡和 LINE 通知你。</p></div>';
  }

  function searchLocs(q) {
    q = (q || "").trim().replace(/台/g, "臺");
    if (!q) return [];
    return S.locs.filter(function (L) { return L.name.replace(/台/g, "臺").indexOf(q) >= 0; })
      .sort(function (a, b) { return b.reports.concern - a.reports.concern; }).slice(0, 6);
  }

  /* Places whose reports jumped recently: the ranking counts totals, so a place that is only now turning dangerous would wait. */
  function risingHTML() {
    var rows = S.locs.filter(function (L) { return L.trend.rising && !L.improved; })
      .sort(function (a, b) { return trendNumbers(b).recent - trendNumbers(a).recent; });
    if (!rows.length) return "";
    return '<div class="sec"><div class="sec-h"><h3>' + RISE_TAG + "最近變多</h3><span class=\"badge mock\">示意</span></div>" +
      '<p class="note">回報總數還不多，但最近 ' + S.meta.rising.window + " 個月突然變多：路口可能正在變危險。排行看的是累積人數，這些路口不一定排得到，所以另外列出來。</p>" +
      '<ol class="board">' + rows.map(function (L) {
        var n = trendNumbers(L);
        return '<li><button class="brow" data-id="' + L.id + '">' + careBadge(L, 24) + '<span class="nm">' + esc(L.name) + '</span><span class="mono v">每月 ' + n.before + " → " + n.recent + " 人</span></button></li>";
      }).join("") + "</ol></div>";
  }

  /* Each district keeps its own ranking, so quieter districts are not drowned out. */
  var ROUTE_LABEL = { district: "本月送市府", fast: "急件", next: "下個月優先", none: "收集中" };
  function boardHTML() {
    var dists = Object.keys(S.meta.districts).sort(function (a, b) { return S.meta.districts[b] - S.meta.districts[a]; });
    var d = S.board && dists.indexOf(S.board) >= 0 ? S.board : dists[0];
    var rows = S.locs.filter(function (L) { return L.district === d && !L.improved; })
      .sort(function (a, b) { return b.reports.concern - a.reports.concern; }).slice(0, 5);
    return '<div class="sec"><div class="sec-h"><h3>各區關心排行（本月）</h3><span class="badge mock">示意</span></div>' +
      '<p class="note">每個行政區只跟自己比：每區每月前 ' + S.meta.district_quota + " 名送市府（深藍色，標籤是市府目前的處理進度），每區名額一樣；人數還少、但最近變多或曾經擦撞的路口列為急件。名額滿了的排到下個月優先。</p>" +
      '<div class="tabs btabs" role="tablist">' + dists.map(function (x) {
        return '<button role="tab" data-d="' + x + '" aria-selected="' + (x === d) + '">' + x + "</button>";
      }).join("") + "</div>" +
      '<ol class="board">' + rows.map(function (L, i) {
        return '<li><button class="brow" data-id="' + L.id + '"><b class="mono">' + (i + 1) + '</b><span class="nm">' + esc(L.name) + (L.trend.rising ? RISE_TAG : "") + '</span><span class="mono v">' + L.reports.concern + ' 人</span><span class="rt rt-' + L.route + '">' + (ROUTE[L.route] && ROUTE[L.route].tag ? '<i class="rtb">' + ROUTE[L.route].tag + "</i>" : "") + esc(progressLabel(L)) + "</span></button></li>";
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
    if (S.view === "gov" && window.GovView) { window.GovView.focus(id); return; }
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
        '<p class="tl-sum' + (cur ? " summary" : "") + '"><b>AI 摘要：</b>' + esc(cur ? summaryOf(L) : t.summary) + "</p></div></li>";
    }).join("") + "</ol>";
    if (!hasUpdate(L)) out += '<p class="note">市府還沒有在這個路口登錄重大改善。登錄重大改善後，會開始新的階段，也才開放「這裡變好了」。</p>';
    return out;
  }

  /* Repair log: when, what was done, which reported problem it addresses. For a city update we can also
     show whether reports about that problem dropped (per month, previous stage vs now) — the city can check the work. */
  function solvedTrend(L, rp, cat) {
    if (rp.kind !== "update") return "";
    var stages = L.timeline.filter(function (t) { return t.type === "stage"; }), k = -1;
    L.timeline.forEach(function (t, i) { if (t.type === "update" && t.date === rp.date) k = i; });
    var prev = L.timeline[k - 1], next = null;
    for (var i = k + 1; i < L.timeline.length; i++) if (L.timeline[i].type === "stage") { next = L.timeline[i]; break; }
    if (!prev || !next || !prev.top) return "";
    var b0 = (prev.top.filter(function (x) { return x[0] === cat; })[0] || [cat, 0])[1];
    var a0 = next.current ? (L.reports.categories[cat] || 0) : ((next.top || []).filter(function (x) { return x[0] === cat; })[0] || [cat, 0])[1];
    var b = perMonth(b0, prev.months), a = perMonth(a0, next.months);
    return '<span class="rtrend ' + (a <= b * 0.5 ? "good" : "same") + '">這個問題每月 ' + b + " → " + a + " 人回報" + (a <= b * 0.5 ? "" : "，沒有明顯減少") + "</span>";
  }
  function repairsHTML(L) {
    var rs = (L.repairs || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!rs.length) return '<p class="note">這個路口還沒有維修紀錄。市府完成維修後會登錄在這裡：日期、修了什麼、處理了哪個問題。</p>';
    return '<ul class="repairs">' + rs.map(function (rp) {
      return '<li class="rp rp-' + rp.kind + '"><div class="rp-h"><b class="mono">' + esc(rp.date.replace(/-/g, "/")) + "</b><span>完工</span>" +
        '<span class="rp-kind">' + (rp.kind === "update" ? "市府更新・開新階段" : "小修") + '</span><span class="owner sm">' + esc(rp.unit) + "</span></div>" +
        '<ul class="rp-items">' + rp.items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        rp.solves.map(function (v) {
          return '<p class="rp-solves">處理的問題：<b>' + esc(v.cat) + "</b>（" + esc(v.cause) + "，當時 " + v.n + " 人回報）" + solvedTrend(L, rp, v.cat) + "</p>";
        }).join("") + "</li>";
    }).join("") + "</ul>";
  }

  /* 事故類型與車種：警政署逐案資料（data/accident_types.json），和上面的件數是同一套 35 公尺規則 */
  var VEH_ORDER = ["行人", "機車", "汽車", "自行車", "大型車"];
  function typesOf(L) { return S.types && S.types.locations[L.id]; }
  function typesHTML(L) {
    var t = typesOf(L);
    if (!t || !t.n) return "";
    var kinds = ["車與車", "人與車", "車輛本身"].filter(function (k) { return t.kinds[k]; });
    var vmax = Math.max.apply(null, VEH_ORDER.map(function (k) { return t.vehicles[k] || 0; }).concat([1]));
    return '<div class="sec"><div class="sec-h"><h3>是什麼樣的事故</h3><span class="badge real">真實資料</span></div>' +
      '<p class="accnote">近三年 <b>' + t.n + "</b> 件：" + kinds.map(function (k) { return k + " <b>" + t.kinds[k] + "</b> 件"; }).join("、") +
      (t.deaths ? '，<b class="a1t">死亡 ' + t.deaths + " 人</b>" : "") + "。</p>" +
      '<p class="b-label">牽涉到誰（一件事故可能同時算到兩種）</p><div class="bars">' +
      VEH_ORDER.map(function (k) {
        var v = t.vehicles[k] || 0;
        return '<div class="bar"><div class="lbl"><span>' + k + '</span><div class="track"><div class="fill' + (k === "行人" ? " ped" : "") + '" style="width:' + Math.round(v / vmax * 100) + '%"></div></div></div><span class="v">' + v + "</span></div>";
      }).join("") + "</div>" +
      '<p class="note">撞法前三名：' + Object.keys(t.subs).filter(function (k) { return k !== "其他"; }).slice(0, 3).map(function (k) { return k + " " + t.subs[k]; }).join("、") +
      "。來源：" + esc(S.types.source) + "。</p></div>";
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
      '<button class="back" id="back">' + (S.near ? "← 回到我附近" : "← 回到全部路口") + '</button>' +
      (L.deferred && L.route === "next" ? '<p class="minenote warn">⏳ 承辦已排到<b>下個月</b>處理：' + esc(L.deferred.reason) + "。名額保留，下個月優先。</p>" : "") +
      (STAGE_ICON[L.stage] && !L.improved ? '<p class="minenote">' + STAGE_ICON[L.stage] + " 目前進度：<b>" + esc(progressLabel(L)) + "</b>" + (L.plan ? "・預計怎麼改：" + esc(L.plan) : "") + "</p>" : "") +
      (myReport(L.id) ? '<p class="minenote"><i class="mineb static">我</i>你在 ' + mmdd(myReport(L.id).date) + " 回報過這裡：" + esc(myLine(myReport(L.id))) + "。目前進度：" + esc(progressLabel(L)) + "</p>" : "") +
      '<div class="titlerow"><div class="wx">' + careBadge(L, 52) + '</div><div><p class="eyebrow">路口小檔案</p><h1 class="ptitle">' + esc(L.name) + '</h1></div></div>' +
      '<div class="tagsrow"><span class="qtag" style="--qc:var(' + q.v + ');background:var(' + q.v + ')">' + q.name + '</span><span class="stagetag">處理進度：' + L.stage + "</span>" + (L.trend.rising ? '<span class="stagetag risetag">' + RISE_TAG + "最近變多</span>" : "") + "</div>" +
      '<p class="wxline">' + careText(L) + "・" + esc(L.district) + "</p>" +

      '<div class="sec"><div class="sec-h"><h3>有多少人也遇過</h3><span class="badge mock">示意</span></div>' +
      '<div class="big"><b class="mono">' + r.concern + '</b><span>人回報這裡要注意' + (r.praise ? "・" + r.praise + " 人說變好了" : "") + "</span></div>" +
      '<div class="crowd" aria-hidden="true">' + crowdHTML(r.users, 40) + "</div>" +
      '<div class="ulegend">' + USERS.map(function (u) { return '<span><i style="background:' + K.userColor(u) + '"></i>' + u + " " + (r.users[u] || 0) + "</span>"; }).join("") + "</div>" +
      '<div class="actions"><button class="btn primary" id="metoo">我也遇過</button><button class="btn" id="better"' + (canPraise(L) ? "" : ' disabled title="市府更新後才開放"') + '>這裡變好了</button></div>' +
      (canPraise(L) ? "" : '<p class="note">市府登錄完工後才能說「這裡變好了」。</p>') + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>最近有沒有變多</h3><span class="badge mock">示意</span></div>' + trendHTML(L) + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>時間線</h3><span class="badge mock">示意</span></div>' + timelineHTML(L) + "</div>" +
      '<div class="sec" id="repairs"><div class="sec-h"><h3>維修紀錄（' + (L.repairs || []).length + '）</h3><span class="badge mock">示意</span></div>' + repairsHTML(L) + "</div>" +

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
      (L.real.a1_total ? "，其中死亡事故 <b>" + L.real.a1_total + "</b> 件（近三年 <b>" + L.real.a1_recent + "</b> 件）" : "") + "。" +
      (L.real.level === "high" ? "近三年事故數在本區前 20%。" : "近三年事故數不在本區前 20%。") + "</p>" +
      '<p class="note">路口 35 公尺內的 A1、A2 事故。來源：桃園市政府開放資料。</p></div>' +
      typesHTML(L) +

      '<div class="sec"><div class="sec-h"><h3>兩邊對照</h3></div><p class="accnote"><b style="color:var(' + q.v + ')">' + q.name + "</b>：" + q.desc + "</p>" + scatterHTML(L.id) + "</div>" +

      (L.decision ? '<div class="sec"><div class="sec-h"><h3>市府回覆</h3><span class="badge mock">示意</span></div><p class="accnote"><b>' + esc(L.decision.title) + "（" + esc(L.decision.date) + "）</b>：" + esc(L.decision.text) + "</p></div>" : "") +
      '<div class="sec"><div class="sec-h"><h3>處理進度</h3><span class="badge mock">示意</span></div><ol class="steps">' +
      STAGES.map(function (s, i) { return '<li class="' + (i < stageIdx ? "is-done" : i === stageIdx ? "is-now" : "") + '"><i></i>' + s + "</li>"; }).join("") + "</ol>" +
      (L.schedule && L.stage === "已排程" ? '<p class="accnote">市府預計 <b>' + L.schedule.replace("-", " 年 ").replace(/ 0(\d)$/, " $1") + " 月</b>完工" + (L.plan ? "，預計怎麼改：<b>" + esc(L.plan) + "</b>" : "") + "。</p>" : "") +
      "</div>" +
      '<div class="sec"><div class="sec-h"><h3>怎麼送到市府</h3><span class="badge mock">示意</span></div><ul class="routes">' +
      ["district", "fast"].map(function (k) {
        return '<li class="' + (L.route === k ? "on" : "") + '"><b>' + (ROUTE[k].tag ? '<i class="rtb static">' + ROUTE[k].tag + "</i>" : "") + ROUTE[k].name + "</b><span>" + ROUTE[k].desc() + "</span></li>";
      }).join("") + "</ul>" +
      '<p class="accnote">' + esc(L.route_reason || "回報還在累積，這個月還沒進入名單。") + "</p>" +
      (L.district_rank ? '<p class="note">' + esc(L.district) + "本月關心排行第 " + L.district_rank + " 名</p>" : "") + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>誰管這裡</h3><span class="badge mock">示意</span></div><div class="owners">' +
      L.owners.map(function (o, i) {
        var lead = (L.lead && L.owners.indexOf(L.lead) >= 0) ? L.lead : L.owners.filter(function (x) { return x.indexOf("會勘") < 0; })[0];
        return '<span class="owner' + (o === lead ? " lead" : "") + '">' + (o === lead ? "主責・" : "") + esc(o) + "</span>";
      }).join("") + "</div>" +
      (L.owners.length >= 3 ? '<p class="flag">牽涉 3 個以上單位，建議會勘</p>' : "") + "</div>" +

      '<div class="sec"><div class="sec-h"><h3>市民怎麼說</h3><span class="badge mock">示意</span></div>' +
      '<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-t="concern">要注意 ' + concernC.length + '</button><button role="tab" aria-selected="false" data-t="praise">變好了 ' + praiseC.length + "</button></div>" +
      '<ul class="voices" id="voices"></ul></div>' +

      "";
    $("pin").innerHTML = html;
    var showVoices = function (tone) {
      var list = tone === "praise" ? praiseC : concernC;
      $("voices").innerHTML = list.length ? list.map(function (c) {
        return '<li class="voice">' + K.avatar(c.user, K.userColor(c.user), 30) + "<div><p>" + esc(c.text) + "</p><small>" + c.user + (c.category ? "・" + c.category : "") + (c.date ? "・" + c.date : c.mine ? "・剛剛" : "") + "</small></div></li>";
      }).join("") : '<li class="note">還沒有人這樣說。</li>';
      $("pin").querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.t === tone); });
    };
    showVoices("concern");
    $("pin").querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { showVoices(b.dataset.t); }); });
    $("back").addEventListener("click", function () { if (S.near) renderNearby(); else renderOverview(); });
    bindScatter($("pin"));
    $("metoo").addEventListener("click", function () { R.open({ loc: L.id, mode: "concern", quick: true }); });
    $("better").addEventListener("click", function () { R.open({ loc: L.id, mode: "praise" }); });
  }

  /* ---------------- report flow (simulated chat) ---------------- */
  var R = {
    waitingForPick: false, ctx: null,
    open: function (opts) {
      R.ctx = { loc: opts.loc || null, mode: opts.mode || null, quick: !!opts.quick, cat: null, time: null, freq: null, sev: null, praise: null, update: false };
      $("phone").hidden = false;
      $("chat").innerHTML = "";
      var TL = window.TaoguoLINE || {};
      R.bot("嗨" + (TL.user ? "，" + esc(TL.user.name) : "") + "！這是「桃過一劫」的回報小幫手（示意）。差點出事、好險逃過一劫的地方，都可以跟我說。");
      R.bot('這裡用來回報「差點出事、讓人害怕」的路口。<br><b>緊急狀況</b>（大坑洞、號誌全滅、路樹倒塌）請直接打 <b>1999</b>；有人受傷請打 <b>110／119</b>。');
      if (!S.me) R.stepAvatar(); else R.askSameAvatar();
    },
    askSameAvatar: function () {
      var d = document.createElement("div"); d.className = "msg bot";
      d.innerHTML = "上次你是這個小角色（" + esc(S.me.user) + "），這次也是嗎？" + '<div style="margin-top:6px">' + K.avatar(S.me.user, S.me.color, 44) + "</div>";
      $("chat").appendChild(d); R.scroll();
      R.opts(["對，就是我", "換一個"], function (t) { if (t === "換一個") R.stepAvatar(); else R.afterAvatar(); });
    },
    finishUpdate: function (L) {
      var hist = myHistory(), h = hist.filter(function (x) { return x.loc === L.id && x.mode === "concern"; })[0];
      if (h) { h.updates = (h.updates || 0) + 1; h.cat = R.ctx.cat; h.sev = R.ctx.sev; h.time = R.ctx.time; h.last = new Date().toISOString(); saveHistory(hist); }
      if (R.ctx.text) L.comments.unshift({ tone: "concern", category: R.ctx.cat, text: R.ctx.text, user: S.me.user, mine: true });
      refresh(L);
      R.bot("已補充到你原本的回報：" + esc(R.ctx.cat + "・" + R.ctx.sev) + "。<b>人數不重複計算</b>，但承辦看摘要時會看到最新的狀況。");
      R.opts(["看這個路口", "關閉"], function (t) { if (t === "看這個路口") { R.close(); select(L.id, true); } else R.close(); });
      renderMarkers();
    },
    close: function () { $("phone").hidden = true; R.waitingForPick = false; $("phone").classList.remove("peek"); if (S.view !== "gov" && !S.sel) renderOverview(); },
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
      var mine = myReport(L.id, R.ctx.mode);
      if (mine && !R.ctx.update) {
        R.bot("你在 <b>" + mmdd(mine.date) + "</b> 回報過這個路口了：" + esc(myLine(mine)) + "。<br>目前進度：<b>" + esc(progressLabel(L)) + "</b>。<b>一人一次</b>，同一個路口只計一次。");
        var opts = R.ctx.mode === "praise" ? ["看這個路口", "回報別的路口", "關閉"] : ["補充新的狀況", "看這個路口", "回報別的路口", "關閉"];
        R.opts(opts, function (t) {
          if (t === "看這個路口") { R.close(); select(L.id, true); }
          else if (t === "回報別的路口") { R.ctx.loc = null; R.stepWhere(); }
          else if (t === "補充新的狀況") { R.ctx.update = true; R.bot("好，補充的內容會加在你原本的回報裡，人數不重複計算。"); R.stepCat(); }
          else R.close();
        });
        return;
      }
      var crowd = '<div class="crowd" style="margin-top:6px">' + crowdHTML(L.reports.users, 24) + "</div>";
      if (R.ctx.mode === "praise" && !canPraise(L)) {
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
      w.innerHTML = '<label class="note" for="rtext">補充說明（選填，按 Enter 送出、Shift＋Enter 換行）</label><textarea id="rtext" maxlength="200" placeholder="例如：右轉時看不到斑馬線上的人"></textarea>';
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
      $("rtext").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); o.querySelector(".opt").click(); } });
      $("rtext").focus();
    },
    finish: function () {
      var L = S.byId[R.ctx.loc], r = L.reports, u = S.me.user;
      if (R.ctx.update) { R.finishUpdate(L); return; }
      var before = r.users[u] || 0;
      if (R.ctx.mode === "praise") {
        r.praise += 1;
        L.comments.unshift({ tone: "praise", text: R.ctx.praise === "其他" ? "這裡變好了。" : R.ctx.praise + "了。", user: u, mine: true });
      } else {
        r.concern += 1;
        L.trend.counts[L.trend.counts.length - 1] += 1;  // this month
        r.categories[R.ctx.cat] = (r.categories[R.ctx.cat] || 0) + 1;
        var hr = (TIMES.filter(function (t) { return t[0] === R.ctx.time; })[0] || TIMES[1])[1];
        r.hours[hr] += 1;
        r.severity[R.ctx.sev] = (r.severity[R.ctx.sev] || 0) + 1;
        if (R.ctx.text) L.comments.unshift({ tone: "concern", category: R.ctx.cat, text: R.ctx.text, user: u, mine: true });
      }
      r.users[u] = before + 1;
      var hist = myHistory();
      hist.push({ loc: L.id, mode: R.ctx.mode, cat: R.ctx.cat, sev: R.ctx.sev, time: R.ctx.time, praise: R.ctx.praise, date: new Date().toISOString() });
      saveHistory(hist);
      refresh(L);
      var rank = R.ctx.mode === "praise" ? r.praise : r.concern;
      var d = document.createElement("div"); d.className = "done";
      d.innerHTML = '<div class="rank">你是第<b>' + rank + "</b>位" + (R.ctx.mode === "praise" ? "說這裡變好了的人" : "回報這裡的人") + "</div>" +
        '<div class="stage"><div class="crowdline">' + crowdHTML(r.users, 14) + '</div><div class="me">' + K.avatar(S.me.user, S.me.color, 44) + '</div><div class="road"></div></div>' +
        '<p class="mine">' + esc(R.ctx.mode === "praise" ? "你說：" + R.ctx.praise : "你回報：" + R.ctx.cat + "・" + R.ctx.time + "・" + (R.ctx.freq || "") + "・" + R.ctx.sev) + "</p>" +
        '<p class="note">' + (R.ctx.mode === "praise" ? "謝謝你！我們會把這句感謝轉給負責改善的單位。" : "我們每月會把這裡整理給市府。處理有進展時，會在這裡通知你。") + "</p>" +
        '<p class="note"><i class="mineb static">我</i>已加入「我的回報」，地圖上這個路口會標「我」，之後可以回來看進度。</p>' +
        '<p class="note">（示意：這筆回報不會送出' + (window.TaoguoLINE && window.TaoguoLINE.user ? '；同一個 LINE 帳號每個路口只計一次' : '') + '）</p>';
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
    if (h === "gov" && window.GovView) window.GovView.setView("gov");
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
      pick(top); pick("下班尖峰"); pick("每天"); pick("差點發生事故");
      var ta = $("rtext");
      if (ta) ta.value = "右轉時轉角被擋住，看不到斑馬線上的人。";
      pick("送出");
    }
  }

  /* LINE 選單「我要回報」用 ?report=1 直接打開回報小幫手；資料載完、地圖載完各試一次，已打開就不重複 */
  function autoReport() {
    if (!/[?&]report=1(&|$)/.test(location.search) || !S.locs) return;
    (window.TaoguoLINE ? window.TaoguoLINE.ready : Promise.resolve()).then(function () {
      if ($("phone").hidden && !$("chat").children.length) R.open({});
    });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    $("brand").insertAdjacentHTML("afterbegin", K.brand());
    document.querySelectorAll("#layers button").forEach(function (b) { b.addEventListener("click", function () { setLayer(b.dataset.layer); }); });
    $("report").addEventListener("click", function () { R.open({}); });
    $("near").addEventListener("click", openNearby);
    var sc = $("scatcard"), st = $("scattoggle");
    var setScat = function (open) { sc.classList.toggle("closed", !open); st.textContent = open ? "收起" : "散布圖"; st.setAttribute("aria-expanded", open); };
    setScat(window.innerWidth > 820);
    st.addEventListener("click", function () { setScat(sc.classList.contains("closed")); });
    $("phone-x").addEventListener("click", R.close);
    $("handle").addEventListener("click", function () { $("panel").classList.toggle("expanded"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("phone").hidden) R.close(); });
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", recolorMap);
    new MutationObserver(recolorMap).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    var types = fetch("data/accident_types.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all(["data/roads.geojson", "data/locations.json", "data/meta.json"].map(function (u) {
      return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
    }).concat([types])).then(function (res) {
      S.roads = res[0]; S.locs = res[1]; S.meta = res[2]; S.types = res[3];
      S.locs.forEach(function (L) { S.byId[L.id] = L; });
      renderOverview();
      autoReport();
      setTimeout(autoReport, 1500);
      if (!window.maplibregl) throw new Error("地圖元件沒有載入");
      initMap();
    }).catch(function (err) {
      $("map").innerHTML = '<p class="note" style="padding:24px">地圖載入失敗：' + esc(err.message) + "。請用本機伺服器開啟（見 README）。</p>";
      document.body.dataset.mapReady = "error";
    });
  }
  window.DemoApp = { state: S, select: select, setLayer: setLayer, report: R, mapStyle: mapStyle,
    util: { canPraise: canPraise, progressLabel: progressLabel, esc: esc, summaryOf: summaryOf, careBadge: careBadge, ownerOf: ownerOf, hasUpdate: hasUpdate, perMonth: perMonth,
            renderMarkers: renderMarkers, renderOverview: renderOverview, refresh: refresh, pulse: pulse, careText: careText,
            risingOf: risingOf, trendNumbers: trendNumbers, RISE_TAG: RISE_TAG } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
