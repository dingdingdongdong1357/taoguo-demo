/* 在 LINE 裡開啟（LIFF）。
   LIFF_ID 留空時什麼都不做，網頁照原本運作；填入 LINE Developers 產生的 LIFF ID 後：
   - 在 LINE 裡打開時，回報小幫手會用 LINE 暱稱打招呼
   - 同一個 LINE 帳號、同一個路口只計一次（Demo：記在這支手機的瀏覽器裡，不會送出）
   LIFF ID 本來就會出現在分享網址裡，不是密碼；Channel secret 不要放進這裡。 */
(function () {
  var LIFF_ID = "2012488021-mmps29vH";  // 例如 "2001234567-AbCdEfGh"

  var T = window.TaoguoLINE = { user: null, inClient: false, enabled: false, ready: Promise.resolve() };
  var KEY = "taoguo:reported:";
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  T.key = function (loc, mode) { return T.user ? KEY + T.user.id + ":" + loc + ":" + mode : null; };
  T.has = function (loc, mode) { var k = T.key(loc, mode), s = store(); try { return !!(k && s && s.getItem(k)); } catch (e) { return false; } };
  T.mark = function (loc, mode) { var k = T.key(loc, mode), s = store(); try { if (k && s) s.setItem(k, String(Date.now())); } catch (e) {} };

  if (!LIFF_ID || !window.liff) return;
  T.enabled = true;
  T.ready = window.liff.init({ liffId: LIFF_ID }).then(function () {
    T.inClient = window.liff.isInClient();
    if (!window.liff.isLoggedIn()) return null;  // 在一般瀏覽器開啟時不強迫登入
    return window.liff.getProfile();
  }).then(function (p) {
    if (p) T.user = { id: p.userId, name: p.displayName };
    document.documentElement.dataset.line = T.inClient ? "client" : "browser";
  }).catch(function (e) { console.warn("LIFF 初始化失敗，改用一般網頁模式：", e); });
})();
