/*
 * app.js: boot, the three document listeners, tile loading and geolocation (docs/ui-contract.md
 * §1, §3, §4, §6, §7). Loaded last. The only file that touches document or window, and only
 * after DOMContentLoaded. It changes S only through POD.state, and draws only through POD.ui.render.
 */
(function (root) {
  "use strict";

  var POD = root.POD;

  // Page-only flags (not saved): see ui-contract §3 and §6.
  var view = { moreStores: false, geoError: false, loading: false, canLocate: false, mcError: false, vin: "", vinMsg: "" };
  var requested = {};   // tile cells asked for in this page load
  var pending = 0;      // tile scripts in flight
  var storage = null;
  var wired = false;
  var CREDIT_PLATS = ["direct", "dd", "ue", "gh"];
  var inflight = {};    // D-040: Worker asks on their way, by kind + ":" + key (api contract §6.1)

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function safeStorage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function canLocate() {
    var g = window.navigator && window.navigator.geolocation;
    return !!(g && typeof g.getCurrentPosition === "function");
  }

  function derive() {
    return POD.state.derive(POD.S, POD.data, new Date(), POD.opts);
  }

  function ctx() {
    return { S: POD.S, D: POD.data, opts: POD.opts, view: view, now: new Date() };
  }

  // ---- tiles (§4) -------------------------------------------------------------------------------

  function settle() {
    pending--;
    if (pending === 0) { afterChange(derive()); }
  }

  function addScript(cell, src) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = function () {
      if (!(POD.data.TILES && hasOwn(POD.data.TILES, cell))) { POD.opts.failed[cell] = true; }
      settle();
    };
    s.onerror = function () {
      POD.opts.failed[cell] = true;
      settle();
    };
    (document.head || document.body).appendChild(s);
  }

  function loadCells(cells) {
    if (!cells || !cells.length) { return; }
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (hasOwn(requested, cell) || POD.opts.failed[cell] === true) { continue; }
      requested[cell] = true;
      var path = POD.geo.tilePath(cell);
      if (!path) { POD.opts.failed[cell] = true; continue; }
      pending++;
      addScript(cell, path + "?v=" + encodeURIComponent(POD.data.BRANDS_RUN));
    }
  }

  // ---- the one path after every change (§3) -----------------------------------------------------

  var TABLE_OF = { drive: "drive", geocode: "geo", nearby: "nearby" };

  /** True when the answer to an ask is already stored under its key (a synchronous answer may have come first). */
  function storedAlready(ask) {
    var table = POD.opts.api[TABLE_OF[ask.kind]];
    return hasOwn(table, ask.key);
  }

  /** Sends each Worker ask not already in flight or stored. Nothing waits for an answer (ui-contract §3, D-040). */
  function sendAsks() {
    var list = POD.api.asks(POD.S, POD.data, POD.opts);
    for (var i = 0; i < list.length; i++) {
      var ask = list[i];
      var mark = ask.kind + ":" + ask.key;
      if (hasOwn(inflight, mark) || storedAlready(ask)) { continue; }
      inflight[mark] = true;
      if (!POD.api.send(ask, answered(ask, mark))) { delete inflight[mark]; }
    }
  }

  /** The answer to one ask: clear its mark, remember it under its key, then run the same path as a change. */
  function answered(ask, mark) {
    return function (value) {
      delete inflight[mark];
      POD.api.remember(POD.data, POD.opts, ask, value);
      afterChange(derive());
    };
  }

  function afterChange(status) {
    if (status && status.status === "need") { loadCells(status.need); }
    var S = POD.S;
    if (S.pos) {
      var near = POD.geo.storesNear(S.pos.lat, S.pos.lon, POD.data, POD.opts);
      if (near && near.status === "need") { loadCells(near.need); }
    }
    if (POD.opts && POD.opts.api) { sendAsks(); }
    POD.state.save(S, storage);
    view.loading = pending > 0;
    POD.ui.render(ctx());
  }

  // ---- boot (§1) --------------------------------------------------------------------------------

  function start() {
    storage = safeStorage();
    POD.opts = { failed: {} };
    requested = {};
    POD.S = POD.state.load(storage, POD.data, new Date(), POD.opts);
    // D-040: a saved independent prices again even with the Worker off (ui-contract §1).
    POD.data.PLACES = POD.data.PLACES || {};
    var place = POD.S.place;
    if (place && !hasOwn(POD.data.PLACES, place.id)) {
      POD.data.PLACES[place.id] = { name: place.name, category: place.category, lat: place.lat, lon: place.lon };
    }
    if (POD.api.enabled()) { POD.opts.api = { drive: {}, geo: {}, nearby: {} }; }
    view.canLocate = canLocate();
    afterChange(derive());
  }

  // ---- reading controls (§3) --------------------------------------------------------------------

  function parseValue(el) {
    if (el.type === "checkbox") { return el.checked; }
    if (el.getAttribute("data-type") === "text") { return el.value; }
    var s = String(el.value).trim();
    if (s === "") { return null; }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value) : "";
  }

  function addCredit(now) {
    var plats = [];
    for (var k = 0; k < CREDIT_PLATS.length; k++) {
      var box = document.getElementById("mc-plat-" + CREDIT_PLATS[k]);
      if (box && box.checked) { plats.push(CREDIT_PLATS[k]); }
    }
    if (plats.length === 0) { view.mcError = true; return; }
    var key = POD.state.addManualCredit(POD.S, POD.data, {
      name: fieldValue("mc-name").trim(),
      amount: parseFloat(fieldValue("mc-amount")),
      cadence: fieldValue("mc-cadence") || "once",
      plats: plats
    }, now);
    view.mcError = key === null;
    if (key !== null) { clearCreditForm(); }
  }

  /** A saved credit empties the form, so the next click on "Add credit" is checked again. */
  function clearCreditForm() {
    var name = document.getElementById("mc-name"), amount = document.getElementById("mc-amount");
    var cadence = document.getElementById("mc-cadence");
    if (name) { name.value = ""; }
    if (amount) { amount.value = ""; }
    if (cadence) { cadence.value = "once"; }
    for (var k = 0; k < CREDIT_PLATS.length; k++) {
      var box = document.getElementById("mc-plat-" + CREDIT_PLATS[k]);
      if (box) { box.checked = false; }
    }
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute) { return; }
    var S = POD.S, D = POD.data, opts = POD.opts;
    var bind = el.getAttribute("data-bind");
    var before = stateKey();
    if (bind) {
      view.mcError = false;
      POD.state.setPath(S, bind, parseValue(el));
      clearGeoIfChanged(before);
      afterChange(derive());
      return;
    }
    var action = el.getAttribute("data-action");
    if (!action) { return; }
    var now = new Date();
    view.mcError = false;
    switch (action) {
      case "address": POD.state.setAddress(S, D, el.value, opts); break;
      case "brand": POD.state.setBrand(S, D, el.value === "" ? null : el.value, opts); break;
      case "make": vinSeq++; POD.state.setCar(S, D, el.value, "", null); view.vinMsg = ""; break;
      case "model": vinSeq++; POD.state.setCar(S, D, S.make, el.value, S.year); view.vinMsg = ""; break;
      case "year":
        vinSeq++;
        POD.state.setCar(S, D, S.make, S.model, el.value === "" ? null : parseInt(el.value, 10));
        view.vinMsg = "";
        break;
      case "toggle-card": POD.state.toggleCard(S, D, el.getAttribute("data-card"), el.checked, now); break;
      case "opt-in": POD.state.setOptIn(S, D, el.getAttribute("data-key"), el.checked, now); break;
      case "used": POD.state.markUsed(S, D, el.getAttribute("data-key"), el.checked, now); break;
      default: return;
    }
    clearGeoIfChanged(before);
    afterChange(derive());
  }

  function onInput() {
    // Nothing commits while typing; values commit on change (ui-contract §3).
  }

  // ---- geolocation (§6) -------------------------------------------------------------------------

  /** The geolocation message stays until the next state change (ui-contract §6), not any click. */
  function stateKey() { return JSON.stringify(POD.S); }

  function clearGeoIfChanged(before) {
    if (stateKey() !== before) { view.geoError = false; }
  }

  function locate() {
    view.geoError = false;
    var g = window.navigator && window.navigator.geolocation;
    if (!g || typeof g.getCurrentPosition !== "function") {
      view.geoError = true;
      afterChange(null);
      return;
    }
    g.getCurrentPosition(function (p) {
      view.geoError = false;
      afterChange(POD.state.setPosition(POD.S, POD.data, p.coords.latitude, p.coords.longitude, POD.opts));
    }, function () {
      view.geoError = true;
      afterChange(null);
    }, { timeout: 10000, maximumAge: 600000 });
  }

  // ---- the first-visit example (§7) -------------------------------------------------------------

  function runExample() {
    var S = POD.S, D = POD.data, opts = POD.opts;
    vinSeq++;          // the latest action wins (ui-contract §6b): a pending VIN answer can't land after this
    view.vinMsg = "";
    POD.state.setAddress(S, D, "10118", opts);
    POD.state.setCar(S, D, "Toyota", "Camry");
    POD.state.setBrand(S, D, "dominos", opts);
    POD.state.setQty(S, 0, 1);
  }

  // ---- the VIN lookup (D-038, ui-contract §6b) --------------------------------------------------

  var VIN_CHECK_MSG = {
    length: "A VIN has 17 letters and digits.",
    chars: "A VIN uses only digits and the letters A–Z except I, O and Q.",
    digit: "That VIN's check digit (its 9th character) doesn't match: check for a typo."
  };
  var VIN_FAIL = "Couldn't reach NHTSA's VIN decoder. Pick your car below.";
  var VIN_TIMEOUT_MS = 10000;
  var vinSeq = 0;   // the latest lookup's number; an older answer is ignored

  function drawOnly() { POD.ui.render(ctx()); }

  function vinFail() {
    view.vinMsg = VIN_FAIL;
    drawOnly();
  }

  /** Applies vPIC's answer to the car: POD.state.setCar, then the message (§6b). */
  function vinApply(body) {
    var dec = POD.vin.decode(body);
    if (dec === null) {
      view.vinMsg = "NHTSA couldn't decode that VIN. Pick your car below.";
      drawOnly();
      return;
    }
    var m = POD.vin.match(dec, POD.data);
    if (m === null) { vinFail(); return; }
    POD.state.setCar(POD.S, POD.data, m.make, m.model, m.year);
    var car = dec.year + " " + dec.make + " " + dec.model;
    if (m.make === "Other") {
      view.vinMsg = "NHTSA says " + car + ". That make isn't in the EPA list: enter its fuel and mpg below.";
    } else if (m.model === "") {
      view.vinMsg = "NHTSA says " + car + ". Pick the model below: EPA's list names it differently.";
    } else if (POD.state.carLookup(POD.data, m.make, m.model, m.year) === null) {
      view.vinMsg = "NHTSA says " + car + ". EPA's list has no " + dec.year + " figure for it: enter its mpg below.";
    } else {
      view.vinMsg = "NHTSA says " + car + ".";
    }
    afterChange(derive());
  }

  function vinLookup() {
    var el = document.getElementById("vin");
    var v = POD.vin.clean(el ? String(el.value) : "");
    var seq = ++vinSeq;
    view.vin = v;
    var c = POD.vin.check(v);
    if (c !== "ok") {
      view.vinMsg = VIN_CHECK_MSG[c];
      drawOnly();
      return;
    }
    view.vinMsg = "Looking up " + v + " with NHTSA…";
    drawOnly();
    if (!window.XMLHttpRequest) { vinFail(); return; }
    var xhr;
    try {
      xhr = new XMLHttpRequest();
      xhr.open("GET", POD.vin.url(v), true);
      xhr.timeout = VIN_TIMEOUT_MS;
      xhr.onload = function () {
        if (seq !== vinSeq) { return; }
        if (xhr.status !== 200) { vinFail(); return; }
        var body;
        try { body = JSON.parse(xhr.responseText); } catch (e) { vinFail(); return; }
        vinApply(body);
      };
      xhr.onerror = function () { if (seq === vinSeq) { vinFail(); } };
      xhr.ontimeout = function () { if (seq === vinSeq) { vinFail(); } };
      xhr.send();
    } catch (e2) {
      vinFail();
    }
  }

  // ---- clicks (§3) ------------------------------------------------------------------------------

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var el = t.closest("[data-action]");
    if (!el) { return; }
    var action = el.getAttribute("data-action");
    if (action === "locate") { view.mcError = false; locate(); return; }
    if (action === "vin") { vinLookup(); return; }

    var S = POD.S, D = POD.data, opts = POD.opts;
    var now = new Date();
    var i, cur, store, row;
    var before = stateKey();
    view.mcError = false;
    switch (action) {
      case "example": runExample(); break;
      case "pick-store":
        store = POD.ui.storeAt(parseInt(el.getAttribute("data-store"), 10));
        if (!store) { return; }
        POD.state.pickStore(S, D, store, opts);
        break;
      case "pick-place":
        row = POD.ui.placeAt(parseInt(el.getAttribute("data-place"), 10));
        if (!row) { return; }
        POD.state.pickStore(S, D, row, opts);
        break;
      case "qty":
        i = parseInt(el.getAttribute("data-index"), 10);
        cur = S.cart && hasOwn(S.cart, String(i)) ? S.cart[String(i)] : 0;
        POD.state.setQty(S, i, Math.max(0, cur + parseInt(el.getAttribute("data-delta"), 10)));
        break;
      case "pin":
        var pin = document.getElementById("pinMiles");
        POD.state.pinMiles(S, pin ? parseFloat(pin.value) : NaN);
        break;
      case "unpin": POD.state.unpinMiles(S, D, opts); break;
      case "add-credit": addCredit(now); break;
      case "remove-credit": POD.state.removeManualCredit(S, D, el.getAttribute("data-key"), now); break;
      case "more-stores": view.moreStores = true; break;
      default: return;
    }
    clearGeoIfChanged(before);
    afterChange(derive());
  }

  // ---- wiring -----------------------------------------------------------------------------------

  function wire() {
    if (wired) { return; }
    wired = true;
    document.addEventListener("change", onChange);
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
  }

  POD.boot = function () {
    wire();
    start();
  };

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", POD.boot);
    } else {
      POD.boot();
    }
  }
})(typeof window !== "undefined" ? window : this);
