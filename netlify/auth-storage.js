function buildAuthStorage() {
  try {
    var k = "__ls_probe__";
    localStorage.setItem(k, "1");
    if (localStorage.getItem(k) === "1") {
      localStorage.removeItem(k);
      return {
        getItem: function (key) {
          try {
            return localStorage.getItem(key);
          } catch (e) {
            return null;
          }
        },
        setItem: function (key, val) {
          try {
            localStorage.setItem(key, val);
          } catch (e) {}
        },
        removeItem: function (key) {
          try {
            localStorage.removeItem(key);
          } catch (e) {}
        },
      };
    }
  } catch (e) {}
  function setCookie(n, v, d) {
    var dt = new Date();
    dt.setTime(dt.getTime() + d * 864e5);
    document.cookie =
      n +
      "=" +
      encodeURIComponent(v) +
      "; expires=" +
      dt.toUTCString() +
      "; path=/; SameSite=Lax";
  }
  function getCookie(n) {
    var m = document.cookie.match(
      new RegExp(
        "(?:^|; )" +
          n.replace(/([.$?*|{}()\[\]\\/+^])/g, "\\$1") +
          "=([^;]*)",
      ),
    );
    return m ? decodeURIComponent(m[1]) : null;
  }
  function delCookie(n) {
    document.cookie =
      n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  }
  try {
    var ck = "__ck_probe__";
    setCookie(ck, "1", 1);
    if (getCookie(ck) === "1") {
      delCookie(ck);
      var CH = 3500;
      return {
        getItem: function (key) {
          var meta = getCookie(key + "__n");
          if (!meta) return getCookie(key);
          var n = parseInt(meta, 10),
            out = "";
          for (var i = 0; i < n; i++) {
            var part = getCookie(key + "__" + i);
            if (part == null) return null;
            out += part;
          }
          return out;
        },
        setItem: function (key, val) {
          if (val.length <= CH) {
            setCookie(key, val, 7);
            delCookie(key + "__n");
            return;
          }
          var n = Math.ceil(val.length / CH);
          setCookie(key + "__n", String(n), 7);
          for (var i = 0; i < n; i++)
            setCookie(key + "__" + i, val.slice(i * CH, (i + 1) * CH), 7);
          delCookie(key);
        },
        removeItem: function (key) {
          delCookie(key);
          var meta = getCookie(key + "__n");
          if (meta) {
            var n = parseInt(meta, 10);
            for (var i = 0; i < n; i++) delCookie(key + "__" + i);
            delCookie(key + "__n");
          }
        },
      };
    }
  } catch (e) {}
  var mem = {};
  return {
    getItem: function (k) {
      return k in mem ? mem[k] : null;
    },
    setItem: function (k, v) {
      mem[k] = String(v);
    },
    removeItem: function (k) {
      delete mem[k];
    },
  };
}
function diagnoseAuthStorage(storage, storageKey) {
  var safe = function (fn, fb) {
    try {
      return fn();
    } catch (e) {
      return fb;
    }
  };
  var raw = safe(function () {
    return storage.getItem(storageKey);
  }, null);
  var lsKeys = safe(function () {
    return Object.keys(localStorage);
  }, "blocked");
  var cookiesLen = safe(function () {
    return (document.cookie || "").length;
  }, "blocked (sandboxed)");
  var inIframe = window.top !== window.self;
  var sandboxed = cookiesLen === "blocked (sandboxed)";
}
window.buildAuthStorage = buildAuthStorage;
window.diagnoseAuthStorage = diagnoseAuthStorage;
