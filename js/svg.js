/* Hand-drawn geometric graphics: weather icons, avatars, small charts. Colours come from CSS variables. */
(function () {
  "use strict";
  var USER_VAR = { "行人": "--u-walk", "機車": "--u-moto", "汽車": "--u-car", "自行車": "--u-bike", "公車乘客": "--u-bus" };
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function userColor(u) { return "var(" + (USER_VAR[u] || "--muted") + ")"; }

  function weather(kind, size) {
    size = size || 28;
    var c = kind === "storm" ? "var(--storm)" : kind === "cloudy" ? "var(--cloudy)" : "var(--sunny)";
    var cloud = '<path d="M9 23h15a5 5 0 0 0 0-10 7 7 0 0 0-13.4-1.6A5.2 5.2 0 0 0 9 23z" fill="' + c + '"/>';
    var body;
    if (kind === "sunny") {
      var rays = "";
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4, x1 = 16 + Math.cos(a) * 9.5, y1 = 16 + Math.sin(a) * 9.5, x2 = 16 + Math.cos(a) * 13, y2 = 16 + Math.sin(a) * 13;
        rays += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"/>';
      }
      body = '<circle cx="16" cy="16" r="6.5" fill="' + c + '"/>' + rays;
    } else if (kind === "cloudy") {
      body = cloud;
    } else {
      body = '<g transform="translate(0,-3)">' + cloud + '</g><path d="M17 20l-4 6h3.5l-2 5 6-7.5h-3.6l2.2-3.5z" fill="var(--ink)"/>';
    }
    return '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" aria-hidden="true">' + body + "</svg>";
  }

  /* A person: round head, body in their colour, the vehicle they ride drawn underneath. */
  function avatar(user, color, size) {
    size = size || 40;
    color = color || userColor(user);
    var helmet = (user === "機車" || user === "自行車")
      ? '<path d="M11.2 10.5a6 6 0 0 1 11.6 0z" fill="' + color + '" stroke="var(--ink)" stroke-width="1.2"/>' : "";
    var person = '<circle cx="17" cy="11" r="5.2" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.4"/>' + helmet +
      '<rect x="10.5" y="17" width="13" height="11" rx="5" fill="' + color + '" stroke="var(--ink)" stroke-width="1.4"/>';
    var v = "";
    if (user === "行人") {
      v = '<line x1="14" y1="28" x2="13" y2="36" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/><line x1="20" y1="28" x2="21" y2="36" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>';
    } else if (user === "機車") {
      v = '<rect x="7" y="29" width="20" height="4" rx="2" fill="var(--ink)"/><circle cx="9" cy="35" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.6"/><circle cx="25" cy="35" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.6"/>';
    } else if (user === "自行車") {
      v = '<circle cx="9" cy="34" r="4" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle cx="25" cy="34" r="4" fill="none" stroke="var(--ink)" stroke-width="1.5"/><path d="M9 34l6-5h6l4 5M15 29l2 5" fill="none" stroke="var(--ink)" stroke-width="1.5"/>';
    } else if (user === "汽車") {
      v = '<rect x="4" y="28" width="26" height="7" rx="2.5" fill="var(--asphalt-2)" stroke="var(--ink)" stroke-width="1.4"/><circle cx="10" cy="36" r="2.4" fill="var(--ink)"/><circle cx="24" cy="36" r="2.4" fill="var(--ink)"/>';
    } else {
      v = '<rect x="2" y="27" width="30" height="8" rx="1.5" fill="var(--marking)" stroke="var(--ink)" stroke-width="1.4"/><rect x="5" y="29" width="5" height="3" fill="var(--surface)"/><rect x="12" y="29" width="5" height="3" fill="var(--surface)"/><rect x="19" y="29" width="5" height="3" fill="var(--surface)"/><circle cx="8" cy="36" r="2.2" fill="var(--ink)"/><circle cx="26" cy="36" r="2.2" fill="var(--ink)"/>';
    }
    return '<svg viewBox="0 0 34 40" width="' + (size * 34 / 40).toFixed(0) + '" height="' + size + '" aria-hidden="true">' + person + v + "</svg>";
  }

  function mini(color, h) {
    h = h || 18;
    return '<svg viewBox="0 0 10 14" width="' + (h * 10 / 14).toFixed(1) + '" height="' + h + '" aria-hidden="true"><circle cx="5" cy="3.4" r="2.8" fill="' + color + '"/><path d="M0.6 14v-3.2a4.4 4.4 0 0 1 8.8 0V14z" fill="' + color + '"/></svg>';
  }

  /* 24 polar bars: when people run into the problem. */
  function ring24(hours, size) {
    size = size || 132;
    var c = size / 2, r0 = size * 0.2, r1 = size * 0.44, max = Math.max.apply(null, hours) || 1, out = "";
    out += '<circle cx="' + c + '" cy="' + c + '" r="' + r0 + '" fill="none" stroke="var(--line)"/>';
    out += '<circle cx="' + c + '" cy="' + c + '" r="' + r1 + '" fill="none" stroke="var(--soft)"/>';
    hours.forEach(function (v, h) {
      var a0 = (h / 24) * 2 * Math.PI - Math.PI / 2 + 0.03, a1 = ((h + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.03;
      var r = r0 + (r1 - r0) * (v / max);
      var p = function (rr, a) { return (c + rr * Math.cos(a)).toFixed(1) + " " + (c + rr * Math.sin(a)).toFixed(1); };
      var peak = (h >= 7 && h <= 9) || (h >= 17 && h <= 19);
      out += '<path d="M' + p(r0, a0) + " L" + p(r, a0) + " A" + r.toFixed(1) + " " + r.toFixed(1) + " 0 0 1 " + p(r, a1) + " L" + p(r0, a1) + " A" + r0 + " " + r0 + ' 0 0 0 ' + p(r0, a0) + 'Z" fill="' + (peak ? "var(--ink)" : "var(--asphalt-2)") + '"><title>' + h + " 時：" + v + " 人</title></path>";
    });
    [["0", 0], ["6", 6], ["12", 12], ["18", 18]].forEach(function (t) {
      var a = (t[1] / 24) * 2 * Math.PI - Math.PI / 2, rr = r0 - 9;
      out += '<text x="' + (c + rr * Math.cos(a)).toFixed(1) + '" y="' + (c + rr * Math.sin(a) + 3.5).toFixed(1) + '" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="IBM Plex Mono,monospace">' + t[0] + "</text>";
    });
    return '<svg viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="一天中各時段的回報人數">' + out + "</svg>";
  }

  /* Yearly accident bars; the recent years are drawn in full ink. */
  function accBars(years, values, recent) {
    var W = 360, H = 120, pad = { l: 6, r: 6, t: 18, b: 20 }, n = values.length, max = Math.max.apply(null, values) || 1;
    var bw = (W - pad.l - pad.r) / n, out = "";
    values.forEach(function (v, i) {
      var h = (H - pad.t - pad.b) * (v / max), x = pad.l + i * bw + bw * 0.18, y = H - pad.b - h, w = bw * 0.64;
      var isRecent = years[i] >= recent[0] && years[i] <= recent[1];
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" fill="' + (isRecent ? "var(--ink)" : "var(--line)") + '"/>';
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + v + "</text>";
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="IBM Plex Mono,monospace">' + years[i] + "</text>";
    });
    return '<svg class="accchart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="每年事故件數">' + out + "</svg>";
  }

  function brand() {
    return '<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" rx="3" fill="var(--asphalt)"/><rect x="5" y="11" width="18" height="2" fill="var(--marking)"/><rect x="5" y="15" width="18" height="2" fill="var(--marking)"/><circle cx="20" cy="8" r="3" fill="var(--storm)" stroke="var(--surface)" stroke-width="1.2"/></svg>';
  }

  window.SVGKit = { weather: weather, avatar: avatar, mini: mini, ring24: ring24, accBars: accBars, brand: brand, userColor: userColor, cssVar: cssVar };
})();
