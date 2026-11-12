/*
 * app.js — boot. Loaded last. The only file allowed to schedule DOM work,
 * and it does so only after DOMContentLoaded.
 *
 * Phase 0: renders a placeholder so the e2e smoke test has something to
 * assert. Phase 5 replaces boot() with the real render pipeline.
 */
(function (root) {
  "use strict";

  var POD = root.POD;

  function boot() {
    var el = document.getElementById("app");
    if (!el) { return; }
    el.innerHTML =
      '<section class="placeholder" data-testid="placeholder">' +
      "<h2>Under construction</h2>" +
      "<p>The pricing engine, restaurant finder and wallet arrive in later phases. " +
      "See <code>docs/progress.md</code>.</p>" +
      '<p class="muted">v' + POD.VERSION + "</p>" +
      "</section>";
  }

  POD.boot = boot;

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(typeof window !== "undefined" ? window : this);
