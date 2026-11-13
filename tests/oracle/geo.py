"""Python reference for POD.geo (docs/geo-contract.md, D-030).

Written from the contract by the orchestrator, independently of src/js/geo.js. It's brute
force on purpose: no bands, no indexes, no caches. Speed doesn't matter here; being
obviously right does.

  python3 -I tests/oracle/geo.py --write   # regenerate tests/fixtures/geo/real.json

Standard library only.
"""
import json
import math
import os
import re
import sys

R_MI = 3958.8
ROAD = 1.25
RADII = (5, 10, 25, 50)
WANT = 15
NEIGHBORS = 6

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
STORE_FIXTURES = os.path.join(ROOT, "tests", "fixtures", "stores")
GEO_FIXTURES = os.path.join(ROOT, "tests", "fixtures", "geo")

INT_RE = re.compile(r"^-?\d+$")
ZIP_RE = re.compile(r"^\d{5}$")
ST_RE = re.compile(r"^[A-Z]{2}$")
CITY_RE = re.compile(r"^\d+$")
CELL_RE = re.compile(r"^-?\d+_-?\d+$")


# ---------------------------------------------------------------- input checks (§0)

def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def ok_point(lat, lon):
    return is_num(lat) and is_num(lon) and -90 <= lat <= 90 and -180 <= lon <= 180


def is_obj(x):
    return isinstance(x, dict)


def own(o, k):
    return is_obj(o) and isinstance(k, str) and k in o


# ---------------------------------------------------------------- §2 distance

def rad(x):
    return x * math.pi / 180


def dist_mi(lat1, lon1, lat2, lon2):
    if not all(is_num(v) for v in (lat1, lon1, lat2, lon2)):
        return None
    d_lat = rad(lat2 - lat1)
    d_lon = rad(lon2 - lon1)
    s1 = math.sin(d_lat / 2)
    s2 = math.sin(d_lon / 2)
    a = s1 * s1 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * s2 * s2
    return 2 * R_MI * math.asin(min(1, math.sqrt(a)))


def round1(x):
    """Math.round(x * 10) / 10 for x >= 0: halves go up."""
    y = x * 10
    f = math.floor(y)
    return (f + 1 if y - f >= 0.5 else f) / 10


# ---------------------------------------------------------------- §3 ZIP table

_PARSED = {}


def zip_records(D):
    """Usable records as (z, laInt, loInt, city, st), in table order. Parsing is cached per table
    (the only cache here: the 42k-record parse would otherwise dominate the oracle's run time)."""
    if not is_obj(D) or not isinstance(D.get("ZIP_PACKED"), str) or not isinstance(D.get("ZIP_CITIES"), list):
        return []
    key = (D["ZIP_PACKED"], tuple(c if isinstance(c, str) else None for c in D["ZIP_CITIES"]))
    if key not in _PARSED:
        if len(_PARSED) >= 4:
            _PARSED.clear()
        _PARSED[key] = _parse_zips(D["ZIP_PACKED"], D["ZIP_CITIES"])
    return _PARSED[key]


def _parse_zips(packed, cities):
    out = []
    if packed == "":
        return out
    for raw in packed.split(";"):
        f = raw.split(",")
        if len(f) != 5:
            continue
        z, la, lo, ci, st = f
        if not (ZIP_RE.match(z) and INT_RE.match(la) and INT_RE.match(lo) and CITY_RE.match(ci) and ST_RE.match(st)):
            continue
        ci = int(ci)
        if ci >= len(cities) or not isinstance(cities[ci], str):
            continue
        out.append((z, int(la), int(lo), cities[ci], st))
    return out


def rec_obj(r):
    return {"z": r[0], "la": r[1] / 1000, "lo": r[2] / 1000, "c": r[3], "st": r[4]}


def zip_count(D):
    return len(zip_records(D))


def zip_by_code(code, D):
    if not isinstance(code, str) or not ZIP_RE.match(code):
        return None
    for r in zip_records(D):
        if r[0] == code:
            return rec_obj(r)
    return None


