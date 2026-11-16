/*
 * config.js: the page's settings (api contract §6). apiBase "" is the committed value: the Worker is off.
 * Deploying the Worker means setting apiBase here (api contract §9). Loads right after pod.js. No DOM. ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  POD.config = POD.config || {};
  if (typeof POD.config.apiBase !== "string") { POD.config.apiBase = ""; }
})(typeof window !== "undefined" ? window : this);
