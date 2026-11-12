#!/usr/bin/env python3
"""build-stores.py: restaurant brands and store tiles from All The Places (D-021).

Writes:
  --brands-out  src/data/brands.js   BRANDS, BRAND_IDS, BRANDS_RUN, TILE_INDEX
  --tiles-out   <dir>/<cell>.js      POD.data.TILES["<cell>"] = {run, s}

Downloads are cached under --cache (gzip, one file per member), so a rerun
reads the cache and makes no network calls for data it already has.

Usage:
  python3 -I tools/build-stores.py --run latest|<run_id> --as-of YYYY-MM-DD \
      --cache DIR --brands-out FILE --tiles-out DIR [--cells 40_-74,45_-111] \
      [--nsi-ref main]

Standard library only. Downloaded content is parsed as data, never executed.
"""

import argparse
import gzip
import http.client
import io
import json
import math
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile

RUNS_BASE = "https://data.alltheplaces.xyz/runs"
ATP_HOST = "https://alltheplaces-data.openaddresses.io"
NSI_BASE = "https://raw.githubusercontent.com/osmlab/name-suggestion-index"
NSI_FILES = ["fast_food", "restaurant", "cafe", "ice_cream"]
FOOD_AMENITIES = {"fast_food", "restaurant", "cafe", "ice_cream"}
MIN_STORES = 25
CREDIT = "Data © All The Places contributors, CC-0 (D-020)"
USER_AGENT = "pod-build-stores/1.0"

# D-021 category table: first ';' token of cuisine -> category.
CUISINE_CATEGORY = {}
for _cat, _tokens in [
    ("pizza", ["pizza"]),
    ("burger", ["burger"]),
    ("chicken", ["chicken", "wings", "fried_chicken"]),
    ("mexican", ["mexican", "tex-mex", "tacos", "burrito"]),
    ("sandwich", ["sandwich", "sub", "deli", "bagel"]),
    ("asian", ["chinese", "japanese", "asian", "sushi", "thai", "korean",
               "vietnamese", "indian", "ramen", "noodle"]),
    ("coffee", ["coffee_shop", "coffee", "donut", "tea", "bubble_tea"]),
    ("dessert", ["ice_cream", "frozen_yogurt", "dessert", "cake", "cookies",
                 "juice", "smoothie"]),
]:
    for _t in _tokens:
        CUISINE_CATEGORY[_t] = _cat

AMENITY_CATEGORY = {
    "restaurant": "casual",
    "cafe": "coffee",
    "ice_cream": "dessert",
    "fast_food": "other",
}

CELL_RE = re.compile(r"-?\d+_-?\d+\Z")
QID_RE = re.compile(r"Q\d+\Z")
RUN_RE = re.compile(r"\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\Z")
# Remote URLs go into /* */ comments, so only this shape is allowed.
URL_RE = re.compile(r"https://[a-z0-9.-]+/[A-Za-z0-9._/-]+\Z")