def nearest_zip(lat, lon, D):
    if not ok_point(lat, lon):
        return None
    best = None
    for r in zip_records(D):
        d = dist_mi(lat, lon, r[1] / 1000, r[2] / 1000)
        if best is None or d < best[0] or (d == best[0] and r[0] < best[1][0]):
            best = (d, r)
    return rec_obj(best[1]) if best else None


# ---------------------------------------------------------------- §4 spacing

def zip_spacing(rec, D):
    if not is_obj(rec) or not ok_point(rec.get("la"), rec.get("lo")):
        return None
    points = sorted(set((r[1], r[2]) for r in zip_records(D)))
    ds = [dist_mi(rec["la"], rec["lo"], la / 1000, lo / 1000) for la, lo in points]
    ds = sorted(d for d in ds if d != 0)
    if len(ds) < NEIGHBORS:
        return None
    total = 0.0
    for d in ds[:NEIGHBORS]:
        total += d
    return total / NEIGHBORS


# ---------------------------------------------------------------- §5 estimator, §6 trip

def estimate_miles(rec, brand_id, D):
    if not is_obj(D) or not is_obj(D.get("BRANDS")) or not own(D["BRANDS"], brand_id):
        return None
    b = D["BRANDS"][brand_id]
    stores = b.get("stores") if is_obj(b) else None
    if not is_num(stores) or stores <= 0:
        return None
    total = zip_count(D)
    if total <= 0:
        return None
    spacing = zip_spacing(rec, D)
    if spacing is None:
        return None
    zps = total / stores
    raw = 0.45 * math.sqrt(zps) * math.pow(spacing, 0.75)
    one = min(max(raw, 0.4), 30)
    return {"one": round1(one), "round": round1(one * 2 * ROAD), "spacing": spacing, "zipsPerStore": zps}


def trip_miles(x):
    if not is_num(x) or x < 0:
        return None
    return round1(x * 2 * ROAD)


# ---------------------------------------------------------------- §7 cells

def cell_of(lat, lon):
    if not ok_point(lat, lon):
        return None
    return "%d_%d" % (math.floor(lat), math.floor(lon))


def cells_for(lat, lon, r, D):
    if not ok_point(lat, lon) or not is_num(r) or r <= 0 or not is_obj(D) or not is_obj(D.get("TILE_INDEX")):
        return None
    delta = r / R_MI
    eps = 1e-9
    d_lat = delta * 180 / math.pi + eps
    lat_lo, lat_hi = lat - d_lat, lat + d_lat
    x = math.sin(delta) / math.cos(lat * math.pi / 180)
    if abs(lat) + d_lat >= 90 or x >= 1:
        lon_lo, lon_hi = -180, 180
    else:
        d_lon = math.asin(x) * 180 / math.pi + eps
        lon_lo, lon_hi = lon - d_lon, lon + d_lon
    out = []
    for a in range(math.floor(lat_lo), math.floor(lat_hi) + 1):
        for o in range(math.floor(lon_lo), math.floor(lon_hi) + 1):
            key = "%d_%d" % (a, o)
            if key in D["TILE_INDEX"]:
                out.append(key)
    return out


def tile_path(cell):
    if not isinstance(cell, str) or not CELL_RE.match(cell):
        return None
    return "src/data/stores/" + cell + ".js"


# ---------------------------------------------------------------- §8 tiles

def tile_usable(D, cell):
    t = D["TILES"][cell]
    return is_obj(t) and isinstance(t.get("run"), str) and t["run"] == D["BRANDS_RUN"] and isinstance(t.get("s"), str)


def tile_records(D, cell):
    ids = D["BRAND_IDS"]
    out = []
    s = D["TILES"][cell]["s"]
    if s == "":
        return out
    for raw in s.split(";"):
        f = raw.split(",")
        if len(f) != 3 or not all(INT_RE.match(x) for x in f):
            continue
        b, la, lo = (int(x) for x in f)
        if b < 0 or b >= len(ids) or not isinstance(ids[b], str) or not own(D["BRANDS"], ids[b]):
            continue
        out.append((ids[b], la, lo))
    return out


