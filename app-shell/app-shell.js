// App-only behavior, linked into every page by scripts/build-web.mjs. Does nothing in a normal browser.
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  document.documentElement.classList.add('in-app');
  var App = (C.Plugins && C.Plugins.App) || (C.registerPlugin && C.registerPlugin('App'));
  if (!App) return;

  var page = location.pathname.split('/').pop() || 'index.html';
  console.log('app-shell ready ' + page); // the CI smoke test looks for this line in logcat
  var $ = function (id) { return document.getElementById(id); };
  var open = function (el) { return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; };
  // Dispatched on body (not document) because the pages' key handlers call event.target.closest().
  var esc = function () { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); };

  // Android back button: close whatever is open first, then go back to the library, then leave the app.
  App.addListener('backButton', function () {
    if (page === 'hexhaven.html') {
      // A Hexhaven dialog mid-game (discard, steal, monopoly) is waiting for a choice, so leave it open.
      if (open($('overlay'))) { if (typeof G !== 'undefined' && G.phase === 'over') closeModal(); return; }
      if (typeof G !== 'undefined' && (G.sheet || (G.mode && G.mode !== 'freeRoad'))) { esc(); return; }
    } else if (open($('overlay'))) {
      if (page === 'index.html') esc(); else $('overlay').hidden = true;
      return;
    }
    if (page === 'index.html') {
      var f = $('filters');
      if (f && f.classList.contains('open')) { $('fbtn').click(); return; }
      App.exitApp();
      return;
    }
    if (confirm('Leave this game and go back to the library?')) location.href = 'index.html';
  });
})();
