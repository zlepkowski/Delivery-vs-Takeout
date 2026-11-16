/*
 * state.js: POD.state, the page's state object S (docs/state-contract.md, D-031; it overrides BUILD.md §5).
 * Every function follows contract §0: it reads only its arguments (D, now, storage, opts), changes only S,
 * never throws, and never touches the global Date, POD.data or POD.S. The geography and engine calls go
 * through tryCall, which turns a throw into null. No DOM. ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  var APPS = ["dd", "ue", "gh"];                                   // §0
  var PLAT_IDS = ["direct", "dd", "ue", "gh"];                     // §5.3
  var FUELS = ["regular", "premium", "diesel", "ev"];              // §7
  var PROMO_TYPES = ["none", "percent", "dollar", "freedel", "bogo"];  // §8 (bogo: D-036)
  var CADENCES = ["monthly", "quarterly", "semiannual", "annual", "once"]; // §5.2
  var APP_NUMS = ["delFee", "svc", "svcMin", "memberSvc", "memberMin", "pickDisc"]; // §2, §8
  var APP_PATHS = ["markup", "delFee", "svc", "svcMin", "memberSvc", "memberMin", "pickDisc"]; // §7
  var APP_FLAGS = ["memberOwn", "cardMember"];                     // §8
  var PROMO_NUMS = ["value", "cap", "min"];                        // §8
  var SHARED_FEES = ["regFee", "smallMin", "smallFee"];            // §7
  var SAVED_SCALARS = ["address", "make", "model", "year", "fuel", "mpg", "miPerKwh", "kwh", "brand",
    "storePicked", "manualSubtotal", "dealOn", "miles", "speed", "milesAuto", "tipDel", "tipPick",
    "wear", "hourly", "regFee", "smallMin", "smallFee"];           // §8
  var SAVED_COPIED = ["store", "place", "cart", "milesBy", "cards", "creditOptIn", "usedIn", "manualCredits"]; // §8
  var NULLABLE_SAVED = ["miPerKwh", "miles"];                      // §8: may also be null (D-042: not mpg)
  var NUMBER_SAVED = ["mpg", "kwh", "manualSubtotal", "tipDel", "tipPick", "wear", "hourly",
    "regFee", "smallMin", "smallFee"];                             // §8
  var TRIP_KEYS = ["mpg", "wear", "kwh", "speed"];                 // §4.8: "trip." + path
  var TIP_KEYS = ["tipDel", "tipPick"];                            // §4.8: "tips." + path
  var BOOL_SAVED = ["dealOn", "milesAuto", "storePicked"];         // §8
  var STRING_SAVED = ["address", "make", "model"];                 // §8
  var CANON_INT = /^(0|[1-9][0-9]*)$/;                             // §8: cart keys
  var MANUAL_KEY = /^manual\.[1-9][0-9]{0,8}$/;                    // §8 (at most 9 digits)
  var MANUAL_N = /^manual\.([1-9][0-9]*)$/;                        // §5.3
  var PLACE_ID = /^osm:[nwr][1-9][0-9]{0,15}$/;                    // §8 (D-040)

  // ---- helpers (§0) ----------------------------------------------------------

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function isNonNeg(x) { return isNum(x) && x >= 0; }
  function isIntNonNeg(x) { return isNonNeg(x) && Math.floor(x) === x; }
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isSafeKey(k) { return k !== "__proto__" && k !== "constructor" && k !== "prototype"; }
  function isLatLon(lat, lon) {
    return isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  function isPos(p) { return isObj(p) && isLatLon(p.lat, p.lon); }
  function isGps(p) { return isObj(p) && p.src === "gps" && isNum(p.lat) && isNum(p.lon); }
  function isDate(d) {
    return Object.prototype.toString.call(d) === "[object Date]" &&
      typeof d.getTime === "function" && isNum(d.getTime());
  }
  function part(o, k) { return isObj(o) && isObj(o[k]) ? o[k] : {}; }
  function defaultsPart(D, k) { return part(part(D, "DEFAULTS"), k); }
  function num(x) { return isNum(x) ? x : null; }
  function pad(n, w) {
    var s = String(n);
    while (s.length < w) { s = "0" + s; }
    return s;
  }
  /** A new copy of a JSON-like value; objects keep only safe own keys. */
  function copyValue(v) {
    var i, out, k;
    if (Array.isArray(v)) {
      out = [];
      for (i = 0; i < v.length; i++) { out.push(copyValue(v[i])); }
      return out;
    }
    if (isObj(v)) {
      out = {};
      for (k in v) {
        if (hasOwn(v, k) && isSafeKey(k)) { out[k] = copyValue(v[k]); }
      }
      return out;
    }
    return v;
  }
  /** Copies the own keys of src that pass both tests. */
  function keepKeys(src, keyOk, valOk) {
    var out = {};
    for (var k in src) {
      if (hasOwn(src, k) && isSafeKey(k) && keyOk(k) && valOk(src[k])) { out[k] = src[k]; }
    }
    return out;
  }
  function anyKey() { return true; }
  function isTrue(x) { return x === true; }
  function isStr(x) { return typeof x === "string"; }
  function isNonNegVal(x) { return isNonNeg(x); }
  function tryCall(fn) {
    try { return fn(); } catch (e) { return null; }
  }
  function statusOf(st, need, partial) { return { status: st, need: need, partial: partial }; }
  function isNameLen(s) { return isStr(s) && s.length >= 1 && s.length <= 120; }

  // ---- D-040 keys: POD.api's own helpers (api contract §6; api.js loads before state.js), so the state and
  // the seam can never disagree on a key. Wrapped like the geography calls: a throw is null.
  function driveKeyOf(pos, store) { return tryCall(function () { return POD.api.driveKey(pos, store); }); }
  function geoKeyOf(text) { return tryCall(function () { return POD.api.geoKey(text); }); }

  // The geography and engine calls (geo-contract §1, engine-contract §2.1), wrapped so a throw is null.
  function geoMi(lat1, lon1, lat2, lon2) {
    return tryCall(function () { return POD.geo.distMi(lat1, lon1, lat2, lon2); });
  }
  function geoTrip(mi) { return tryCall(function () { return POD.geo.tripMiles(mi); }); }
  function geoZipByCode(code, D) { return tryCall(function () { return POD.geo.zipByCode(code, D); }); }
  function geoNearestZip(lat, lon, D) {
    return tryCall(function () { return POD.geo.nearestZip(lat, lon, D); });
  }
  function geoNearestStore(lat, lon, brand, D, opts) {
    return tryCall(function () { return POD.geo.nearestStore(lat, lon, brand, D, opts); });
  }
  function geoEstimate(rec, brand, D) {
    return tryCall(function () { return POD.geo.estimateMiles(rec, brand, D); });
  }
  function engineRest(brand, D) { return tryCall(function () { return POD.engine.restFor(brand, D); }); }

  /** The app entry of S.plats for p, or null. */
  function platOf(S, p) {
    return isObj(S) && isObj(S.plats) && isObj(S.plats[p]) ? S.plats[p] : null;
  }

  // ---- §2 fresh ----------------------------------------------------------------

  function freshPlat(p) {
    return {
      on: true, markup: null,
      delFee: num(p.delFee), svc: num(p.svc), svcMin: num(p.svcMin),
      memberSvc: num(p.memberSvc), memberMin: num(p.memberMin), pickDisc: num(p.pickDisc),
      member: false, memberOwn: false, cardMember: true
    };
  }

  /** A blank state. Each default is copied only when it's a finite number (D-032). */
  function fresh(D) {
    var T = defaultsPart(D, "trip");
    var TIPS = defaultsPart(D, "tips");
    var F = defaultsPart(D, "fees");
    var P = defaultsPart(D, "plats");
    var S = {
      address: "", pos: null, zip: null, zipRec: null, state: null, tax: null, gas: null,
      make: "", model: "", year: null, fuel: "regular", mpg: num(T.mpg), miPerKwh: null, kwh: num(T.kwh),
      brand: null, rest: null, store: null, storePicked: false, place: null,
      cart: {}, manualSubtotal: 0, dealOn: true,
      miles: null, minutes: null, speed: num(T.speed), milesAuto: true, milesSrc: null, milesBy: {},
      tipDel: num(TIPS.tipDel), tipPick: num(TIPS.tipPick), wear: num(T.wear), hourly: 0,
      regFee: num(F.regFee), smallMin: num(F.smallMin), smallFee: num(F.smallFee),
      cards: [], credits: [], creditOptIn: {}, usedIn: {}, manualCredits: [],
      plats: { direct: { on: true } }, promos: {}
    };
    for (var i = 0; i < APPS.length; i++) {
      S.plats[APPS[i]] = freshPlat(part(P, APPS[i]));
      S.promos[APPS[i]] = { type: "none", value: 0, cap: 0, min: 0, item: null };
    }
    return S;
  }

  // ---- §3 getPath / setPath ------------------------------------------------------

  /** The segments of a dotted path, or null when the path is invalid. */
  function splitPath(path) {
    if (typeof path !== "string" || path === "") { return null; }
    var segs = path.split(".");
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === "" || !isSafeKey(segs[i])) { return null; }
    }
    return segs;
  }

  function getPath(S, path) {
    var segs = splitPath(path);
    if (segs === null) { return undefined; }
    var cur = S;
    for (var i = 0; i < segs.length; i++) {
      if (cur === null || typeof cur !== "object" || !hasOwn(cur, segs[i])) { return undefined; }
      cur = cur[segs[i]];
    }
    return cur;
  }

  /** A plain value: null, a boolean, a string or a finite number. */
  function isPlain(v) {
    return v === null || typeof v === "boolean" || typeof v === "string" || isNum(v);
  }

  /** Writes only when every segment but the last is an existing own-key object, the last is an own key, and v is plain. */
  function setPath(S, path, v) {
    var segs = splitPath(path);
    if (segs === null || !isPlain(v)) { return false; }
    var cur = S;
    for (var i = 0; i < segs.length; i++) {
      if (!isObj(cur) || !hasOwn(cur, segs[i])) { return false; }
      if (i < segs.length - 1) { cur = cur[segs[i]]; }
    }
    cur[segs[segs.length - 1]] = v;
    return true;
  }

  // ---- §4.0 the car tables (D-023, D-037) ------------------------------------------

  var CAR_RUN = /^([0-9]+)([*de]?)@([0-9]{4})(-([0-9]{4}))?$/;  // a CAR_YEARS run (§4.0)
  var CAR_VALUE = /^([0-9]+)([*de]?)$/;                          // a CAR_DATA value (§4.0)

  function isYear(x) { return isNum(x) && Math.floor(x) === x && x >= 1900 && x <= 2100; }

  function plainOrder(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /** {fuel, mpg, miPerKwh} for a value and its suffix: "e" is EV (kWh/100 mi ÷ 10), "d" diesel, "*" premium. */
  function carFigures(v, suffix) {
    if (suffix === "e") { return { fuel: "ev", mpg: null, miPerKwh: v / 10 }; }
    if (suffix === "d") { return { fuel: "diesel", mpg: v, miPerKwh: null }; }
    return { fuel: suffix === "*" ? "premium" : "regular", mpg: v, miPerKwh: null };
  }

  /** One table row as {make, entries: [{model, value}]}, or null when the row is unusable. */
  function parseRow(row) {
    if (typeof row !== "string") { return null; }
    var bar = row.indexOf("|");
    if (bar < 1) { return null; }
    var parts = row.slice(bar + 1).split(",");
    var entries = [];
    for (var i = 0; i < parts.length; i++) {
      var colon = parts[i].indexOf(":");
      if (colon > 0) { entries.push({ model: parts[i].slice(0, colon), value: parts[i].slice(colon + 1) }); }
    }
    return { make: row.slice(0, bar), entries: entries };
  }

  /** The parsed rows of one table (D.CAR_DATA or D.CAR_YEARS), in written order. */
  function parsedRows(D, name) {
    var rows = isObj(D) ? D[name] : undefined;
    var out = [];
    if (!Array.isArray(rows)) { return out; }
    for (var i = 0; i < rows.length; i++) {
      var r = parseRow(rows[i]);
      if (r !== null) { out.push(r); }
    }
    return out;
  }

  /** The runs of a CAR_YEARS value text, in written order: {from, to, fuel, mpg, miPerKwh}. */
  function parseRuns(text) {
    var out = [];
    var words = text.split(" ");
    for (var i = 0; i < words.length; i++) {
      var m = CAR_RUN.exec(words[i]);
      if (m === null) { continue; }
      var v = parseInt(m[1], 10);
      var from = parseInt(m[3], 10);
      var to = m[5] === undefined ? from : parseInt(m[5], 10);
      if (!(v > 0) || from > to) { continue; }
      var f = carFigures(v, m[2]);
      out.push({ from: from, to: to, fuel: f.fuel, mpg: f.mpg, miPerKwh: f.miPerKwh });
    }
    return out;
  }

  /** Every run of one make and model in CAR_YEARS, in written order. */
  function carYearRuns(D, make, model) {
    var out = [];
    var rows = parsedRows(D, "CAR_YEARS");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].make !== make) { continue; }
      for (var j = 0; j < rows[i].entries.length; j++) {
        if (rows[i].entries[j].model === model) { out = out.concat(parseRuns(rows[i].entries[j].value)); }
      }
    }
    return out;
  }

  /** The first CAR_DATA value of one make and model that fully matches, or null. */
  function carDataFigures(D, make, model) {
    var rows = parsedRows(D, "CAR_DATA");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].make !== make) { continue; }
      for (var j = 0; j < rows[i].entries.length; j++) {
        var e = rows[i].entries[j];
        var m = e.model === model ? CAR_VALUE.exec(e.value) : null;
        if (m !== null) {
          var f = carFigures(parseInt(m[1], 10), m[2]);
          return { fuel: f.fuel, mpg: f.mpg, miPerKwh: f.miPerKwh, year: null };
        }
      }
    }
    return null;
  }

  /** The makes of both tables, each once, in plain string order. */
  function carMakes(D) {
    var out = [];
    var tables = ["CAR_DATA", "CAR_YEARS"];
    for (var t = 0; t < tables.length; t++) {
      var rows = parsedRows(D, tables[t]);
      for (var i = 0; i < rows.length; i++) {
        if (out.indexOf(rows[i].make) < 0) { out.push(rows[i].make); }
      }
    }
    return out.sort(plainOrder);
  }

  /** The models of one make in both tables, each once, in plain string order. */
  function carModels(D, make) {
    if (!isStr(make)) { return []; }
    var out = [];
    var tables = ["CAR_DATA", "CAR_YEARS"];
    for (var t = 0; t < tables.length; t++) {
      var rows = parsedRows(D, tables[t]);
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].make !== make) { continue; }
        for (var j = 0; j < rows[i].entries.length; j++) {
          var model = rows[i].entries[j].model;
          if (out.indexOf(model) < 0) { out.push(model); }
        }
      }
    }
    return out.sort(plainOrder);
  }

  /** The runs of one model, as new objects, in written order. */
  function carYears(D, make, model) {
    if (!isStr(make) || !isStr(model)) { return []; }
    return carYearRuns(D, make, model);
  }

  /** The figure for a car (§4.0): an integer year reads CAR_YEARS only; null prefers the newest run. */
  function carLookup(D, make, model, year) {
    if (!isStr(make) || !isStr(model)) { return null; }
    var runs = carYearRuns(D, make, model);
    var i, r;
    if (isYear(year)) {
      for (i = 0; i < runs.length; i++) {
        r = runs[i];
        if (r.from <= year && year <= r.to) { return { fuel: r.fuel, mpg: r.mpg, miPerKwh: r.miPerKwh, year: year }; }
      }
      return null;
    }
    if (year !== null) { return null; }
    if (runs.length > 0) {
      var best = runs[0];
      for (i = 1; i < runs.length; i++) { if (runs[i].to > best.to) { best = runs[i]; } }
      return { fuel: best.fuel, mpg: best.mpg, miPerKwh: best.miPerKwh, year: best.to };
    }
    return carDataFigures(D, make, model);
  }

  // ---- §4.8 estimates (D-042) -----------------------------------------------------

  /** The D.DEFAULTS key of a state path (§4.8), or null when the path has no default. */
  function defaultKey(path) {
    if (typeof path !== "string") { return null; }
    var segs = path.split(".");
    if (segs.length === 3 && segs[0] === "plats" && APPS.indexOf(segs[1]) >= 0 && APP_NUMS.indexOf(segs[2]) >= 0) {
      return path;
    }
    if (segs.length !== 1) { return null; }
    if (SHARED_FEES.indexOf(path) >= 0) { return "fees." + path; }
    if (TRIP_KEYS.indexOf(path) >= 0) { return "trip." + path; }
    if (TIP_KEYS.indexOf(path) >= 0) { return "tips." + path; }
    return null;
  }

  /** The value at a dotted key of D.DEFAULTS, walking own keys; undefined when a step is missing. */
  function defaultAt(D, key) {
    var segs = key.split(".");
    var cur = isObj(D) && hasOwn(D, "DEFAULTS") ? D.DEFAULTS : undefined;
    for (var i = 0; i < segs.length; i++) {
      if (!isObj(cur) || !hasOwn(cur, segs[i])) { return undefined; }
      cur = cur[segs[i]];
    }
    return cur;
  }

  /** D.DEFAULT_SOURCES[key] when it's an object (own key), else {}. */
  function sourceEntry(D, key) {
    var table = isObj(D) && hasOwn(D, "DEFAULT_SOURCES") ? D.DEFAULT_SOURCES : undefined;
    return isObj(table) && hasOwn(table, key) && isObj(table[key]) ? table[key] : {};
  }

  /** {value, est, source} for a path's default, or null when it has none (a new object each call). */
  function defaultOf(D, path) {
    var key = defaultKey(path);
    if (key === null) { return null; }
    var v = defaultAt(D, key);
    if (!isNum(v)) { return null; }
    var e = sourceEntry(D, key);
    return { value: v, est: e.est === true, source: isStr(e.source) ? e.source : null };
  }

  /** Where a path's current value comes from: "est", "published", "you", or null when it isn't a finite number. */
  function sourceOf(S, D, path) {
    var v = getPath(S, path);
    if (!isNum(v)) { return null; }
    if (path === "mpg" && carLookup(D, S.make, S.model, S.year) !== null) { return "published"; }
    var d = defaultOf(D, path);
    if (d !== null && v === d.value) { return d.est ? "est" : "published"; }
    return "you";
  }

  // ---- §4.1 applyCar ---------------------------------------------------------------

  /** The car sets fuel and mpg (or miPerKwh); no figure for the car leaves the user's own values. */
  function applyCar(S, D) {
    var r = carLookup(D, S.make, S.model, S.year);
    if (r !== null) {
      S.fuel = r.fuel;
      S.mpg = r.mpg;
      S.miPerKwh = r.miPerKwh;
    }
    applyState(S, D);
  }

  // ---- §4.2 applyState -------------------------------------------------------------

  function stateRow(D, code) {
    var rows = isObj(D) && Array.isArray(D.STATES) ? D.STATES : [];
    if (typeof code !== "string") { return null; }
    for (var i = 0; i < rows.length; i++) {
      if (Array.isArray(rows[i]) && rows[i][0] === code) { return rows[i]; }
    }
    return null;
  }

  /** The premium or diesel spread; 0 for regular and EV; null when the table lacks it. */
  function gradeAdd(D, fuel) {
    if (fuel !== "premium" && fuel !== "diesel") { return 0; }
    var g = part(D, "GRADE_ADD")[fuel];
    return isNum(g) ? g : null;
  }

  function applyState(S, D) {
    var row = stateRow(D, S.state);
    var add = gradeAdd(D, S.fuel);
    if (row === null || !isNum(row[2]) || !isNum(row[3]) || add === null) {
      S.tax = null;
      S.gas = null;
      return;
    }
    S.tax = row[3];
    S.gas = Math.round((row[2] + add) * 1000) / 1000;
  }

  // ---- §4.3 applyAddress -----------------------------------------------------------

  /** The last run of exactly 5 digits (not in a longer run), optionally followed by -dddd. */
  function zipFromText(text) {
    if (typeof text !== "string") { return null; }
    var re = /(^|\D)(\d{5})(?:-\d{4})?(?!\d)/g;
    var last = null;
    var m = re.exec(text);
    while (m !== null) {
      last = m[2];
      m = re.exec(text);
    }
    return last;
  }

  /** The Worker's geocode answer for the typed address (D-040): an object with an in-range point, or null. */
  function geocodedAt(S, opts) {
    if (!isObj(opts) || !isObj(opts.api) || !isObj(opts.api.geo)) { return null; }
    var k = geoKeyOf(S.address);
    if (k === null || !hasOwn(opts.api.geo, k)) { return null; }
    var g = opts.api.geo[k];
    return isObj(g) && isLatLon(g.lat, g.lon) ? g : null;
  }

  /** The ZIP record for a geocoded point: the typed ZIP's, else the answer's, else the nearest (D-040). */
  function geocodedZip(zr, g, D) {
    if (zr) { return zr; }
    var fromAnswer = isStr(g.zip) ? geoZipByCode(g.zip, D) : null;
    if (fromAnswer) { return fromAnswer; }
    return geoNearestZip(g.lat, g.lon, D);
  }

  function applyAddress(S, D, opts) {
    if (isGps(S.pos)) {
      var rec = geoNearestZip(S.pos.lat, S.pos.lon, D);
      S.zipRec = rec;
      S.zip = rec ? rec.z : null;
      S.state = rec ? rec.st : null;
    } else {
      var code = zipFromText(S.address);
      var zr = code === null ? null : geoZipByCode(code, D);
      var g = geocodedAt(S, opts);
      if (g !== null) {
        var grec = geocodedZip(zr, g, D);
        S.pos = { lat: g.lat, lon: g.lon, src: "addr" };
        S.zipRec = grec;
        S.zip = grec ? grec.z : code;
        S.state = grec ? grec.st : null;
      } else {
        S.zip = code;
        S.zipRec = zr;
        S.state = zr ? zr.st : null;
        S.pos = zr ? { lat: zr.la, lon: zr.lo, src: "zip" } : null;
      }
    }
    applyState(S, D);
  }

  // ---- §4.4 applyBrand -------------------------------------------------------------

  function applyBrand(S, D) {
    var rest = typeof S.brand === "string" ? engineRest(S.brand, D) : null;
    S.rest = rest;
    for (var i = 0; i < APPS.length; i++) {
      var pl = platOf(S, APPS[i]);
      if (pl !== null) {
        var m = rest !== null && isObj(rest.markup) ? rest.markup[APPS[i]] : undefined;
        pl.markup = isNum(m) ? m : null;
      }
    }
  }

  // ---- §4.6 applyMinutes (used by §4.5) --------------------------------------------

  function applyMinutes(S) {
    var ok = isNonNeg(S.miles) && isNum(S.speed) && S.speed > 0;
    S.minutes = ok ? Math.round(S.miles / S.speed * 60) : null;
  }

  // ---- §4.5 autoMiles --------------------------------------------------------------

  /** A picked store that belongs to the brand: {id, lat, lon} with id starting "brand@". */
  function isPickedStore(S) {
    var st = S.store;
    return S.storePicked === true && isObj(st) && isStr(st.id) && isNum(st.lat) && isNum(st.lon) &&
      st.id.indexOf(S.brand + "@") === 0;
  }

  /** Step 2: no position, no brand or no rest. Clears the distance. */
  function noDistance(S) {
    S.miles = null;
    S.milesSrc = null;
    if (S.storePicked !== true) { S.store = null; }
    applyMinutes(S);
    return statusOf("ok", [], false);
  }

  /** The drive rule (D-040, §4.5): a road distance from opts.api.drive replaces the straight-line trip. */
  function roadTrip(S, opts) {
    if (!isObj(opts) || !isObj(opts.api) || !isObj(opts.api.drive)) { return; }
    var k = driveKeyOf(S.pos, S.store);
    if (k === null || !hasOwn(opts.api.drive, k)) { return; }
    var a = opts.api.drive[k];
    if (!isObj(a) || !isNum(a.miles) || a.miles < 0 || a.miles > 1000) { return; }   // the checkDrive bound
    S.miles = Math.round(2 * a.miles * 10) / 10;
    S.milesSrc = "drive";
  }

  /** Step 3: the user's own store. */
  function pickedTrip(S, pos, opts) {
    var st = S.store;
    var trip = geoTrip(geoMi(pos.lat, pos.lon, st.lat, st.lon));
    S.miles = isNonNeg(trip) ? trip : null;
    S.milesSrc = S.miles === null ? null : "store";
    roadTrip(S, opts);
    applyMinutes(S);
    return statusOf("ok", [], false);
  }

  /** Step 5: the estimator, when no store is known. */
  function estimateTrip(S, D, pos, partial) {
    S.store = null;
    var e = geoEstimate({ la: pos.lat, lo: pos.lon }, S.brand, D);
    var ok = isObj(e) && isNum(e.round);
    S.miles = ok ? e.round : null;
    S.milesSrc = ok ? "estimate" : null;
    applyMinutes(S);
    return statusOf("ok", [], partial);
  }

  /** Step 4: the nearest store of the brand. */
  function nearestTrip(S, D, pos, opts) {
    var r = geoNearestStore(pos.lat, pos.lon, S.brand, D, opts);
    S.storePicked = false;
    if (r !== null && r.status === "need") {
      S.store = null;
      S.miles = null;
      S.milesSrc = null;
      applyMinutes(S);
      return statusOf("need", copyValue(r.need), false);
    }
    if (r !== null && isObj(r.store)) {
      var st = r.store;
      S.store = { id: st.id, lat: st.lat, lon: st.lon };
      S.miles = isNonNeg(st.trip) ? st.trip : null;
      S.milesSrc = S.miles === null ? null : "store";
      roadTrip(S, opts);
      applyMinutes(S);
      return statusOf("ok", [], r.partial === true);
    }
    return estimateTrip(S, D, pos, r !== null && r.partial === true);
  }

  function autoMiles(S, D, opts) {
    if (S.milesAuto !== true) { return statusOf("off", [], false); }
    if (!isPos(S.pos) || !isStr(S.brand) || !isObj(S.rest)) { return noDistance(S); }
    if (isPickedStore(S)) { return pickedTrip(S, S.pos, opts); }
    return nearestTrip(S, D, S.pos, opts);
  }

  /** The trip step of derive (§4.7): auto when milesAuto, else the pinned minutes (milesSrc "pinned"). */
  function tripStatus(S, D, opts) {
    if (S.milesAuto === true) { return autoMiles(S, D, opts); }
    S.milesSrc = "pinned";
    applyMinutes(S);
    return statusOf("off", [], false);
  }

  // ---- §5.2 periodOf ---------------------------------------------------------------

  function periodOf(cadence, now) {
    if (!isDate(now)) { return null; }
    var y = pad(now.getFullYear(), 4);
    var m = now.getMonth();
    if (cadence === "monthly") { return y + "-" + pad(m + 1, 2); }
    if (cadence === "quarterly") { return y + "-Q" + (Math.floor(m / 3) + 1); }
    if (cadence === "semiannual") { return y + "-H" + (m < 6 ? 1 : 2); }
    if (cadence === "annual") { return y; }
    if (cadence === "once") { return "once"; }
    return null;
  }

  // ---- §5.1 syncCredits and §5.4 memberships ---------------------------------------

  function cardsList(D) { return isObj(D) && Array.isArray(D.CARDS) ? D.CARDS : []; }

  /** The card of D.CARDS with this id, or null. */
  function cardOf(D, id) {
    var cards = cardsList(D);
    for (var i = 0; i < cards.length; i++) {
      if (isObj(cards[i]) && cards[i].id === id) { return cards[i]; }
    }
    return null;
  }

  /** S.cards keeps only known card ids, in order, without duplicates (§5.1 step 1). */
  function pruneCards(S, D) {
    var list = Array.isArray(S.cards) ? S.cards : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (isStr(id) && cardOf(D, id) !== null && out.indexOf(id) < 0) { out.push(id); }
    }
    S.cards = out;
  }

  /** The period test for a used flag (§5.1): set in the period it's marked in. */
  function isUsed(S, key, cadence, now) {
    var per = periodOf(cadence, now);
    return per !== null && isObj(S.usedIn) && S.usedIn[key] === per;
  }

  function cardCredit(S, card, c, now) {
    var key = card.id + "." + c.id;
    var optedIn = isObj(S.creditOptIn) && S.creditOptIn[key] === true;
    var blocked = !!c.locked || (!!c.restricted && !optedIn);
    var e = {
      key: key, cardId: card.id, name: c.name, amount: c.amount, cadence: c.cadence,
      plats: blocked || !Array.isArray(c.plats) ? [] : copyValue(c.plats),
      restricted: !!c.restricted, locked: !!c.locked, goldPartner: !!c.goldPartner,
      used: isUsed(S, key, c.cadence, now), manual: false
    };
    if (Array.isArray(c.modes)) { e.modes = copyValue(c.modes); }
    return e;
  }

  function manualCredit(S, m, now) {
    var e = {
      key: m.key, cardId: null, name: m.name, amount: m.amount, cadence: m.cadence,
      plats: Array.isArray(m.plats) ? copyValue(m.plats) : [],
      restricted: false, locked: false, goldPartner: false,
      used: isUsed(S, m.key, m.cadence, now), manual: true
    };
    if (Array.isArray(m.modes)) { e.modes = copyValue(m.modes); }
    return e;
  }

  /** Appends the credits of one card, in the card's own order. */
  function appendCardCredits(out, S, card, now) {
    if (!Array.isArray(card.credits)) { return; }
    for (var j = 0; j < card.credits.length; j++) {
      var c = card.credits[j];
      if (isObj(c) && isStr(c.id)) { out.push(cardCredit(S, card, c, now)); }
    }
  }

  function appendManualCredits(out, S, now) {
    var list = Array.isArray(S.manualCredits) ? S.manualCredits : [];
    for (var i = 0; i < list.length; i++) {
      if (isObj(list[i]) && isStr(list[i].key)) { out.push(manualCredit(S, list[i], now)); }
    }
  }

  /** §5.4: member = memberOwn, or a card of S.cards includes the membership and cardMember isn't off. */
  function cardHas(S, D, p) {
    for (var i = 0; i < S.cards.length; i++) {
      var c = cardOf(D, S.cards[i]);
      if (c !== null && c.membership === p) { return true; }
    }
    return false;
  }

  function applyMemberships(S, D) {
    for (var i = 0; i < APPS.length; i++) {
      var pl = platOf(S, APPS[i]);
      if (pl !== null) {
        pl.member = pl.memberOwn === true || (cardHas(S, D, APPS[i]) && pl.cardMember !== false);
      }
    }
  }

  /** Destructive by design: rebuilds S.credits from S.cards (§5.1). */
  function syncCredits(S, D, now) {
    pruneCards(S, D);
    var credits = [];
    var cards = cardsList(D);
    for (var i = 0; i < cards.length; i++) {
      if (isObj(cards[i]) && isStr(cards[i].id) && S.cards.indexOf(cards[i].id) >= 0) {
        appendCardCredits(credits, S, cards[i], now);
      }
    }
    appendManualCredits(credits, S, now);
    S.credits = credits;
    applyMemberships(S, D);
  }

  // ---- §5.3 manual credits ---------------------------------------------------------

  function isPlatList(a) {
    if (!Array.isArray(a)) { return false; }
    for (var i = 0; i < a.length; i++) {
      if (PLAT_IDS.indexOf(a[i]) < 0) { return false; }
    }
    return true;
  }

  /** modes is ["d"], ["p"] or both, each once. */
  function isModes(a) {
    if (!Array.isArray(a) || a.length < 1 || a.length > 2) { return false; }
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== "d" && a[i] !== "p") { return false; }
    }
    return a.length === 1 || a[0] !== a[1];
  }

  /** A manual credit as addManualCredit stores it, or null when it's invalid. */
  function normalizeCredit(c, key) {
    if (!isObj(c) || !isStr(c.name) || c.name === "" || !isNum(c.amount) || c.amount <= 0) { return null; }
    if (!isPlatList(c.plats)) { return null; }
    var cadence = c.cadence === undefined ? "once" : c.cadence;
    if (CADENCES.indexOf(cadence) < 0) { return null; }
    var out = { key: key, name: c.name, amount: c.amount, cadence: cadence, plats: c.plats.slice() };
    if (c.modes !== undefined) {
      if (!isModes(c.modes)) { return null; }
      out.modes = c.modes.slice();
    }
    return out;
  }

  /** 1 + the largest n among the existing manual keys. */
  function nextManualN(S) {
    var list = Array.isArray(S.manualCredits) ? S.manualCredits : [];
    var max = 0;
    for (var i = 0; i < list.length; i++) {
      var m = isObj(list[i]) && isStr(list[i].key) ? MANUAL_N.exec(list[i].key) : null;
      if (m !== null && Number(m[1]) > max) { max = Number(m[1]); }
    }
    return max + 1;
  }

  function addManualCredit(S, D, credit, now) {
    var key = "manual." + nextManualN(S);
    var c = normalizeCredit(credit, key);
    if (c === null) { return null; }
    var base = Array.isArray(S.manualCredits) ? S.manualCredits : [];
    S.manualCredits = base.concat([c]);
    syncCredits(S, D, now);
    return key;
  }

  function removeManualCredit(S, D, key, now) {
    if (!isStr(key) || !isSafeKey(key)) { return false; }
    var list = Array.isArray(S.manualCredits) ? S.manualCredits : [];
    var out = [];
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (isObj(list[i]) && list[i].key === key) { found = true; } else { out.push(list[i]); }
    }
    if (!found) { return false; }
    S.manualCredits = out;
    if (isObj(S.usedIn)) { delete S.usedIn[key]; }
    if (isObj(S.creditOptIn)) { delete S.creditOptIn[key]; }
    syncCredits(S, D, now);
    return true;
  }

  // ---- §6 actions ------------------------------------------------------------------

  function findCredit(S, key) {
    var list = Array.isArray(S.credits) ? S.credits : [];
    for (var i = 0; i < list.length; i++) {
      if (isObj(list[i]) && list[i].key === key) { return list[i]; }
    }
    return null;
  }

  function toggleCard(S, D, cardId, on, now) {
    if (!isStr(cardId) || cardOf(D, cardId) === null) { return false; }
    var list = Array.isArray(S.cards) ? S.cards.slice() : [];
    var at = list.indexOf(cardId);
    if (on === true) {
      if (at < 0) { list.push(cardId); }
    } else if (at >= 0) {
      list.splice(at, 1);
    }
    S.cards = list;
    syncCredits(S, D, now);
    return true;
  }

  function setOptIn(S, D, key, on, now) {
    if (!isStr(key) || !isSafeKey(key) || !isObj(S.creditOptIn)) { return false; }
    if (on === true) { S.creditOptIn[key] = true; } else { delete S.creditOptIn[key]; }
    syncCredits(S, D, now);
    return true;
  }

  function markUsed(S, D, key, used, now) {
    var entry = findCredit(S, key);
    if (entry === null || !isObj(S.usedIn) || !isSafeKey(key)) { return false; }
    var per = periodOf(entry.cadence, now);
    if (per === null) { return false; }
    if (used === true) { S.usedIn[key] = per; } else { delete S.usedIn[key]; }
    syncCredits(S, D, now);
    return true;
  }

  function setAddress(S, D, text, opts) {
    S.address = isStr(text) ? text : "";
    S.pos = null;
    applyAddress(S, D, opts);
    return tripStatus(S, D, opts);
  }

  function setPosition(S, D, lat, lon, opts) {
    if (!isLatLon(lat, lon)) { return null; }
    S.pos = { lat: lat, lon: lon, src: "gps" };
    applyAddress(S, D, opts);
    return tripStatus(S, D, opts);
  }

  /** setCar(S, D, make, model, year): a four-argument call means year null (D-037). */
  function setCar(S, D, make, model, year) {
    var newMake = isStr(make) ? make : "";
    var newModel = isStr(model) ? model : "";
    var newYear = isYear(year) ? year : null;
    var changed = newMake !== S.make || newModel !== S.model || newYear !== S.year;
    S.make = newMake;
    S.model = newModel;
    S.year = newYear;
    // A car the user just picked that has no figure: the old car's fuel, mpg and kWh belong to it, not to this one.
    // D-042: the fallback is the typical car (fuel regular, its mpg when finite, no kWh), so a first pick prices.
    if (changed && carLookup(D, newMake, newModel, newYear) === null) {
      S.fuel = "regular";
      S.mpg = num(defaultsPart(D, "trip").mpg);
      S.miPerKwh = null;
    }
    applyCar(S, D);
  }

  /** The distance the user pinned for this brand, or null. */
  function pinnedFor(S) {
    if (!isStr(S.brand) || !isObj(S.milesBy) || !hasOwn(S.milesBy, S.brand)) { return null; }
    var m = S.milesBy[S.brand];
    return isNonNeg(m) ? m : null;
  }

  function setBrand(S, D, brandId, opts) {
    S.brand = isStr(brandId) ? brandId : null;
    S.cart = {};
    S.dealOn = true;
    for (var i = 0; i < APPS.length; i++) {
      // D-036: an index into the old menu would name another item in the new one
      if (isObj(S.promos) && isObj(S.promos[APPS[i]])) { S.promos[APPS[i]].item = null; }
    }
    S.store = null;
    S.storePicked = false;
    if (!(isObj(S.place) && S.place.id === brandId)) { S.place = null; }   // D-040
    applyBrand(S, D);
    var pin = pinnedFor(S);
    if (pin !== null) {
      S.miles = pin;
      S.milesAuto = false;
      S.milesSrc = "pinned";
      applyMinutes(S);
      return statusOf("off", [], false);
    }
    S.milesAuto = true;
    return autoMiles(S, D, opts);
  }

  /** A storesNear row: a brand, an id that starts "brand@", and an in-range point. */
  function isStoreRow(s) {
    return isObj(s) && isStr(s.brand) && isStr(s.id) && s.id.indexOf(s.brand + "@") === 0 &&
      isLatLon(s.lat, s.lon);
  }

  /** D-040: D.PLACES[id] as a place {id, name, category, lat, lon} when id isn't a chain of D.BRANDS; else null. */
  function independentPlace(D, id) {
    if (!isObj(D) || (isObj(D.BRANDS) && hasOwn(D.BRANDS, id))) { return null; }
    if (!isObj(D.PLACES) || !hasOwn(D.PLACES, id)) { return null; }
    var p = D.PLACES[id];
    if (!isObj(p) || !isStr(p.name) || !isStr(p.category) || !isLatLon(p.lat, p.lon)) { return null; }
    return { id: id, name: p.name, category: p.category, lat: p.lat, lon: p.lon };
  }

  function pickStore(S, D, store, opts) {
    if (!isStoreRow(store)) { return null; }
    if (store.brand !== S.brand) { setBrand(S, D, store.brand, opts); }
    S.store = { id: store.id, lat: store.lat, lon: store.lon };
    S.storePicked = true;
    S.milesAuto = true;
    if (isObj(S.milesBy) && hasOwn(S.milesBy, store.brand)) { delete S.milesBy[store.brand]; }
    var place = independentPlace(D, store.brand);
    if (place !== null) { S.place = place; }
    return autoMiles(S, D, opts);
  }

  function setQty(S, index, qty) {
    var rest = S.rest;
    if (!isObj(rest) || rest.profiled !== true || !Array.isArray(rest.menu)) { return false; }
    if (!isIntNonNeg(index) || index >= rest.menu.length) { return false; }
    if (!isIntNonNeg(qty) || !isObj(S.cart)) { return false; }
    if (qty > 0) { S.cart[String(index)] = qty; } else { delete S.cart[String(index)]; }
    return true;
  }

  function pinMiles(S, miles) {
    if (!isNonNeg(miles)) { return false; }
    S.miles = miles;
    S.milesAuto = false;
    S.milesSrc = "pinned";
    if (isStr(S.brand) && isObj(S.milesBy)) { S.milesBy[S.brand] = miles; }
    applyMinutes(S);
    return true;
  }

  function unpinMiles(S, D, opts) {
    S.milesAuto = true;
    if (isStr(S.brand) && isObj(S.milesBy) && hasOwn(S.milesBy, S.brand)) { delete S.milesBy[S.brand]; }
    return autoMiles(S, D, opts);
  }

  /** The derivation cascade (§4.7). Never resets a user field. */
  function derive(S, D, now, opts) {
    applyCar(S, D);
    applyAddress(S, D, opts);
    applyBrand(S, D);
    syncCredits(S, D, now);
    return tripStatus(S, D, opts);
  }

  // ---- §7 missing, appMissing, forEngine -------------------------------------------

  function fuelMissing(S, out) {
    if (FUELS.indexOf(S.fuel) < 0) { out.push("fuel"); }
    if (S.fuel === "ev") {
      if (!(isNum(S.miPerKwh) && S.miPerKwh > 0)) { out.push("miPerKwh"); }
      if (!isNonNeg(S.kwh)) { out.push("kwh"); }
    } else {
      if (!(isNum(S.mpg) && S.mpg > 0)) { out.push("mpg"); }
      if (!isNonNeg(S.gas)) { out.push("gas"); }
    }
  }

  /** The shared inputs the engine still needs; [] when it can price. */
  function missing(S) {
    var out = [];
    var fields = ["miles", "minutes", "wear", "hourly", "tipDel", "tipPick"];
    if (!isObj(S.rest)) { out.push("rest"); }
    if (!isNonNeg(S.tax)) { out.push("tax"); }
    fuelMissing(S, out);
    for (var i = 0; i < fields.length; i++) {
      if (!isNonNeg(S[fields[i]])) { out.push(fields[i]); }
    }
    if (isObj(S.rest) && S.rest.profiled !== true && !isNonNeg(S.manualSubtotal)) {
      out.push("manualSubtotal");
    }
    return out;
  }

  /** The app's own fees and the shared app-delivery fees that are still empty. */
  function appMissing(S, p) {
    if (APPS.indexOf(p) < 0) { return []; }
    var pl = platOf(S, p) || {};
    var out = [];
    for (var i = 0; i < APP_PATHS.length; i++) {
      if (!isNonNeg(pl[APP_PATHS[i]])) { out.push("plats." + p + "." + APP_PATHS[i]); }
    }
    for (var j = 0; j < SHARED_FEES.length; j++) {
      if (!isNonNeg(S[SHARED_FEES[j]])) { out.push(SHARED_FEES[j]); }
    }
    return out;
  }

  /** The copy the page prices (D-033). An app missing a pickup input (markup, pickDisc) is switched off; one missing only delivery inputs gets noDelivery. null while missing(S) isn't []. */
  function forEngine(S) {
    if (missing(S).length > 0) { return null; }
    var F = copyValue(S);
    for (var i = 0; i < APPS.length; i++) {
      var pl = platOf(F, APPS[i]);
      if (pl === null || pl.on !== true) { continue; }
      var miss = appMissing(S, APPS[i]);
      if (miss.length === 0) { continue; }
      if (miss.indexOf("plats." + APPS[i] + ".markup") >= 0 || miss.indexOf("plats." + APPS[i] + ".pickDisc") >= 0) {
        pl.on = false;
      } else {
        pl.noDelivery = true;
      }
    }
    return F;
  }

  // ---- §8 persistence --------------------------------------------------------------

  /** The user fields only, as save writes them. */
  function savedFields(S) {
    var out = {};
    var i, p, pl, plats = { direct: { on: S.plats.direct.on } }, promos = {};
    for (i = 0; i < SAVED_SCALARS.length; i++) { out[SAVED_SCALARS[i]] = S[SAVED_SCALARS[i]]; }
    for (i = 0; i < SAVED_COPIED.length; i++) { out[SAVED_COPIED[i]] = copyValue(S[SAVED_COPIED[i]]); }
    if (isGps(S.pos)) { out.pos = { lat: S.pos.lat, lon: S.pos.lon, src: "gps" }; }
    for (i = 0; i < APPS.length; i++) {
      p = APPS[i];
      pl = platOf(S, p) || {};
      plats[p] = {
        on: pl.on, delFee: pl.delFee, svc: pl.svc, svcMin: pl.svcMin, memberSvc: pl.memberSvc,
        memberMin: pl.memberMin, pickDisc: pl.pickDisc, memberOwn: pl.memberOwn, cardMember: pl.cardMember
      };
      promos[p] = copyValue(S.promos[p]);
    }
    out.plats = plats;
    out.promos = promos;
    return out;
  }

  /** storage.setItem inside try/catch; false if anything throws or storage is missing. */
  function save(S, storage) {
    try {
      storage.setItem(POD.STORAGE_KEY, JSON.stringify(savedFields(S)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** A saved manual credit is kept only when addManualCredit would accept it, with a manual.n key. */
  function savedManual(m) {
    if (!isObj(m) || !isStr(m.key) || !MANUAL_KEY.test(m.key)) { return null; }
    return normalizeCredit(m, m.key);
  }

  function mergeScalars(S, v) {
    var i;
    for (i = 0; i < STRING_SAVED.length; i++) {
      if (isStr(v[STRING_SAVED[i]])) { S[STRING_SAVED[i]] = v[STRING_SAVED[i]]; }
    }
    if (v.brand === null || isStr(v.brand)) { S.brand = v.brand; }
    if (v.year === null || isYear(v.year)) { S.year = v.year; }
    if (FUELS.indexOf(v.fuel) >= 0) { S.fuel = v.fuel; }
    for (i = 0; i < BOOL_SAVED.length; i++) {
      if (typeof v[BOOL_SAVED[i]] === "boolean") { S[BOOL_SAVED[i]] = v[BOOL_SAVED[i]]; }
    }
  }

  function mergeNumbers(S, v) {
    var i;
    for (i = 0; i < NUMBER_SAVED.length; i++) {
      if (isNonNeg(v[NUMBER_SAVED[i]])) { S[NUMBER_SAVED[i]] = v[NUMBER_SAVED[i]]; }
    }
    for (i = 0; i < NULLABLE_SAVED.length; i++) {
      if (v[NULLABLE_SAVED[i]] === null || isNonNeg(v[NULLABLE_SAVED[i]])) {
        S[NULLABLE_SAVED[i]] = v[NULLABLE_SAVED[i]];
      }
    }
    if (isNum(v.speed) && v.speed > 0) { S.speed = v.speed; }
  }

  function mergePos(S, v) {
    var p = v.pos;
    if (isObj(p) && p.src === "gps" && isLatLon(p.lat, p.lon)) {
      S.pos = { lat: p.lat, lon: p.lon, src: "gps" };
    }
  }

  function mergeStore(S, v) {
    var s = v.store;
    if (s === null) { S.store = null; }
    else if (isObj(s) && isStr(s.id) && isNum(s.lat) && isNum(s.lon)) {
      S.store = { id: s.id, lat: s.lat, lon: s.lon };
    }
  }

  function mergeCart(S, v) {
    if (!isObj(v.cart)) { return; }
    S.cart = keepKeys(v.cart, function (k) { return CANON_INT.test(k); }, isIntNonNeg);
  }

  function mergeMaps(S, v) {
    if (isObj(v.milesBy)) { S.milesBy = keepKeys(v.milesBy, anyKey, isNonNegVal); }
    if (isObj(v.creditOptIn)) { S.creditOptIn = keepKeys(v.creditOptIn, anyKey, isTrue); }
    if (isObj(v.usedIn)) { S.usedIn = keepKeys(v.usedIn, anyKey, isStr); }
  }

  function mergeCards(S, v) {
    if (!Array.isArray(v.cards)) { return; }
    var out = [];
    for (var i = 0; i < v.cards.length; i++) {
      if (isStr(v.cards[i])) { out.push(v.cards[i]); }
    }
    S.cards = out;
  }

  function mergeManual(S, v) {
    if (!Array.isArray(v.manualCredits)) { return; }
    var out = [];
    for (var i = 0; i < v.manualCredits.length; i++) {
      var c = savedManual(v.manualCredits[i]);
      if (c !== null && !hasKey(out, c.key)) { out.push(c); }
    }
    S.manualCredits = out;
  }

  function hasKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) { return true; }
    }
    return false;
  }

  function mergePlatFields(dst, src, p) {
    if (typeof src.on === "boolean") { dst.on = src.on; }
    if (p === "direct") { return; }
    var i;
    for (i = 0; i < APP_NUMS.length; i++) {
      if (isNonNeg(src[APP_NUMS[i]])) { dst[APP_NUMS[i]] = src[APP_NUMS[i]]; }
    }
    for (i = 0; i < APP_FLAGS.length; i++) {
      if (typeof src[APP_FLAGS[i]] === "boolean") { dst[APP_FLAGS[i]] = src[APP_FLAGS[i]]; }
    }
  }

  function mergePlats(S, v) {
    if (!isObj(v.plats)) { return; }
    for (var i = 0; i < PLAT_IDS.length; i++) {
      var p = PLAT_IDS[i];
      var dst = platOf(S, p);
      if (dst !== null && isObj(v.plats[p])) { mergePlatFields(dst, v.plats[p], p); }
    }
  }

  function mergePromos(S, v) {
    if (!isObj(v.promos) || !isObj(S.promos)) { return; }
    for (var i = 0; i < APPS.length; i++) {
      var p = APPS[i];
      var src = v.promos[p];
      var dst = S.promos[p];
      if (!isObj(src) || !isObj(dst)) { continue; }
      if (PROMO_TYPES.indexOf(src.type) >= 0) { dst.type = src.type; }
      for (var j = 0; j < PROMO_NUMS.length; j++) {
        if (isNonNeg(src[PROMO_NUMS[j]])) { dst[PROMO_NUMS[j]] = src[PROMO_NUMS[j]]; }
      }
      if (isIntNonNeg(src.item) || src.item === null) { dst.item = src.item; }
    }
  }

  /** Each saved field replaces the fresh one only when it has the right type (§8). */
  /** D-040: a saved place is kept only when it's an independent id of the loaded brand; else null. */
  function mergePlace(S, v) {
    var p = v.place;
    S.place = null;
    if (!isObj(p) || !isStr(p.id) || !PLACE_ID.test(p.id) || p.id !== S.brand || !isNameLen(p.name) ||
        !isStr(p.category) || !isLatLon(p.lat, p.lon)) { return; }
    S.place = { id: p.id, name: p.name, category: p.category, lat: p.lat, lon: p.lon };
  }

  function mergeSaved(S, v) {
    mergeScalars(S, v);
    mergeNumbers(S, v);
    mergePos(S, v);
    mergeStore(S, v);
    mergePlace(S, v);
    mergeCart(S, v);
    mergeMaps(S, v);
    mergeCards(S, v);
    mergeManual(S, v);
    mergePlats(S, v);
    mergePromos(S, v);
  }

  /** The saved object, or {} when storage is missing, throws, or the value isn't a JSON object. */
  function readSaved(storage) {
    var raw = null;
    try {
      raw = storage.getItem(POD.STORAGE_KEY);
    } catch (e) {
      return {};
    }
    if (typeof raw !== "string") { return {}; }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e2) {
      return {};
    }
    return isObj(parsed) ? parsed : {};
  }

  /** The saved state merged over fresh(D), then derived. Never writes to storage. */
  function load(storage, D, now, opts) {
    var S = fresh(D);
    mergeSaved(S, readSaved(storage));
    derive(S, D, now, opts);
    return S;
  }

  POD.state = {
    fresh: fresh,
    getPath: getPath,
    setPath: setPath,
    carMakes: carMakes,
    carModels: carModels,
    carYears: carYears,
    carLookup: carLookup,
    applyCar: applyCar,
    applyState: applyState,
    applyAddress: applyAddress,
    applyBrand: applyBrand,
    autoMiles: autoMiles,
    applyMinutes: applyMinutes,
    syncCredits: syncCredits,
    derive: derive,
    setAddress: setAddress,
    setPosition: setPosition,
    setCar: setCar,
    setBrand: setBrand,
    pickStore: pickStore,
    setQty: setQty,
    pinMiles: pinMiles,
    unpinMiles: unpinMiles,
    toggleCard: toggleCard,
    setOptIn: setOptIn,
    markUsed: markUsed,
    addManualCredit: addManualCredit,
    removeManualCredit: removeManualCredit,
    periodOf: periodOf,
    missing: missing,
    appMissing: appMissing,
    forEngine: forEngine,
    defaultOf: defaultOf,
    sourceOf: sourceOf,
    load: load,
    save: save
  };
})(typeof window !== "undefined" ? window : this);
