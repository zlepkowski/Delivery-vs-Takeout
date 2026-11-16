/*
 * api.js: POD.api, the browser seam to the optional Worker (docs/api-contract.md §6, D-040).
 * The pure functions read only their arguments and never throw: bad input gives null (asks and placesFor give []).
 * enabled() reads POD.config; remember() writes only the opts and D it is given; send() makes one XMLHttpRequest.
 * With the Worker off (apiBase ""), nothing here makes a request. No DOM. ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  var NEARBY_RADII = [2, 5, 10];
  var NEARBY_WANT = 10;
  var NEARBY_SHOW = 10;
  var TIMEOUT_MS = 4000;
  var NEARBY_TIMEOUT_MS = 10000;
  var CATEGORIES = ["pizza", "burger", "chicken", "mexican", "sandwich", "asian", "coffee", "dessert", "casual", "other"];
  var PLACE_ID = /^osm:[nwr][1-9][0-9]{0,15}$/;
  var WARN_TEXT = "Pickup or Delivery: the map server didn't answer, so built-in estimates are used.";
  var warned = false;                                             // one console.warn per page load (§6.3)

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isStr(x) { return typeof x === "string"; }
  function isLatLon(lat, lon) {
    return isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  function pad3(n) {
    var s = String(n);
    while (s.length < 3) { s = "0" + s; }
    return s;
  }
  function isNameLen(s) { return isStr(s) && s.length >= 1 && s.length <= 120; }

  // ---- keys and text (§6) ------------------------------------------------------

  /** fmt3(x): x to three decimals, by integer arithmetic on k = round(x * 1000). null unless finite. */
  function fmt3(x) {
    if (!isNum(x)) { return null; }
    var k = Math.round(x * 1000);
    var neg = k < 0;
    var a = neg ? -k : k;
    return (neg ? "-" : "") + String(Math.floor(a / 1000)) + "." + pad3(a % 1000);
  }

  /** "lat,lon" in fmt3 form, or null unless both are finite and in range. */
  function point(lat, lon) {
    if (!isLatLon(lat, lon)) { return null; }
    return fmt3(lat) + "," + fmt3(lon);
  }

  /** point of an object with lat and lon, or null. */
  function pointOf(o) {
    return isObj(o) ? point(o.lat, o.lon) : null;
  }

  function driveKey(pos, store) {
    var a = pointOf(pos);
    var b = pointOf(store);
    return a === null || b === null ? null : a + ";" + b;
  }

  /** The trimmed, collapsed address when it's 3-200 characters with no control character and a letter; else null. */
  function geoQuery(text) {
    if (!isStr(text)) { return null; }
    var s = text.trim().replace(/\s+/g, " ");
    if (s.length < 3 || s.length > 200) { return null; }
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) < 32) { return null; }
    }
    if (!/[A-Za-z]/.test(s)) { return null; }
    return s;
  }

  function geoKey(text) {
    var q = geoQuery(text);
    return q === null ? null : q.toLowerCase();
  }

  function nearbyKey(pos, r) {
    var p = pointOf(pos);
    return p === null ? null : p + "/" + r;
  }

  function nameKey(s) {
    if (!isStr(s)) { return null; }
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // ---- checks of the Worker's answers (§6) -------------------------------------

  function checkDrive(b) {
    if (!isObj(b) || !isNum(b.miles) || b.miles < 0 || b.miles > 1000 || !isNum(b.minutes) || b.minutes < 0) {
      return null;
    }
    return { miles: b.miles, minutes: b.minutes };
  }

  function checkGeocode(b) {
    if (!isObj(b) || !isLatLon(b.lat, b.lon)) { return null; }
    var zip = b.zip;
    var state = b.state;
    if (!(zip === null || (isStr(zip) && /^[0-9]{5}$/.test(zip)))) { return null; }
    if (!(state === null || (isStr(state) && /^[A-Z]{2}$/.test(state)))) { return null; }
    return { lat: b.lat, lon: b.lon, zip: zip, state: state };
  }

  function checkNearby(b) {
    if (!isObj(b) || !Array.isArray(b.places)) { return null; }
    var out = [];
    for (var i = 0; i < b.places.length; i++) {
      var p = b.places[i];
      if (isObj(p) && isStr(p.id) && PLACE_ID.test(p.id) && isNameLen(p.name) &&
          isStr(p.category) && CATEGORIES.indexOf(p.category) >= 0 && isLatLon(p.lat, p.lon)) {
        out.push({ id: p.id, name: p.name, category: p.category, lat: p.lat, lon: p.lon });
      }
    }
    return { places: out };
  }

  // ---- enabled, asks, placesFor (§6, §6.1, §6.2) -------------------------------

  /** True iff POD.config.apiBase is an http(s) URL string. Reads POD.config only. */
  function enabled() {
    var c = POD.config;
    return isObj(c) && isStr(c.apiBase) && /^https?:\/\/[^\s]+$/.test(c.apiBase);
  }

  /** opts.api when opts is an object and api has object drive, geo and nearby fields; else null. */
  function fullApi(opts) {
    var api = isObj(opts) ? opts.api : null;
    if (!isObj(api) || !isObj(api.drive) || !isObj(api.geo) || !isObj(api.nearby)) { return null; }
    return api;
  }

  function isGpsPos(p) { return isObj(p) && p.src === "gps"; }

  /** The requests the page should send now (§6.1), in order. */
  function asks(S, D, opts) {
    var api = fullApi(opts);
    if (api === null || !isObj(S)) { return []; }
    var out = [];
    var k, i, r, v;
    if (!isGpsPos(S.pos)) {
      k = geoKey(S.address);
      if (k !== null && !hasOwn(api.geo, k)) {
        out.push({ kind: "geocode", key: k, q: geoQuery(S.address) });
      }
    }
    if (S.milesSrc === "store") {
      k = driveKey(S.pos, S.store);
      if (k !== null && !hasOwn(api.drive, k)) {
        out.push({ kind: "drive", key: k, from: pointOf(S.pos), to: pointOf(S.store) });
      }
    }
    if (pointOf(S.pos) !== null) {
      for (i = 0; i < NEARBY_RADII.length; i++) {
        r = NEARBY_RADII[i];
        k = nearbyKey(S.pos, r);
        if (!hasOwn(api.nearby, k)) {
          out.push({ kind: "nearby", key: k, lat: fmt3(S.pos.lat), lon: fmt3(S.pos.lon), radius: r });
          break;
        }
        v = api.nearby[k];
        if (v === false) { break; }
        if (isObj(v) && Array.isArray(v.places) && v.places.length >= NEARBY_WANT) { break; }
      }
    }
    return out;
  }

  /** The independent rows to show (§6.2): the largest radius that answered, minus chains, nearest first. */
  function placesFor(S, D, opts) {
    var api = isObj(opts) ? opts.api : null;
    if (!isObj(api) || !isObj(api.nearby) || !isObj(S) || pointOf(S.pos) === null) { return []; }
    var ans = null;
    var i, k;
    for (i = NEARBY_RADII.length - 1; i >= 0; i--) {
      k = nearbyKey(S.pos, NEARBY_RADII[i]);
      if (hasOwn(api.nearby, k) && isObj(api.nearby[k])) { ans = api.nearby[k]; break; }
    }
    if (ans === null || !Array.isArray(ans.places)) { return []; }
    var chains = {};
    var brands = isObj(D) && isObj(D.BRANDS) ? D.BRANDS : {};
    for (k in brands) {
      if (hasOwn(brands, k) && isObj(brands[k]) && nameKey(brands[k].name) !== null) {
        chains[nameKey(brands[k].name)] = true;
      }
    }
    var rows = [];
    for (i = 0; i < ans.places.length; i++) {
      var p = ans.places[i];
      if (!isObj(p) || !isStr(p.id) || !isNameLen(p.name) || !isLatLon(p.lat, p.lon)) { continue; }
      if (hasOwn(chains, nameKey(p.name))) { continue; }
      var mi = POD.geo.distMi(S.pos.lat, S.pos.lon, p.lat, p.lon);
      rows.push({
        brand: p.id, id: p.id + "@" + point(p.lat, p.lon), name: p.name, category: p.category,
        lat: p.lat, lon: p.lon, mi: mi, profiled: false
      });
    }
    rows.sort(function (a, b) {
      if (a.mi !== b.mi) { return a.mi < b.mi ? -1 : 1; }
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return rows.slice(0, NEARBY_SHOW);
  }

  // ---- remember and send (§6.3) ------------------------------------------------

  var CACHE_OF = { drive: "drive", geocode: "geo", nearby: "nearby" };

  /** Stores an answer under the key it was asked with; a nearby answer's places go into D.PLACES. */
  function remember(D, opts, ask, value) {
    var api = isObj(opts) ? opts.api : null;
    if (!isObj(api) || !isObj(ask) || !hasOwn(CACHE_OF, ask.kind) || !isStr(ask.key)) { return; }
    var cache = api[CACHE_OF[ask.kind]];
    if (!isObj(cache)) { return; }
    var v = value === null || value === undefined ? false : value;
    // §6.3: an own property, so a key such as "__proto__" never replaces the table's prototype
    Object.defineProperty(cache, ask.key, { value: v, enumerable: true, writable: true, configurable: true });
    if (ask.kind !== "nearby" || !isObj(v) || !Array.isArray(v.places) || !isObj(D)) { return; }
    if (!isObj(D.PLACES)) { D.PLACES = {}; }
    for (var i = 0; i < v.places.length; i++) {
      var p = v.places[i];
      if (isObj(p) && isStr(p.id) && !hasOwn(D.PLACES, p.id)) {
        D.PLACES[p.id] = { name: p.name, category: p.category, lat: p.lat, lon: p.lon };
      }
    }
  }

  /** The request URL for an ask, or null when the ask is malformed. */
  function urlFor(base, ask) {
    var q = encodeURIComponent;
    if (ask.kind === "drive") {
      if (!isStr(ask.from) || !isStr(ask.to)) { return null; }
      return base + "/drive?from=" + q(ask.from) + "&to=" + q(ask.to);
    }
    if (ask.kind === "geocode") {
      if (!isStr(ask.q)) { return null; }
      return base + "/geocode?q=" + q(ask.q);
    }
    if (ask.kind === "nearby") {
      if (!isStr(ask.lat) || !isStr(ask.lon) || !isNum(ask.radius)) { return null; }
      return base + "/nearby?lat=" + q(ask.lat) + "&lon=" + q(ask.lon) + "&radius=" + q(String(ask.radius));
    }
    return null;
  }

  function checkerFor(kind) {
    if (kind === "drive") { return checkDrive; }
    if (kind === "geocode") { return checkGeocode; }
    if (kind === "nearby") { return checkNearby; }
    return null;
  }

  /** Calls cb with the checked answer, or null; the first null of a page load logs one warning. */
  function answerWith(cb, value) {
    if (value === null && !warned) {
      warned = true;
      if (typeof console !== "undefined" && typeof console.warn === "function") { console.warn(WARN_TEXT); }
    }
    cb(value);
  }

  /** One GET to the Worker. false and no request when the seam is off or the ask is unknown. */
  function send(ask, cb) {
    if (!enabled() || !isObj(ask)) { return false; }
    var check = checkerFor(ask.kind);
    var base = POD.config.apiBase.replace(/\/$/, "");
    var url = check === null ? null : urlFor(base, ask);
    if (url === null) { return false; }
    var done = false;
    function finish(body) {
      if (done) { return; }
      done = true;
      answerWith(cb, body);
    }
    try {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.timeout = ask.kind === "nearby" ? NEARBY_TIMEOUT_MS : TIMEOUT_MS;
      x.onload = function () {
        var parsed = null;
        if (x.status === 200) {
          try { parsed = JSON.parse(x.responseText); } catch (e) { parsed = null; }
        }
        finish(parsed === null ? null : check(parsed));
      };
      x.onerror = function () { finish(null); };
      x.ontimeout = function () { finish(null); };
      x.send(null);
    } catch (e) {
      finish(null);
    }
    return true;
  }

  POD.api = {
    NEARBY_RADII: NEARBY_RADII,
    NEARBY_WANT: NEARBY_WANT,
    NEARBY_SHOW: NEARBY_SHOW,
    TIMEOUT_MS: TIMEOUT_MS,
    NEARBY_TIMEOUT_MS: NEARBY_TIMEOUT_MS,
    enabled: enabled,
    fmt3: fmt3,
    point: point,
    driveKey: driveKey,
    geoQuery: geoQuery,
    geoKey: geoKey,
    nearbyKey: nearbyKey,
    nameKey: nameKey,
    checkDrive: checkDrive,
    checkGeocode: checkGeocode,
    checkNearby: checkNearby,
    asks: asks,
    placesFor: placesFor,
    remember: remember,
    send: send
  };
})(typeof window !== "undefined" ? window : this);
