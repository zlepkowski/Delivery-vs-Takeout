/*
 * links.js: POD.links, where a result row hands off (docs/links-contract.md §0–§2, D-041). forChannel(ch, S, D)
 * returns [{kind, label, href}] from the page's own S and the data tables D.LINKS. Pure: it reads only its
 * arguments (no POD.data, POD.S, Date, document or window), never throws, and returns new objects. ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  var CHANNELS = ["direct-d", "direct-p", "dd-d", "dd-p", "ue-d", "ue-p", "gh-d", "gh-p"];   // §2.1
  var APP_NAME = { dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub" };

  function isStr(x) { return typeof x === "string"; }
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function nonEmpty(x) { return isStr(x) && x !== ""; }
  function fin(x) { return typeof x === "number" && isFinite(x); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /** An own property of an object, or undefined. */
  function get(o, k) { return own(o, k) ? o[k] : undefined; }

  /** encodeURIComponent, or null when it throws (a lone surrogate, §0). */
  function enc(s) {
    try { return encodeURIComponent(s); } catch (e) { return null; }
  }

  /** Every occurrence of key in t replaced by v. */
  function fill(t, key, v) { return t.split(key).join(v); }

  function https(h) { return isStr(h) && h.indexOf("https://") === 0; }

  function fix5(x) { return x.toFixed(5); }

  function hasChannel(ch) {
    for (var i = 0; i < CHANNELS.length; i++) {
      if (CHANNELS[i] === ch) { return true; }
    }
    return false;
  }

  /** §2.3: an app's search when it has one that builds, else its home page, else nothing. */
  function appLinks(p, name, L) {
    var apps = get(L, "apps");
    if (!isObj(apps)) { return []; }
    var a = get(apps, p);
    if (!isObj(a)) { return []; }
    var App = APP_NAME[p];
    var search = get(a, "search");
    if (isStr(search) && search.indexOf("{q}") >= 0) {
      var q = enc(name);
      if (q !== null) {
        var h = fill(search, "{q}", q);
        if (https(h)) { return [{ kind: "search", label: "Search " + App + " for " + name, href: h }]; }
      }
    }
    var home = get(a, "home");
    if (https(home)) { return [{ kind: "app", label: "Open " + App, href: home }]; }
    return [];
  }

  /** The store's point, when the store is one the trip was measured to (§2.4, the directions rule). */
  function storePoint(brand, S) {
    var st = get(S, "store");
    if (!isObj(st)) { return null; }
    var id = get(st, "id"), lat = get(st, "lat"), lon = get(st, "lon");
    if (!isStr(id) || id.indexOf(brand + "@") !== 0) { return null; }
    if (!fin(lat) || !fin(lon)) { return null; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { return null; }
    return { lat: lat, lon: lon };
  }

  /** §2.4: the order link, then (pickup only) directions to the store or a map search by name. */
  function directLinks(m, brand, name, S, L) {
    var out = [];
    var order = get(L, "order");
    if (isObj(order)) {
      var o = get(order, brand);
      if (isObj(o) && https(get(o, "url"))) {
        out.push({ kind: "order", label: "Order from " + name, href: get(o, "url") });
      }
    }
    if (m !== "p") { return out; }
    var mp = get(L, "maps");
    if (!isObj(mp) || !nonEmpty(get(mp, "name"))) { return out; }
    var mapName = get(mp, "name");
    var dir = get(mp, "dir"), search = get(mp, "search");
    var pt = storePoint(brand, S);
    if (pt !== null && isStr(dir) && dir.indexOf("{lat}") >= 0 && dir.indexOf("{lon}") >= 0) {
      var hd = fill(fill(dir, "{lat}", fix5(pt.lat)), "{lon}", fix5(pt.lon));
      if (https(hd)) { out.push({ kind: "dir", label: "Directions in " + mapName, href: hd }); return out; }
    }
    if (isStr(search) && search.indexOf("{q}") >= 0) {
      var q = enc(name);
      if (q !== null) {
        var hs = fill(search, "{q}", q);
        if (https(hs)) { out.push({ kind: "map", label: "Find " + name + " in " + mapName, href: hs }); }
      }
    }
    return out;
  }

  /** §2: the hand-off for one result row. */
  function forChannel(ch, S, D) {
    if (!isStr(ch) || !hasChannel(ch)) { return []; }
    if (!isObj(S) || !isObj(D)) { return []; }
    var L = get(D, "LINKS");
    if (!isObj(L)) { return []; }
    var brand = get(S, "brand");
    if (!isStr(brand)) { return []; }
    var rest = get(S, "rest");
    if (!isObj(rest) || !nonEmpty(get(rest, "name"))) { return []; }
    var name = get(rest, "name");
    var dash = ch.indexOf("-");
    var p = ch.slice(0, dash), m = ch.slice(dash + 1);
    if (own(APP_NAME, p)) { return appLinks(p, name, L); }
    if (p === "direct") { return directLinks(m, brand, name, S, L); }
    return [];
  }

  POD.links = { forChannel: forChannel };
})(typeof window !== "undefined" ? window : this);