def fail(msg):
    print("build-stores: " + msg, file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- downloads

RANGE_CHUNK = 16 * 1024 * 1024          # largest single ranged GET
TRANSIENT = (urllib.error.URLError, http.client.HTTPException, OSError)


class RangeError(RuntimeError):
    """A response we refuse to read (wrong status or length). Never retried."""


def http_get(url, tries=3, limit=64 * 1024 * 1024):
    """GET a small file in full. Returns (status, headers, body)."""
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                cl = resp.headers.get("Content-Length")
                if cl is not None and int(cl) > limit:
                    raise RangeError("response too large (%s bytes): %s" % (cl, url))
                body = resp.read(limit + 1)
            if len(body) > limit:
                raise RangeError("response over %d bytes: %s" % (limit, url))
            return resp.status, resp.headers, body
        except TRANSIENT as e:
            last = e
    raise RuntimeError("GET %s failed: %s" % (url, last))


def http_range(url, start, end):
    """One ranged GET of bytes start..end. Status and Content-Length are checked before the body is read."""
    want = end - start + 1
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Range": "bytes=%d-%d" % (start, end),
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status != 206:
            raise RangeError("expected 206 for a Range request, got %s" % resp.status)
        cl = resp.headers.get("Content-Length")
        if cl is None or int(cl) != want:
            raise RangeError("Content-Length %s, wanted %d" % (cl, want))
        data = resp.read(want)          # at most the requested count
    if len(data) != want:
        raise OSError("short range read: %d of %d" % (len(data), want))
    return data


def cache_read_gz(path):
    with gzip.open(path, "rb") as fh:
        return fh.read()


def cache_write_gz(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            gz.write(data)
    os.replace(tmp, path)


class HttpRangeFile(io.RawIOBase):
    """Read-only seekable file over HTTP Range requests, for zipfile.ZipFile.

    Pass it straight to zipfile (no BufferedReader wrapper: that broke readinto).
    read(n) returns at most n bytes, fetched in RANGE_CHUNK pieces.
    """

    def __init__(self, url):
        super().__init__()
        self.url = url
        self.pos = 0
        self.requests = 0
        self.bytes_read = 0
        _, headers, _ = http_get_head(url)
        self.size = int(headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            new = offset
        elif whence == io.SEEK_CUR:
            new = self.pos + offset
        else:
            new = self.size + offset
        if new < 0:
            raise ValueError("negative seek position")
        self.pos = new
        return self.pos

    def _fetch(self, start, end):
        last = None
        for _ in range(3):
            try:
                data = http_range(self.url, start, end)
            except TRANSIENT as e:
                last = e
                continue
            self.requests += 1
            self.bytes_read += len(data)
            return data
        raise RuntimeError("range read failed: %s" % last)

    def read(self, size=-1):
        if size is None or size < 0:
            size = self.size - self.pos
        out = []
        remaining = size
        while remaining > 0 and self.pos < self.size:
            n = min(remaining, RANGE_CHUNK, self.size - self.pos)
            data = self._fetch(self.pos, self.pos + n - 1)
            out.append(data)
            remaining -= len(data)
            self.pos += len(data)
        return b"".join(out)

    def readinto(self, b):
        data = self.read(len(b))
        n = len(data)
        b[:n] = data
        return n


def http_get_head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, resp.headers, b""


def fetch_json_cached(url, path):
    """Download JSON once into a gzip cache file, return the parsed object."""
    if not os.path.exists(path):
        _, _, body = http_get(url)
        json.loads(body.decode("utf-8"))  # validate before caching
        cache_write_gz(path, body)
        print("  downloaded " + url)
    return json.loads(cache_read_gz(path).decode("utf-8"))


# ---------------------------------------------------------------- run resolution

def resolve_run(arg, cache_dir):
    """Returns (run_id, history_entry) where the entry has output_url and insights_url."""
    if arg == "latest":
        _, _, body = http_get(RUNS_BASE + "/latest.json")
        run_id = json.loads(body.decode("utf-8"))["run_id"]
        print("latest run resolves to " + run_id)
    else:
        run_id = arg
    if not RUN_RE.match(run_id):
        fail("bad run id: " + run_id)
    entry_path = os.path.join(cache_dir, run_id, "run.json.gz")
    if os.path.exists(entry_path):
        entry = json.loads(cache_read_gz(entry_path).decode("utf-8"))
    else:
        _, _, body = http_get(RUNS_BASE + "/history.json")
        history = json.loads(body.decode("utf-8"))
        matches = [r for r in history if r.get("run_id") == run_id]
        if not matches:
            fail("run %s is not in history.json" % run_id)
        entry = matches[0]
        cache_write_gz(entry_path, json.dumps(entry, sort_keys=True).encode("utf-8"))
    return run_id, entry


# ---------------------------------------------------------------- NSI and insights

def load_food_qids(cache_dir, nsi_ref):
    qids = set()
    for name in NSI_FILES:
        url = "%s/%s/data/brands/amenity/%s.json" % (NSI_BASE, nsi_ref, name)
        path = os.path.join(cache_dir, "nsi", nsi_ref, name + ".json.gz")
        data = fetch_json_cached(url, path)
        for item in data.get("items", []):
            tags = item.get("tags", {})
            q = tags.get("brand:wikidata")
            if isinstance(q, str) and QID_RE.match(q):
                qids.add(q)
    return qids


def load_us_spiders(cache_dir, run_id, insights_url, food_qids):
    """Returns ({qid: atp_brand}, sorted list of US spider names for food brands)."""
    path = os.path.join(cache_dir, run_id, "insights.json.gz")
    data = fetch_json_cached(insights_url, path)
    brand_names = {}
    spiders = set()
    for entry in data.get("data", []):
        q = entry.get("code")
        if not (isinstance(q, str) and QID_RE.match(q)) or q not in food_qids:
            continue
        us = (entry.get("atp_splits") or {}).get("US") or {}
        names = [s for s, n in us.items() if isinstance(n, int) and n > 0]
        if not names:
            continue
        brand_names[q] = entry.get("atp_brand") or ""
        spiders.update(names)
    return brand_names, sorted(spiders)


# ---------------------------------------------------------------- features

def round_half_away(x):
    """x * 1000 rounded half away from zero, as an int."""
    v = abs(x) * 1000.0
    n = int(math.floor(v + 0.5))
    return -n if x < 0 else n


def category_of(props):
    amenity = props.get("amenity")
    cuisine = props.get("cuisine")
    if isinstance(cuisine, str):
        token = cuisine.split(";")[0].strip().lower()
        if token in CUISINE_CATEGORY:
            return CUISINE_CATEGORY[token]
    return AMENITY_CATEGORY.get(amenity, "other")


def is_us(props, spider):
    country = props.get("addr:country")
    if country is not None:
        return country == "US"
    return spider.endswith("_us")


def valid_point(geom):
    if not isinstance(geom, dict) or geom.get("type") != "Point":
        return None
    c = geom.get("coordinates")
    if not isinstance(c, list) or len(c) < 2:
        return None
    lon, lat = c[0], c[1]
    if isinstance(lon, bool) or isinstance(lat, bool):
        return None
    if not (isinstance(lon, (int, float)) and isinstance(lat, (int, float))):
        return None
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return float(lat), float(lon)


def read_member(zf, spider, cache_dir, run_id, stats):
    path = os.path.join(cache_dir, run_id, "members", spider + ".geojson.gz")
    if os.path.exists(path):
        stats["cached"] += 1
        return cache_read_gz(path)
    info_name = "output/%s.geojson" % spider
    try:
        info = zf.getinfo(info_name)
    except KeyError:
        stats["missing"].append(spider)
        return None
    with zf.open(info) as fh:
        body = fh.read()
    cache_write_gz(path, body)
    stats["downloaded"] += 1
    return body


# ---------------------------------------------------------------- brands and ids

def slugify(name):
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def most_common(counter):
    """Most common key; ties go to the alphabetically first key."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def assign_ids(brands):
    """brands: {qid: {name, ...}} -> {qid: id}. Collisions get _<qid> on all but the largest."""
    groups = {}
    for q, b in brands.items():
        base = slugify(b["name"]) or q.lower()
        groups.setdefault(base, []).append(q)
    ids = {}
    for base, qids in groups.items():
        if len(qids) == 1:
            ids[qids[0]] = base
            continue
        ordered = sorted(qids, key=lambda q: (-brands[q]["stores"], q))
        top = brands[ordered[0]]["stores"]
        for q in ordered:
            if brands[q]["stores"] == top and sum(1 for x in qids if brands[x]["stores"] == top) == 1:
                ids[q] = base
            else:
                ids[q] = base + "_" + q.lower()
    return ids


# ---------------------------------------------------------------- output

def js_str(s):
    return json.dumps(s, ensure_ascii=True)


def provenance(run_id, as_of, output_url, insights_url, nsi_ref, extra_nulls, what):
    return (
        "/*\n"
        " * %s\n"
        " * Source:  All The Places run %s %s\n"
        " *          stats %s\n"
        " *          Name Suggestion Index food brands, ref %s: %s/%s/data/brands/amenity/{%s}.json\n"
        " * As of:   %s\n"
        " * Method:  generated by tools/build-stores.py\n"
        " * Nulls:   %s\n"
        " * Est:     none\n"
        " * %s\n"
        " */\n"
    ) % (what, run_id, output_url, insights_url, nsi_ref, NSI_BASE, nsi_ref,
         ",".join(NSI_FILES), as_of, extra_nulls, CREDIT)


WRAP_HEAD = (
    "(function (root) {\n"
    "  \"use strict\";\n"
    "  var POD = root.POD;\n"
)
WRAP_TAIL = "})(typeof window !== \"undefined\" ? window : this);\n"


def write_brands(path, header, brands, brand_ids, run_id, tile_index):
    lines = [header, WRAP_HEAD, "  POD.data = POD.data || {};\n", "  POD.data.BRANDS = {\n"]
    for bid in brand_ids:
        b = brands[bid]
        lines.append("    %s: {\"name\": %s, \"category\": %s, \"wikidata\": %s, \"stores\": %d},\n" % (
            js_str(bid), js_str(b["name"]), js_str(b["category"]), js_str(b["wikidata"]), b["stores"]))
    lines.append("  };\n")
    lines.append("  POD.data.BRAND_IDS = [\n")
    for bid in brand_ids:
        lines.append("    %s,\n" % js_str(bid))
    lines.append("  ];\n")
    lines.append("  POD.data.BRANDS_RUN = %s;\n" % js_str(run_id))
    lines.append("  POD.data.TILE_INDEX = {\n")
    for cell in sorted(tile_index):
        lines.append("    %s: %d,\n" % (js_str(cell), tile_index[cell]))
    lines.append("  };\n")
    lines.append(WRAP_TAIL)
    write_text(path, "".join(lines))


def write_tile(path, header, cell, run_id, records_str):
    body = (
        header
        + WRAP_HEAD
        + "  POD.data = POD.data || {};\n"
        + "  POD.data.TILES = POD.data.TILES || {};\n"
        + "  POD.data.TILES[%s] = {\"run\": %s, \"s\": %s};\n" % (
            js_str(cell), js_str(run_id), js_str(records_str))
        + WRAP_TAIL
    )
    write_text(path, body)
    return len(body.encode("utf-8"))


def write_text(path, text):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="run id, or 'latest'")
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD, written to the provenance headers")
    ap.add_argument("--cache", required=True, help="scratch cache dir, outside the repo")
    ap.add_argument("--brands-out", required=True)
    ap.add_argument("--tiles-out", required=True)
    ap.add_argument("--cells", default="", help="comma list of cells to write as tile files")
    ap.add_argument("--nsi-ref", default="main")
    args = ap.parse_args()

    if not re.match(r"\d{4}-\d{2}-\d{2}\Z", args.as_of):
        fail("--as-of must be YYYY-MM-DD")
    if not re.match(r"[A-Za-z0-9._-]+\Z", args.nsi_ref):
        fail("bad --nsi-ref")
    cells_only = None
    if args.cells:
        cells_only = [c.strip() for c in args.cells.split(",") if c.strip()]
        for c in cells_only:
            if not CELL_RE.match(c):
                fail("bad cell name: " + c)
        cells_only = set(cells_only)

    os.makedirs(args.cache, exist_ok=True)
    run_id, entry = resolve_run(args.run, args.cache)
    output_url = entry.get("output_url")
    insights_url = entry.get("insights_url")
    for label, url in (("output_url", output_url), ("insights_url", insights_url)):
        if not (isinstance(url, str) and URL_RE.match(url) and "*/" not in url):
            fail("refusing to write %s from the run index: %r" % (label, url))
    print("run %s" % run_id)

    food_qids = load_food_qids(args.cache, args.nsi_ref)
    print("NSI food QIDs: %d" % len(food_qids))
    atp_names, spiders = load_us_spiders(args.cache, run_id, insights_url, food_qids)
    print("US food brands in run: %d, member spiders: %d" % (len(atp_names), len(spiders)))

    reader = HttpRangeFile(output_url)
    zf = zipfile.ZipFile(reader)
    stats = {"cached": 0, "downloaded": 0, "missing": []}
    seen = {}          # (qid, la, lo) -> feature props (first kept wins)
    raw_kept = 0
    for spider in spiders:
        body = read_member(zf, spider, args.cache, run_id, stats)
        if body is None:
            continue
        doc = json.loads(body.decode("utf-8"))
        for feat in doc.get("features", []):
            props = feat.get("properties") or {}
            if props.get("amenity") not in FOOD_AMENITIES:
                continue
            q = props.get("brand:wikidata")
            if not (isinstance(q, str) and QID_RE.match(q)) or q not in food_qids:
                continue
            if not is_us(props, spider):
                continue
            pt = valid_point(feat.get("geometry"))
            if pt is None:
                continue
            raw_kept += 1
            la = round_half_away(pt[0])
            lo = round_half_away(pt[1])
            key = (q, la, lo)
            if key not in seen:
                seen[key] = {"brand": props.get("brand"), "name": props.get("name"),
                             "category": category_of(props), "lat": pt[0], "lon": pt[1]}
    print("member files: %d downloaded, %d cached, %d missing from zip; range requests: %d"
          % (stats["downloaded"], stats["cached"], len(stats["missing"]), reader.requests))
    if stats["missing"]:
        print("  missing spiders: " + ", ".join(sorted(stats["missing"])))
    print("US food features with valid coordinates: %d; after dedupe: %d" % (raw_kept, len(seen)))

    # Group deduped records by brand.
    by_brand = {}
    for (q, la, lo), p in seen.items():
        by_brand.setdefault(q, []).append((la, lo, p))

    brands = {}
    for q, recs in by_brand.items():
        if len(recs) < MIN_STORES:
            continue
        names = {}
        alt_names = {}
        cats = {}
        for _, _, p in recs:
            cats[p["category"]] = cats.get(p["category"], 0) + 1
            if isinstance(p["brand"], str) and p["brand"].strip():
                nm = p["brand"].strip()
                names[nm] = names.get(nm, 0) + 1
            if isinstance(p["name"], str) and p["name"].strip():
                alt = p["name"].strip()
                alt_names[alt] = alt_names.get(alt, 0) + 1
        if names:
            name = most_common(names)
        elif alt_names:
            name = most_common(alt_names)
        else:
            name = atp_names.get(q) or q
        brands[q] = {"name": name, "category": most_common(cats) if cats else "other",
                     "wikidata": q, "stores": len(recs)}
    print("brands with >= %d deduped US stores: %d" % (MIN_STORES, len(brands)))

    ids = assign_ids(brands)
    by_id = {}
    for q, bid in ids.items():
        by_id[bid] = brands[q]
    brand_ids = sorted(by_id)
    index_of = {bid: i for i, bid in enumerate(brand_ids)}

    # Tiles: cell from the ×1000 integers, so a store and its tile can't disagree.
    tiles = {}
    disagree = 0
    for q, recs in by_brand.items():
        if q not in brands:
            continue
        b = index_of[ids[q]]
        for la, lo, p in recs:
            cell = "%d_%d" % (la // 1000, lo // 1000)
            if math.floor(p["lat"]) != la // 1000 or math.floor(p["lon"]) != lo // 1000:
                disagree += 1
            tiles.setdefault(cell, []).append((b, la, lo))
    tile_index = {}
    for cell in tiles:
        tile_index[cell] = len(tiles[cell])
    print("cells with stores: %d; records whose float floor differs from the rounded-int cell: %d"
          % (len(tiles), disagree))

    write_brands(
        args.brands_out,
        provenance(run_id, args.as_of, output_url, insights_url, args.nsi_ref,
                   "none for brands. Known gap ISS-007: McDonald's has no US split in this run and Wonder is not in ATP",
                   "brands: food restaurant brands with US stores in an All The Places run (D-021)"),
        by_id, brand_ids, run_id, tile_index)

    # Tile files.
    produced = set()
    largest = (0, "")
    cell_counts = {}
    for cell in sorted(tiles):
        recs = sorted(tiles[cell])
        # Unique by (b, la, lo) by construction of the dedupe key, but check anyway.
        if len(set(recs)) != len(recs):
            fail("duplicate record in tile " + cell)
        s = ";".join("%d,%d,%d" % r for r in recs)
        cell_counts[cell] = len(recs)
        if cells_only is None or cell in cells_only:
            produced.add(cell)
            path = os.path.join(args.tiles_out, cell + ".js")
            header = (
                "/*\n"
                " * stores tile %s: All The Places store locations, food brands, US (D-021)\n"
                " * Source:  All The Places run %s %s\n"
                " * As of:   %s\n"
                " * Method:  generated by tools/build-stores.py\n"
                " * Nulls:   none\n"
                " * Est:     none\n"
                " * %s\n"
                " */\n"
            ) % (cell, run_id, output_url, args.as_of, CREDIT)
            size = write_tile(path, header, cell, run_id, s)
            if size > largest[0]:
                largest = (size, cell)
    # Remove stale tile files this run would not produce.
    if os.path.isdir(args.tiles_out):
        for name in os.listdir(args.tiles_out):
            if not name.endswith(".js"):
                continue
            cell = name[:-3]
            if not CELL_RE.match(cell):
                continue
            if cell not in produced and (cells_only is None or cell in cells_only):
                os.remove(os.path.join(args.tiles_out, name))
                print("removed stale tile " + name)

    total = sum(brands[q]["stores"] for q in brands)
    print("total stores kept: %d" % total)
    print("brands: %d" % len(brands))
    print("top 30 brands by stores:")
    top = sorted(brand_ids, key=lambda b: (-by_id[b]["stores"], b))[:30]
    for bid in top:
        print("  %6d  %-28s %s" % (by_id[bid]["stores"], bid, by_id[bid]["name"]))
    print("tile cells in run: %d; tile files written: %d" % (len(tiles), len(produced)))
    print("largest tile: %s, %d bytes" % (largest[1] or "none", largest[0]))
    if cells_only is not None:
        for cell in sorted(cells_only):
            print("fixture cell %s: %d records" % (cell, cell_counts.get(cell, 0)))


if __name__ == "__main__":
    main()
