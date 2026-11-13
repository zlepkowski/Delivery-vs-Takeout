/*
 * geo.js: POD.geo, the geography functions (BUILD.md section 8, the contract in docs/geo-contract.md, D-030).
 * Pure: every function takes the data tables as D and reads nothing else. Bad input returns null
 * (zipCount returns 0), never a throw. No DOM. ES5 only.
 */
(function (root) {
  "use strict";
  var POD = root.POD;

  var R_MI = 3958.8;
  var ROAD = 1.25;
  var RADII = [5, 10, 25, 50];
  var WANT = 15;
  var NEIGHBORS = 6;
  var EPS = 1e-9;
  var BAND_DEG = 1.2;
  var BAND_REACH = BAND_DEG * Math.PI / 180 * R_MI;
  var MAX_TABLES = 8;
  var MAX_SPACING = 20000;
  var MAX_TILES = 2000;

  // ---- small helpers -------------------------------------------------------

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isLatLon(lat, lon) {
    return isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  /** Integer coordinates (thousandths of a degree) inside the ranges of contract section 3. */
  function inRange(laI, loI) {
    return laI >= -90000 && laI <= 90000 && loI >= -180000 && loI <= 180000;
  }
  function round1(y) { return Math.round(y * 10) / 10; }
  function rad(x) { return x * Math.PI / 180; }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  /** Great-circle miles, unrounded (contract section 2). */
  function distMi(lat1, lon1, lat2, lon2) {
    if (!isNum(lat1) || !isNum(lon1) || !isNum(lat2) || !isNum(lon2)) return null;
    var dLat = rad(lat2 - lat1);
    var dLon = rad(lon2 - lon1);
    var s1 = Math.sin(dLat / 2);
    var s2 = Math.sin(dLon / 2);
    var a = s1 * s1 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * s2 * s2;
    return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // ---- ZIP tables (section 3, 4) -------------------------------------------

  // Unpacked tables, keyed by the ZIP_PACKED string. Each entry also keeps a copy of
  // ZIP_CITIES, because the city index of each record is only valid against that list.
  var TABLES = {};
  var TABLE_COUNT = 0;

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function buildTable(packed, cities) {
    var t = {
      cities: cities.slice(),
      zips: [], la: [], lo: [], city: [], st: [],
      first: {},
      pts: [], lats: [], cos: [],
      spacing: {}, spacingCount: 0
    };
    var seen = {};
    var raws = packed.split(";");
    for (var i = 0; i < raws.length; i++) {
      var f = raws[i].split(",");
      if (f.length !== 5) continue;
      if (!/^\d{5}$/.test(f[0]) || !/^-?\d+$/.test(f[1]) || !/^-?\d+$/.test(f[2]) ||
          !/^\d+$/.test(f[3]) || !/^[A-Z]{2}$/.test(f[4])) continue;
      var ci = Number(f[3]);
      if (ci >= cities.length || typeof cities[ci] !== "string") continue;
      var laI = Number(f[1]);
      var loI = Number(f[2]);
      if (!inRange(laI, loI)) continue;
      t.zips.push(f[0]);
      t.la.push(laI / 1000);
      t.lo.push(loI / 1000);
      t.city.push(cities[ci]);
      t.st.push(f[4]);
      if (!hasOwn(t.first, f[0])) t.first[f[0]] = t.zips.length - 1;
      var key = String(laI) + "," + String(loI);
      if (!hasOwn(seen, key)) {
        seen[key] = true;
        t.pts.push({ la: laI / 1000, lo: loI / 1000, ia: laI, io: loI });
      }
    }
    t.pts.sort(function (a, b) {
      if (a.la !== b.la) return a.la < b.la ? -1 : 1;
      if (a.lo !== b.lo) return a.lo < b.lo ? -1 : 1;
      return 0;
    });
    for (var j = 0; j < t.pts.length; j++) {
      t.lats.push(t.pts[j].la);
      t.cos.push(Math.cos(rad(t.pts[j].la)));
    }
    return t;
  }

  /** The unpacked table for D, or null when D has no table shape at all. */
  function getTable(D) {
    if (!isObj(D) || typeof D.ZIP_PACKED !== "string" || !Array.isArray(D.ZIP_CITIES)) return null;
    var packed = D.ZIP_PACKED;
    var cities = D.ZIP_CITIES;
    var had = hasOwn(TABLES, packed);
    if (had && sameList(TABLES[packed].cities, cities)) return TABLES[packed];
    var t = buildTable(packed, cities);
    if (!had) {
      if (TABLE_COUNT >= MAX_TABLES) { TABLES = {}; TABLE_COUNT = 0; }
      TABLE_COUNT++;
    }
    TABLES[packed] = t;
    return t;
  }

  function recordAt(t, i) {
    return { z: t.zips[i], la: t.la[i], lo: t.lo[i], c: t.city[i], st: t.st[i] };
  }

  function zipCount(D) {
    var t = getTable(D);
    return t ? t.zips.length : 0;
  }

  function zipByCode(code, D) {
    if (typeof code !== "string" || !/^\d{5}$/.test(code)) return null;
    var t = getTable(D);
    if (!t || !hasOwn(t.first, code)) return null;
    return recordAt(t, t.first[code]);
  }

  function nearestZip(lat, lon, D) {
    if (!isLatLon(lat, lon)) return null;
    var t = getTable(D);
    if (!t || t.zips.length === 0) return null;
    var best = -1;
    var bestD = 0;
    for (var i = 0; i < t.zips.length; i++) {
      var d = distMi(lat, lon, t.la[i], t.lo[i]);
      if (best < 0 || d < bestD || (d === bestD && t.zips[i] < t.zips[best])) {
        best = i;
        bestD = d;
      }
    }
    return recordAt(t, best);
  }

  function lowerBound(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function upperBound(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] <= x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // Keeps the NEIGHBORS smallest values in ascending order.
  function keepNearest(top, d) {
    if (top.length < NEIGHBORS) {
      top.push(d);
    } else if (d < top[NEIGHBORS - 1]) {
      top[NEIGHBORS - 1] = d;
    } else {
      return;
    }
    for (var k = top.length - 1; k > 0 && top[k] < top[k - 1]; k--) {
      var x = top[k];
      top[k] = top[k - 1];
      top[k - 1] = x;
    }
  }

  /** distMi (section 2) for a point whose cos(rad(lat)) is already known. Same float order as distMi. */
  function pairMi(la, lo, cosA, p, cosP) {
    var dLat = rad(p.la - la);
    var dLon = rad(p.lo - lo);
    var s1 = Math.sin(dLat / 2);
    var s2 = Math.sin(dLon / 2);
    var a = s1 * s1 + cosA * cosP * s2 * s2;
    return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Mean miles to the 6 nearest distinct other points, or null (contract section 4). */
  function spacingOf(t, la, lo) {
    var pts = t.pts;
    var cosP = t.cos;
    var cosA = Math.cos(rad(la));
    var ownA = Math.floor(la * 1000 + 0.5);
    var ownO = Math.floor(lo * 1000 + 0.5);
    var top = [];
    var i, d, p;
    var from = lowerBound(t.lats, la - BAND_DEG);
    var to = upperBound(t.lats, la + BAND_DEG);
    for (i = from; i < to; i++) {
      p = pts[i];
      if (p.ia === ownA && p.io === ownO) continue;
      keepNearest(top, pairMi(la, lo, cosA, p, cosP[i]));
    }
    if (!(top.length === NEIGHBORS && top[NEIGHBORS - 1] <= BAND_REACH)) {
      top = [];
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (p.ia === ownA && p.io === ownO) continue;
        keepNearest(top, pairMi(la, lo, cosA, p, cosP[i]));
      }
      if (top.length < NEIGHBORS) return null;
    }
    var sum = top[0];
    for (i = 1; i < NEIGHBORS; i++) sum = sum + top[i];
    return sum / NEIGHBORS;
  }

  function zipSpacing(rec, D) {
    if (!isObj(rec) || !isLatLon(rec.la, rec.lo)) return null;
    var t = getTable(D);
    if (!t) return null;
    var key = String(rec.la) + "," + String(rec.lo);
    if (hasOwn(t.spacing, key)) return t.spacing[key];
    var v = spacingOf(t, rec.la, rec.lo);
    if (t.spacingCount >= MAX_SPACING) { t.spacing = {}; t.spacingCount = 0; }
    t.spacing[key] = v;
    t.spacingCount++;
    return v;
  }

  /** The fallback estimator (contract section 5). */
  function estimateMiles(rec, brandId, D) {
    if (typeof brandId !== "string" || !isObj(D) || !isObj(D.BRANDS) || !hasOwn(D.BRANDS, brandId)) return null;
    var brand = D.BRANDS[brandId];
    if (!isObj(brand)) return null;
    var stores = brand.stores;
    if (!isNum(stores) || !(stores > 0)) return null;
    var total = zipCount(D);
    if (!(total > 0)) return null;
    var spacing = zipSpacing(rec, D);
    if (spacing === null) return null;
    var zipsPerStore = total / stores;
    var raw = 0.45 * Math.sqrt(zipsPerStore) * Math.pow(spacing, 0.75);
    var one = clamp(raw, 0.4, 30);
    return {
      one: round1(one),
      round: round1(one * 2 * ROAD),
      spacing: spacing,
      zipsPerStore: zipsPerStore
    };
  }

  /** Round trip for a straight-line distance (contract section 6). */
  function tripMiles(straightMi) {
    return isNum(straightMi) && straightMi >= 0 ? round1(straightMi * 2 * ROAD) : null;
  }

  // ---- cells and tiles (contract sections 7, 8) ----------------------------

  function cellOf(lat, lon) {
    return isLatLon(lat, lon) ? Math.floor(lat) + "_" + Math.floor(lon) : null;
  }

  function cellsFor(lat, lon, r, D) {
    if (!isLatLon(lat, lon) || !isNum(r) || !(r > 0) || !isObj(D) || !isObj(D.TILE_INDEX)) return null;
    var delta = r / R_MI;
    var dLat = delta * 180 / Math.PI + EPS;
    var latLo = lat - dLat;
    var latHi = lat + dLat;
    var x = Math.sin(delta) / Math.cos(lat * Math.PI / 180);
    var lonLo, lonHi;
    if (Math.abs(lat) + dLat >= 90 || !(Math.abs(x) < 1)) {
      lonLo = -180;
      lonHi = 180;
    } else {
      var dLon = Math.asin(x) * 180 / Math.PI + EPS;
      lonLo = lon - dLon;
      lonHi = lon + dLon;
    }
    var a0 = Math.max(-90, Math.floor(latLo));
    var a1 = Math.min(90, Math.floor(latHi));
    var o0 = Math.max(-180, Math.floor(lonLo));
    var o1 = Math.min(180, Math.floor(lonHi));
    var out = [];
    for (var a = a0; a <= a1; a++) {
      for (var o = o0; o <= o1; o++) {
        var k = a + "_" + o;
        if (hasOwn(D.TILE_INDEX, k)) out.push(k);
      }
    }
    return out;
  }

  function tilePath(cell) {
    return typeof cell === "string" && /^-?\d+_-?\d+$/.test(cell) ? "src/data/stores/" + cell + ".js" : null;
  }

  // Parsed [b, la, lo] triples per cell, cached only while the tile's s and run are the same strings.
  // Brand ids are resolved per call, so a cached triple never depends on another D's brand tables.
  var TILE_CACHE = {};
  var TILE_CACHE_COUNT = 0;

  /** The usable records of a cell's tile as [b, la, lo] triples, or null if the tile isn't usable. */
  function tileRecords(D, cell) {
    if (!isObj(D.TILES) || !hasOwn(D.TILES, cell)) return null;
    var tile = D.TILES[cell];
    if (!isObj(tile) || tile.run !== D.BRANDS_RUN || typeof tile.s !== "string") return null;
    var s = tile.s;
    var run = tile.run;
    if (hasOwn(TILE_CACHE, cell)) {
      var hit = TILE_CACHE[cell];
      if (hit.s === s && hit.run === run) return hit.recs;
    }
    var recs = [];
    var raws = s.split(";");
    for (var i = 0; i < raws.length; i++) {
      var f = raws[i].split(",");
      if (f.length !== 3) continue;
      if (!/^-?\d+$/.test(f[0]) || !/^-?\d+$/.test(f[1]) || !/^-?\d+$/.test(f[2])) continue;
      if (!inRange(Number(f[1]), Number(f[2]))) continue;
      recs.push([Number(f[0]), Number(f[1]), Number(f[2])]);
    }
    if (!hasOwn(TILE_CACHE, cell)) {
      if (TILE_CACHE_COUNT >= MAX_TILES) { TILE_CACHE = {}; TILE_CACHE_COUNT = 0; }
      TILE_CACHE_COUNT++;
    }
    TILE_CACHE[cell] = { s: s, run: run, recs: recs };
    return recs;
  }

  /** The brand id at index b of BRAND_IDS, or null if it isn't a usable brand. */
  function brandIdAt(D, b) {
    if (!Array.isArray(D.BRAND_IDS) || !(b >= 0) || b >= D.BRAND_IDS.length) return null;
    var id = D.BRAND_IDS[b];
    if (typeof id !== "string" || !hasOwn(D.BRANDS, id) || !isObj(D.BRANDS[id])) return null;
    return id;
  }

  /** Whether each cell has a tile, and whether the result is partial (section 9). */
  function cellState(D, cells, failed) {
    var need = [];
    var partial = false;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var has = isObj(D.TILES) && hasOwn(D.TILES, c);
      var fail = isObj(failed) && hasOwn(failed, c) && failed[c] === true;
      if (!has && !fail) need.push(c);
      if (!has && fail) partial = true;
      if (has && tileRecords(D, c) === null) partial = true;
    }
    return { need: need, partial: partial };
  }

  // ---- stores (contract sections 9, 10) ------------------------------------

  function searchReady(lat, lon, D) {
    return isLatLon(lat, lon) && isObj(D) && isObj(D.TILE_INDEX) && Array.isArray(D.BRAND_IDS) &&
      isObj(D.BRANDS) && typeof D.BRANDS_RUN === "string";
  }

  function failedOf(opts) {
    return isObj(opts) && isObj(opts.failed) ? opts.failed : null;
  }

  /** Usable store records within r miles of the cells. onlyId (or null) keeps one brand. */
  function candidates(lat, lon, r, cells, D, onlyId) {
    var out = [];
    for (var c = 0; c < cells.length; c++) {
      var recs = tileRecords(D, cells[c]);
      if (!recs) continue;
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i];
        var id = brandIdAt(D, rec[0]);
        if (id === null || (onlyId !== null && id !== onlyId)) continue;
        var mi = distMi(lat, lon, rec[1] / 1000, rec[2] / 1000);
        if (mi <= r) out.push({ id: id, la: rec[1], lo: rec[2], mi: mi });
      }
    }
    return out;
  }

  /** True when a is the preferred store: nearer, then smaller la, then smaller lo. */
  function nearerThan(a, b) {
    if (a.mi !== b.mi) return a.mi < b.mi;
    if (a.la !== b.la) return a.la < b.la;
    return a.lo < b.lo;
  }

  /** One candidate per brand: its nearest store. */
  function oneEachBrand(cands) {
    var index = {};
    var list = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var k = "b:" + c.id;
      if (!hasOwn(index, k)) {
        index[k] = list.length;
        list.push(c);
      } else if (nearerThan(c, list[index[k]])) {
        list[index[k]] = c;
      }
    }
    return list;
  }

  function storeOf(D, id, la, lo, mi) {
    var b = D.BRANDS[id];
    return {
      id: id + "@" + la + "," + lo,
      brand: id,
      name: typeof b.name === "string" ? b.name : null,
      category: typeof b.category === "string" ? b.category : null,
      profiled: isObj(D.PROFILES) && hasOwn(D.PROFILES, id),
      lat: la / 1000,
      lon: lo / 1000,
      mi: mi,
      trip: tripMiles(mi)
    };
  }

  function storesNear(lat, lon, D, opts) {
    if (!searchReady(lat, lon, D)) return null;
    var failed = failedOf(opts);
    for (var ri = 0; ri < RADII.length; ri++) {
      var r = RADII[ri];
      var cells = cellsFor(lat, lon, r, D);
      var st = cellState(D, cells, failed);
      if (st.need.length) return { status: "need", radius: r, need: st.need, stores: [], partial: false };
      var list = oneEachBrand(candidates(lat, lon, r, cells, D, null));
      list.sort(function (a, b) {
        if (a.mi !== b.mi) return a.mi < b.mi ? -1 : 1;
        if (a.id !== b.id) return a.id < b.id ? -1 : 1;
        return 0;
      });
      if (list.length >= WANT || ri === RADII.length - 1) {
        var stores = [];
        for (var i = 0; i < list.length; i++) stores.push(storeOf(D, list[i].id, list[i].la, list[i].lo, list[i].mi));
        return { status: "ok", radius: r, need: [], stores: stores, partial: st.partial };
      }
    }
    return null;
  }

  function nearestStore(lat, lon, brandId, D, opts) {
    if (!searchReady(lat, lon, D) || typeof brandId !== "string" || D.BRAND_IDS.indexOf(brandId) < 0) return null;
    var failed = failedOf(opts);
    var partial = false;
    for (var ri = 0; ri < RADII.length; ri++) {
      var r = RADII[ri];
      var cells = cellsFor(lat, lon, r, D);
      var st = cellState(D, cells, failed);
      partial = st.partial;
      if (st.need.length) return { status: "need", radius: r, need: st.need, store: null, partial: false };
      var cands = candidates(lat, lon, r, cells, D, brandId);
      var best = null;
      for (var i = 0; i < cands.length; i++) {
        if (best === null || nearerThan(cands[i], best)) best = cands[i];
      }
      if (best !== null) {
        return { status: "ok", radius: r, need: [], store: storeOf(D, brandId, best.la, best.lo, best.mi), partial: partial };
      }
    }
    return { status: "ok", radius: RADII[RADII.length - 1], need: [], store: null, partial: partial };
  }

  POD.geo = {
    distMi: distMi,
    zipCount: zipCount,
    zipByCode: zipByCode,
    nearestZip: nearestZip,
    zipSpacing: zipSpacing,
    estimateMiles: estimateMiles,
    tripMiles: tripMiles,
    cellOf: cellOf,
    cellsFor: cellsFor,
    tilePath: tilePath,
    storesNear: storesNear,
    nearestStore: nearestStore,
    R_MI: R_MI,
    ROAD: ROAD,
    RADII: RADII,
    WANT: WANT,
    NEIGHBORS: NEIGHBORS
  };
})(typeof window !== "undefined" ? window : this);
