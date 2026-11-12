/*
 * pod.js — the POD namespace and tiny shared helpers.
 *
 * Every file in src/ follows the same pattern:
 *   - ES5 only (enforced by tools/es5-check.js)
 *   - wrapped in an IIFE that receives the global object
 *   - attaches to the single POD namespace, never to bare globals
 *   - touches no DOM at load time (tests load every script in a DOM-less VM)
 *
 * Load order is defined once, by the <script> tags in index.html.
 * tests/helpers/load.js reads that same list, so Node tests and the browser
 * always see the same code in the same order.
 */
(function (root) {
  "use strict";

  var POD = root.POD = root.POD || {};

  POD.VERSION = "0.5.0";
  POD.STORAGE_KEY = "pod.v5";

  // Sub-namespaces filled in by later files.
  POD.data = POD.data || {};
  POD.util = POD.util || {};

  /** Round to cents. All money comparisons in the app and tests use this. */
  POD.util.round2 = function (n) {
    return Math.round((n + (n < 0 ? -1e-9 : 1e-9)) * 100) / 100;
  };

  /** "$1,234.56" — negative values render as "−$1.23" (true minus sign). */
  POD.util.money = function (n) {
    var v = POD.util.round2(Math.abs(n)).toFixed(2);
    var parts = v.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (n < 0 ? "−$" : "$") + parts.join(".");
  };

  /** Clamp n into [lo, hi]. */
  POD.util.clamp = function (n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
  };
})(typeof window !== "undefined" ? window : this);
