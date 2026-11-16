/*
 * vin.js: POD.vin, a VIN the user typed → a checked VIN, vPIC's decode URL, the decoded car, and its match onto the
 * car tables (docs/vin-contract.md, D-038). Pure: no network, no DOM, no Date, no POD.data or POD.S. ASCII only:
 * no toUpperCase/toLowerCase/trim (vin contract §0). ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  var ALLOWED = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ";            // §3: no I, O, Q
  var LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";                       // §3: the letters with a value
  var LETTER_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9];
  var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  var URL_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";  // §4

  function isStr(x) { return typeof x === "string"; }
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function isYear(x) { return isNum(x) && Math.floor(x) === x && x >= 1900 && x <= 2100; }

  /** §2: a-z become A-Z; space, tab, LF, CR and hyphen are dropped; every other unit is kept. */
  function clean(text) {
    if (!isStr(text)) { return ""; }
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0x61 && c <= 0x7A) { out.push(String.fromCharCode(c - 0x20)); }
      else if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D || c === 0x2D) { continue; }
      else { out.push(text.charAt(i)); }
    }
    return out.join("");
  }

  /** The value of one allowed VIN character (§3, step 3). */
  function charValue(ch) {
    if (ch >= "0" && ch <= "9") { return ch.charCodeAt(0) - 48; }
    return LETTER_VALUES[LETTERS.indexOf(ch)];
  }

  /** §3: "length", "chars", "digit" or "ok". */
  function check(vin) {
    if (!isStr(vin) || vin.length !== 17) { return "length"; }
    var i;
    for (i = 0; i < 17; i++) {
      if (ALLOWED.indexOf(vin.charAt(i)) < 0) { return "chars"; }
    }
    var sum = 0;
    for (i = 0; i < 17; i++) { sum += charValue(vin.charAt(i)) * WEIGHTS[i]; }
    var r = sum % 11;
    var expected = r === 10 ? "X" : String(r);
    return vin.charAt(8) === expected ? "ok" : "digit";
  }

  /** §4: vPIC's decode URL for a VIN that checks, else null. */
  function url(vin) {
    return check(vin) === "ok" ? URL_BASE + vin + "?format=json" : null;
  }

  function isTrimSpace(c) { return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D; }

  /** Trims only space, tab, LF and CR (§5): a no-break space (U+00A0) is kept. */
  function trimAscii(s) {
    var a = 0;
    var b = s.length;
    while (a < b && isTrimSpace(s.charCodeAt(a))) { a++; }
    while (b > a && isTrimSpace(s.charCodeAt(b - 1))) { b--; }
    return s.slice(a, b);
  }

  /** §5: vPIC's parsed JSON → {year, make, model}, or null. */
  function decode(body) {
    if (!isObj(body) || !Array.isArray(body.Results) || body.Results.length < 1) { return null; }
    var r = body.Results[0];
    if (!isObj(r) || !isStr(r.ModelYear) || !isStr(r.Make) || !isStr(r.Model)) { return null; }
    var ys = trimAscii(r.ModelYear);
    var make = trimAscii(r.Make);
    var model = trimAscii(r.Model);
    if (!/^[0-9]{4}$/.test(ys) || make === "" || model === "") { return null; }
    var year = parseInt(ys, 10);
    if (!isYear(year)) { return null; }
    return { year: year, make: make, model: model };
  }

  /** §6: the matching key: A-Z become a-z; a-z and 0-9 are kept; everything else is dropped. */
  function key(s) {
    if (!isStr(s)) { return ""; }
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x41 && c <= 0x5A) { out.push(String.fromCharCode(c + 0x20)); }
      else if ((c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)) { out.push(s.charAt(i)); }
    }
    return out.join("");
  }

  /** The first name of a list whose key is k, or null. */
  function firstByKey(list, k) {
    for (var i = 0; i < list.length; i++) {
      if (key(list[i]) === k) { return list[i]; }
    }
    return null;
  }

  /** §7: a decoded car → the tables' own spelling: {make, model, year}; an unknown make is "Other". */
  function match(dec, D) {
    if (!isObj(dec) || !isYear(dec.year) || !isStr(dec.make) || !isStr(dec.model)) { return null; }
    var mk = key(dec.make);
    var make = mk === "" ? null : firstByKey(POD.state.carMakes(D), mk);
    if (make === null) { return { make: "Other", model: "", year: dec.year }; }
    var md = key(dec.model);
    var model = md === "" ? null : firstByKey(POD.state.carModels(D, make), md);
    return { make: make, model: model === null ? "" : model, year: dec.year };
  }

  POD.vin = { clean: clean, check: check, url: url, decode: decode, key: key, match: match };
})(typeof window !== "undefined" ? window : this);
