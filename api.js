/* =============================================================================
   Villa Siesta · api.js — the single data layer between the site and the backend
   =============================================================================
   Today the backend is a Google Apps Script Web App reading a Google Sheet.
   Because Apps Script responses can't be read cross-origin with a normal fetch,
   the GET calls (availability + pricing) use JSONP, and the booking POST is sent
   with mode:'no-cors'. See README.md → "How it talks to the backend".

   THIS is the seam to swap later. To move to Next.js + Supabase (see README
   "Upgrade path"), you only rewrite the three methods below — load(),
   submitBooking(), and endpoint() — to hit real JSON/CORS endpoints, and the
   rest of the site keeps working unchanged.
   ========================================================================== */
(function (window) {
  'use strict';

  // 🔌 Paste your deployed Web App /exec URL here (or set CONFIG.webAppUrl in
  //    index.html — either works; this one wins if both are set).
  const WEBAPP_URL = "";

  const JSONP_TIMEOUT_MS = 8000;
  let _seq = 0;

  function endpoint() {
    const fromConfig = (window.CONFIG && window.CONFIG.webAppUrl) || "";
    return (WEBAPP_URL || fromConfig || "").trim();
  }

  // ---- JSONP: load <script src="…&callback=fn"> and resolve with the payload ----
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      const base = endpoint();
      if (!base) { reject(new Error('No Web App URL configured')); return; }

      const cb = '__vs_jsonp_' + (Date.now ? '' : '') + (++_seq) + '_' + Math.floor(performance.now());
      const qs = Object.keys(params)
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      const url = base + (base.indexOf('?') === -1 ? '?' : '&') + qs + '&callback=' + cb;

      const script = document.createElement('script');
      let done = false;

      const cleanup = function () {
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        clearTimeout(timer);
      };
      const timer = setTimeout(function () {
        if (done) return; done = true; cleanup();
        reject(new Error('JSONP timeout: ' + params.route));
      }, JSONP_TIMEOUT_MS);

      window[cb] = function (data) {
        if (done) return; done = true; cleanup(); resolve(data);
      };
      script.onerror = function () {
        if (done) return; done = true; cleanup();
        reject(new Error('JSONP network error: ' + params.route));
      };
      script.src = url;
      document.head.appendChild(script);
    });
  }

  // ---- Public: fetch availability + pricing together ----
  function load() {
    return Promise.all([
      jsonp({ route: 'pricing' }).catch(function () { return null; }),
      jsonp({ route: 'availability' }).catch(function () { return null; })
    ]).then(function (res) {
      return { pricing: res[0], availability: res[1] };
    });
  }

  // ---- Public: submit a booking request (no-cors POST; response is opaque) ----
  function submitBooking(data) {
    const base = endpoint();
    if (!base) return Promise.reject(new Error('No Web App URL configured'));
    const body = new URLSearchParams();
    body.set('route', 'book');
    Object.keys(data || {}).forEach(function (k) { body.set(k, data[k]); });
    // no-cors: the browser sends it but hides the response — that's fine, the
    // Apps Script logs the row and emails everyone server-side.
    return fetch(base, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString()
    });
  }

  // ---- Small helper: ISO → "2:14 PM" (local) ----
  function timeLabel(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  window.VillaSiestaAPI = {
    endpoint: endpoint,
    load: load,
    submitBooking: submitBooking,
    timeLabel: timeLabel
  };
})(window);