def store_obj(D, lat, lon, brand, la, lo, mi):
    b = D["BRANDS"][brand]
    return {"id": "%s@%d,%d" % (brand, la, lo), "brand": brand, "name": b.get("name"), "category": b.get("category"),
            "profiled": own(D.get("PROFILES"), brand), "lat": la / 1000, "lon": lo / 1000,
            "mi": mi, "trip": trip_miles(mi)}


def search_ok(lat, lon, D):
    return (ok_point(lat, lon) and is_obj(D) and is_obj(D.get("TILE_INDEX")) and isinstance(D.get("BRAND_IDS"), list)
            and is_obj(D.get("BRANDS")) and isinstance(D.get("BRANDS_RUN"), str))


def scan(lat, lon, r, D, opts):
    """(need, partial, [(brand, la, lo, mi)] within r) for one radius."""
    failed = opts.get("failed") if is_obj(opts) else None
    failed = failed if is_obj(failed) else {}
    tiles = D.get("TILES") if is_obj(D.get("TILES")) else {}
    cells = cells_for(lat, lon, r, D)
    need = [c for c in cells if c not in tiles and failed.get(c) is not True]
    if need:
        return need, False, []
    partial = False
    found = []
    for c in cells:
        if c not in tiles:
            partial = True  # failed to load
            continue
        if not tile_usable(dict(D, TILES=tiles), c):
            partial = True
            continue
        for brand, la, lo in tile_records(dict(D, TILES=tiles), c):
            mi = dist_mi(lat, lon, la / 1000, lo / 1000)
            if mi <= r:
                found.append((brand, la, lo, mi))
    return [], partial, found


def better(a, b):
    """Is store a = (brand, la, lo, mi) nearer than b (ties: smaller la, then lo)?"""
    return (a[3], a[1], a[2]) < (b[3], b[1], b[2])


def stores_near(lat, lon, D, opts=None):
    if not search_ok(lat, lon, D):
        return None
    for r in RADII:
        need, partial, found = scan(lat, lon, r, D, opts)
        if need:
            return {"status": "need", "radius": r, "need": need, "stores": [], "partial": False}
        best = {}
        for s in found:
            if s[0] not in best or better(s, best[s[0]]):
                best[s[0]] = s
        lst = sorted(best.values(), key=lambda s: (s[3], s[0]))
        if len(lst) >= WANT or r == RADII[-1]:
            return {"status": "ok", "radius": r, "need": [], "partial": partial,
                    "stores": [store_obj(D, lat, lon, *s) for s in lst]}
    raise AssertionError("unreachable")


def nearest_store(lat, lon, brand_id, D, opts=None):
    if not search_ok(lat, lon, D) or not isinstance(brand_id, str) or brand_id not in D["BRAND_IDS"]:
        return None
    partial = False
    for r in RADII:
        need, partial, found = scan(lat, lon, r, D, opts)
        if need:
            return {"status": "need", "radius": r, "need": need, "store": None, "partial": False}
        best = None
        for s in found:
            if s[0] == brand_id and (best is None or better(s, best)):
                best = s
        if best:
            return {"status": "ok", "radius": r, "need": [], "partial": partial, "store": store_obj(D, lat, lon, *best)}
    return {"status": "ok", "radius": RADII[-1], "need": [], "partial": partial, "store": None}


# ---------------------------------------------------------------- calls and data

# Where D goes in each call's argument list (the cases leave it out).
D_POS = {"zipCount": 0, "zipByCode": 1, "nearestZip": 2, "zipSpacing": 1, "estimateMiles": 2,
         "cellsFor": 3, "storesNear": 2, "nearestStore": 3}
