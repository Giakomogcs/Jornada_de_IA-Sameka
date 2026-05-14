(function () {
        function c() {
          var s = {};
          var proto = {
            getItem: function (k) {
              return s.hasOwnProperty(k) ? s[k] : null;
            },
            setItem: function (k, v) {
              s[k] = String(v);
            },
            removeItem: function (k) {
              delete s[k];
            },
            clear: function () {
              for (var p in s) delete s[p];
            },
            get length() {
              return Object.keys(s).length;
            },
            key: function (i) {
              return Object.keys(s)[i] || null;
            },
          };
          return proto;
        }

        var needsSession = false;
        var needsLocal = false;
        try {
          var _t = window.sessionStorage;
          if (!_t || !_t.setItem) needsSession = true;
        } catch (e) {
          needsSession = true;
        }
        try {
          var _t2 = window.localStorage;
          if (!_t2 || !_t2.setItem) needsLocal = true;
        } catch (e) {
          needsLocal = true;
        }

        if (needsSession) {
          try {
            Object.defineProperty(window, "sessionStorage", {
              value: c(),
              writable: false,
              configurable: true,
            });
          } catch (e) {}
        }
        if (needsLocal) {
          try {
            Object.defineProperty(window, "localStorage", {
              value: c(),
              writable: false,
              configurable: true,
            });
          } catch (e) {}
        }
        var nr = function (_n, _o, cb) {
          if (typeof _o === "function") cb = _o;
          return Promise.resolve(cb({ name: _n, mode: "exclusive" }));
        };
        try {
          Object.defineProperty(navigator, "locks", {
            value: {
              request: nr,
              query: function () {
                return Promise.resolve({ held: [], pending: [] });
              },
            },
            writable: true,
            configurable: true,
          });
        } catch (e) {
          try {
            navigator.locks = {
              request: nr,
              query: function () {
                return Promise.resolve({ held: [], pending: [] });
              },
            };
          } catch (e2) {}
        }
      })();