FUNCS = {"distMi": dist_mi, "zipCount": zip_count, "zipByCode": zip_by_code, "nearestZip": nearest_zip,
         "zipSpacing": zip_spacing, "estimateMiles": estimate_miles, "tripMiles": trip_miles, "cellOf": cell_of,
         "cellsFor": cells_for, "tilePath": tile_path, "storesNear": stores_near, "nearestStore": nearest_store}


def call(name, args, D):
    a = list(args)
    if name in D_POS:
        a.insert(D_POS[name], D)
    return FUNCS[name](*a)


def js_literal(src, name):
    """The JSON value assigned to POD.data.<name> (or D.<name>) in a generated data file."""
    m = re.search(r"(?:POD\.data|D)\.%s\s*=\s*" % re.escape(name), src)
    if not m:
        raise ValueError("no %s" % name)
    value, _ = json.JSONDecoder().raw_decode(re.sub(r",(\s*[}\]])", r"\1", src[m.end():]))
    return value


def real_data():
    """POD.data as the app sees it (the data files index.html loads), without tiles."""
    def read(rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            return fh.read()
    z = read("src/data/zips.js")
    b = read("src/data/brands.js")
    p = read("src/data/profiles.js")
    m = re.search(r"PROFILES\s*=\s*", p)
    profiles, _ = json.JSONDecoder().raw_decode(re.sub(r",(\s*[}\]])", r"\1", p[m.end():]))
    return {"ZIP_PACKED": js_literal(z, "ZIP_PACKED"), "ZIP_CITIES": js_literal(z, "ZIP_CITIES"),
            "BRANDS": js_literal(b, "BRANDS"), "BRAND_IDS": js_literal(b, "BRAND_IDS"),
            "BRANDS_RUN": js_literal(b, "BRANDS_RUN"), "TILE_INDEX": js_literal(b, "TILE_INDEX"),
            "PROFILES": profiles}


def fixture_tiles():
    """{cell: tile} for every committed fixture tile."""
    out = {}
    for name in sorted(os.listdir(STORE_FIXTURES)):
        if not name.endswith(".js"):
            continue
        with open(os.path.join(STORE_FIXTURES, name), encoding="utf-8") as fh:
            src = fh.read()
        m = re.search(r'TILES\["([^"]+)"\]\s*=\s*', src)
        tile, _ = json.JSONDecoder().raw_decode(src[m.end():])
        out[m.group(1)] = tile
    return out


def real_D(base, tiles_all, case):
    """The real data with the case's tiles: all fixtures unless the case lists `tiles`."""
    D = dict(base)
    cells = case.get("tiles")
    D["TILES"] = dict(tiles_all) if cells is None else {c: tiles_all[c] for c in cells}
    for c, run in (case.get("tileRun") or {}).items():
        D["TILES"][c] = dict(D["TILES"][c], run=run)
    return D


def synthetic_D(datasets, case):
    D = json.loads(json.dumps(datasets[case["data"]]))
    for k, v in (case.get("patch") or {}).items():
        D[k] = v
    return D


# ---------------------------------------------------------------- real-data cases (--write)

def real_case_inputs():
    """The calls whose expected values come from this reference (tests/fixtures/geo/real.json)."""
    C = []

    def add(cid, name, args, **kw):
        c = {"id": cid, "data": "real", "call": name, "args": args}
        c.update(kw)
        C.append(c)

    add("zipCount", "zipCount", [])
    for z in ("10118", "59011", "11201", "00501", "90004", "99950", "96701"):
        add("zipByCode " + z, "zipByCode", [z])
    add("zipByCode unknown", "zipByCode", ["99998"])
    add("nearestZip Empire State Building", "nearestZip", [40.7484, -73.9857])
    add("nearestZip Big Timber courthouse", "nearestZip", [45.8346, -109.9555])
    add("nearestZip on a stacked point (90004 group)", "nearestZip", [33.787, -118.299])
    add("nearestZip Gulf of Mexico", "nearestZip", [27.0, -90.0])
    for z in ("10118", "59011", "11201", "10001", "10007", "90004", "00501", "99950", "96701", "59001", "82190"):
        add("zipSpacing " + z, "zipSpacing", [{"zip": z}])
    for z, b in (("10118", "dominos"), ("59011", "dominos"), ("11201", "dominos"), ("10118", "the_cheesecake_factory"),
                 ("59011", "zippys"), ("90004", "dominos"), ("59011", "subway")):
        add("estimateMiles %s %s" % (z, b), "estimateMiles", [{"zip": z}, b])
    for (lat, lon, tag) in ((40.749, -73.986, "Midtown"), (45.834, -109.95, "Big Timber"),
                            (40.9995, -73.0005, "a cell corner"), (64.5, -147.3, "Fairbanks"),
                            (64.5, -147.319, "Fairbanks, 0.0001 deg inside the exact reach of 64_-150")):
        for r in (5, 10, 25, 50):
            add("cellsFor %s r=%d" % (tag, r), "cellsFor", [lat, lon, r])
    add("storesNear Midtown 10118", "storesNear", [40.749, -73.986, None])
    add("storesNear Brooklyn 11201", "storesNear", [40.694, -73.989, None])
    add("storesNear Big Timber 59011", "storesNear", [45.834, -109.95, None])
    add("storesNear Billings, inside 45_-109", "storesNear", [45.7833, -108.5007, None])
    add("storesNear Midtown, no tiles loaded", "storesNear", [40.749, -73.986, None], tiles=[])
    add("storesNear Midtown, only 40_-74 loaded", "storesNear", [40.749, -73.986, None], tiles=["40_-74"])
    add("storesNear Midtown, 40_-75 failed", "storesNear", [40.749, -73.986, {"failed": {"40_-75": True}}],
        tiles=["40_-74"])
    add("storesNear Big Timber, 45_-109 from another run", "storesNear", [45.834, -109.95, None],
        tileRun={"45_-109": "2020-01-01-00-00-00"})
    add("storesNear Big Timber, nothing loaded", "storesNear", [45.834, -109.95, None], tiles=[])
    for lat, lon, tag in ((40.749, -73.986, "Midtown"), (45.834, -109.95, "Big Timber")):
        for b in ("dominos", "the_cheesecake_factory", "subway", "taco_bell", "zippys"):
            add("nearestStore %s %s" % (tag, b), "nearestStore", [lat, lon, b, None])
    add("nearestStore Big Timber dominos, 45_-111 failed", "nearestStore",
        [45.834, -109.95, "dominos", {"failed": {"45_-111": True}}], tiles=["45_-109", "45_-110", "46_-110"])
    return C


def resolve_args(case, base):
    """Replace {"zip": code} placeholders with that ZIP's record from the real table."""
    out = []
    for a in case["args"]:
        if isinstance(a, dict) and set(a) == {"zip"}:
            a = zip_by_code(a["zip"], base)
        out.append(a)
    return out


def write_real():
    base = real_data()
    tiles = fixture_tiles()
    cases = []
    for c in real_case_inputs():
        c = dict(c, args=resolve_args(c, base))
        c["expect"] = call(c["call"], c["args"], real_D(base, tiles, c))
        cases.append(c)
    doc = {
        "about": "Real-data geo cases. Expected values come from tests/oracle/geo.py (the Python reference), "
                 "regenerated with `python3 -I tests/oracle/geo.py --write`. D is POD.data with the fixture tiles "
                 "from tests/fixtures/stores/ in D.TILES: all of them unless the case lists `tiles`. `tileRun` "
                 "replaces a tile's run id. Unrounded distances compare with a relative tolerance of 1e-9.",
        "run": base["BRANDS_RUN"],
        "cases": cases,
    }
    path = os.path.join(GEO_FIXTURES, "real.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print("geo: wrote %d cases to %s" % (len(cases), os.path.relpath(path, ROOT)))


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write_real()
    else:
        print(__doc__)
