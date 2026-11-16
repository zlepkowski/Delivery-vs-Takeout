"""Hand-worked expectations for the Worker and the browser seam (docs/api-contract.md, D-040).

An independent Python reading of the API contract. It never runs or imports worker/ or src/js/api.js.
It reads the provider fixtures in this folder (recorded or constructed, see README.md) and writes
cases.json: the Worker's exact responses, upstream URLs and cache writes, and the seam's pure
functions on hand-picked inputs.

    python3 -I tests/fixtures/api/build.py tests/fixtures/api/cases.json
"""
import copy
import hashlib
import json
import math
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
R_MI = 3958.8
UA = "pod-test/1.0 (fixture contact)"
ORIGIN_OK = "https://zlepkowski.github.io"
ENV = {"USER_AGENT": UA, "ALLOW_ORIGINS": ORIGIN_OK}
W = "https://worker.test"
OSRM = "https://router.project-osrm.org"
NOM = "https://nominatim.openstreetmap.org"
OVP = "https://overpass-api.de/api/interpreter"
CATS = ["pizza", "burger", "chicken", "mexican", "sandwich", "asian", "coffee", "dessert", "casual", "other"]

# JS's \s and String.prototype.trim set (ECMA-262 WhiteSpace + LineTerminator). Python's own \s differs
# (it includes U+001C-U+001F and leaves out U+FEFF), so it is spelled out.
JS_WS = "\t\n\v\f\r                  　﻿"
WS_RUN = re.compile("[" + re.escape(JS_WS) + "]+")


def fixture(rel):
    with open(os.path.join(HERE, rel)) as f:
        return json.load(f)


# ---------------------------------------------------------------- numbers (api contract §1)
def jsround(y):
    """JS Math.round: the nearest integer, halves toward +infinity, computed exactly on the double."""
    f = math.floor(y)
    return f + (1 if y - f >= 0.5 else 0)


def round2(x): return jsround(x * 100) / 100
def round1(x): return jsround(x * 10) / 10


def rad(x): return x * math.pi / 180


def dist_mi(lat1, lon1, lat2, lon2):     # geography contract §2, term for term
    d_lat = rad(lat2 - lat1)
    d_lon = rad(lon2 - lon1)
    s1 = math.sin(d_lat / 2)
    s2 = math.sin(d_lon / 2)
    a = s1 * s1 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * s2 * s2
    return 2 * R_MI * math.asin(min(1, math.sqrt(a)))


def js_str(x):
    """String(Number) for the values a coordinate parameter can hold (|x| <= 999.999999)."""
    if x == int(x):
        return str(int(x))              # also turns -0.0 into "0", as JS does
    r = repr(x)
    return format(Decimal(r), "f") if "e" in r else r


def is_num(x): return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def u16len(s): return sum(2 if ord(c) > 0xFFFF else 1 for c in s)


def js_trim(s): return s.strip(JS_WS)


def form_encode(s):
    """URLSearchParams' application/x-www-form-urlencoded byte serializer (WHATWG URL)."""
    out = []
    for b in s.encode("utf-8"):
        c = chr(b)
        if b == 0x20:
            out.append("+")
        elif c.isascii() and (c.isalnum() or c in "*-._"):
            out.append(c)
        else:
            out.append("%%%02X" % b)
    return "".join(out)


def qs(pairs): return "&".join(form_encode(k) + "=" + form_encode(v) for k, v in pairs)


# ---------------------------------------------------------------- Worker parameters (§1-§4)
COORD = re.compile(r"-?[0-9]{1,3}(\.[0-9]{1,6})?")


def coord(s, lo, hi):
    if not isinstance(s, str) or not COORD.fullmatch(s):
        return None
    v = float(s)
    return v if lo <= v <= hi else None


def latlon(s):
    if not isinstance(s, str) or s.count(",") != 1:
        return None
    a, b = s.split(",")
    la, lo = coord(a, -90, 90), coord(b, -180, 180)
    return None if la is None or lo is None else (la, lo)


def norm_q(text):
    t = WS_RUN.sub(" ", js_trim(text))
    if not (3 <= u16len(t) <= 200) or any(ord(c) < 0x20 for c in t):
        return None
    return t


ERR_STATUS = {"bad_param": 400, "too_far": 400, "no_endpoint": 404, "no_route": 404, "not_found": 404,
              "method": 405, "upstream": 502, "not_configured": 503}


# ---------------------------------------------------------------- providers (§2-§4)
def parse_body(resp):
    """The fixture's response as the Worker sees it: (status, parsed JSON or None)."""
    if resp.get("reject"):
        return None, None
    body = resp["body"] if "body" in resp else resp.get("text")
    if resp.get("bodyKind", "json") == "json" and not isinstance(body, str):
        return resp["status"], body
    try:
        return resp["status"], json.loads(body)
    except (ValueError, TypeError):
        return resp["status"], None


def drive_normal(resp):
    status, b = parse_body(resp)
    if status is None or b is None:
        return "upstream", None
    if status == 200 and isinstance(b, dict) and b.get("code") == "Ok" and isinstance(b.get("routes"), list) and b["routes"]:
        r = b["routes"][0]
        if isinstance(r, dict) and is_num(r.get("distance")) and r["distance"] >= 0 and is_num(r.get("duration")) and r["duration"] >= 0:
            return None, {"miles": round2(r["distance"] / 1609.344), "minutes": round1(r["duration"] / 60), "source": "osrm"}
    if isinstance(b, dict) and b.get("code") == "NoRoute":
        return "no_route", None
    return "upstream", None


def geocode_normal(resp):
    status, b = parse_body(resp)
    if status != 200 or not isinstance(b, list):
        return "upstream", None
    if not b:
        return "not_found", None
    r = b[0]
    if not isinstance(r, dict):
        return "upstream", None
    def num(v):    # contract §3: a finite number, or a string matching ^-?[0-9]+(\.[0-9]+)?$
        if is_num(v):
            return v
        return float(v) if isinstance(v, str) and re.fullmatch(r"-?[0-9]+(\.[0-9]+)?", v) else None
    lat, lon = num(r.get("lat")), num(r.get("lon"))
    if lat is None or lon is None:
        return "upstream", None
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        return "upstream", None
    a = r.get("address")
    if not isinstance(a, dict):
        return "upstream", None
    city = next((a[k] for k in ("city", "town", "village", "hamlet") if isinstance(a.get(k), str) and a[k] != ""), None)
    iso = a.get("ISO3166-2-lvl4")
    m = re.fullmatch(r"US-([A-Z]{2})", iso) if isinstance(iso, str) else None
    pc = a.get("postcode")
    zp = pc[:5] if isinstance(pc, str) and re.match(r"[0-9]{5}", pc) else None
    label = r["display_name"] if isinstance(r.get("display_name"), str) else None
    return None, {"lat": lat, "lon": lon, "city": city, "state": m.group(1) if m else None, "zip": zp,
                  "label": label, "source": "nominatim"}


def category(tags):
    cu = tags.get("cuisine")
    tok = cu.split(";")[0].strip(JS_WS).lower() if isinstance(cu, str) else ""
    table = [("pizza", ["pizza"]), ("burger", ["burger"]), ("chicken", ["chicken", "wings", "fried_chicken"]),
             ("mexican", ["mexican", "tex-mex", "tacos", "burrito"]), ("sandwich", ["sandwich", "sub", "deli", "bagel"]),
             ("asian", ["chinese", "japanese", "asian", "sushi", "thai", "korean", "vietnamese", "indian", "ramen", "noodle"]),
             ("coffee", ["coffee_shop", "coffee", "donut", "tea", "bubble_tea"]),
             ("dessert", ["ice_cream", "frozen_yogurt", "dessert", "cake", "cookies", "juice", "smoothie"])]
    for cat, words in table:
        if tok in words:
            return cat
    return {"restaurant": "casual", "cafe": "coffee", "ice_cream": "dessert", "fast_food": "other"}[tags["amenity"]]


def nearby_normal(resp, qlat, qlon, R):
    status, b = parse_body(resp)
    if status != 200 or not isinstance(b, dict) or not isinstance(b.get("elements"), list):
        return "upstream", None
    if isinstance(b.get("remark"), str) and "runtime error" in b["remark"]:
        return "upstream", None
    kept, seen = [], set()
    for e in b["elements"]:
        if not isinstance(e, dict) or e.get("type") not in ("node", "way", "relation"):
            continue
        i = e.get("id")
        if not (is_num(i) and i == int(i) and i >= 1) or not isinstance(e.get("tags"), dict):
            continue
        t = e["tags"]
        src = e if e["type"] == "node" else e.get("center")
        if not isinstance(src, dict):
            continue
        lat, lon = src.get("lat"), src.get("lon")
        if not (is_num(lat) and is_num(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        if not isinstance(t.get("name"), str):
            continue
        name = js_trim(t["name"])
        if not (1 <= u16len(name) <= 120):
            continue
        if any(isinstance(t.get(k), str) and t[k] != "" for k in ("brand", "brand:wikidata")):
            continue
        if t.get("amenity") not in ("restaurant", "fast_food", "cafe", "ice_cream"):
            continue
        pid = "osm:" + e["type"][0] + str(int(i))
        if pid in seen:
            continue
        d = dist_mi(qlat, qlon, lat, lon)
        if d > R:
            continue
        seen.add(pid)
        kept.append((d, pid, {"id": pid, "name": name, "category": category(t), "lat": lat, "lon": lon, "miles": round2(d)}))
    kept.sort(key=lambda k: (k[0], k[1]))
    return None, {"places": [k[2] for k in kept[:40]], "radius": R, "source": "osm"}


# ---------------------------------------------------------------- the Worker's answer to one request
def drive_url(fr, to): return "%s/route/v1/driving/%s,%s;%s,%s?overview=false&alternatives=false&steps=false" % (OSRM, fr[1], fr[0], to[1], to[0])
def geo_url(q): return NOM + "/search?" + qs([("q", q), ("format", "jsonv2"), ("addressdetails", "1"), ("limit", "1"), ("countrycodes", "us")])
def ovp_query(lat, lon, R):
    return ('[out:json][timeout:8];nwr["amenity"~"^(restaurant|fast_food|cafe|ice_cream)$"]["name"](around:%d,%s,%s);out center tags;'
            % (jsround(R * 1609.344), lat, lon))
def ovp_url(lat, lon, R): return OVP + "?" + qs([("data", ovp_query(lat, lon, R))])


CASES = []


def err(code): return {"error": {"code": code}}


def wcase(name, refs, path, upstream=None, expect=None, method="GET", origin="null", env=None, kv="empty", work=""):
    c = {"name": name, "refs": refs, "request": {"method": method, "url": W + path, "origin": origin},
         "env": dict(ENV) if env is None else env, "kv": kv, "upstream": upstream or {}, "expect": expect, "work": work}
    CASES.append(c)
    return c


def ok_expect(body, calls, puts, origin_hdr="null"):
    h = {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", "vary": "Origin"}
    if origin_hdr is not None:
        h["access-control-allow-origin"] = origin_hdr
    return {"status": 200, "headers": h, "body": body, "upstreamCalls": calls, "kvPuts": puts}


def err_expect(code, calls=None, puts=None, origin_hdr="null", extra=None):
    h = {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", "vary": "Origin"}
    if origin_hdr is not None:
        h["access-control-allow-origin"] = origin_hdr
    if extra:
        h.update(extra)
    return {"status": ERR_STATUS[code], "headers": h, "body": err(code), "upstreamCalls": calls or [], "kvPuts": puts or []}


def drive_case(name, refs, fr_s, to_s, resp, work="", **kw):
    fr, to = latlon(fr_s), latlon(to_s)
    frc, toc = (js_str(fr[0]), js_str(fr[1])), (js_str(to[0]), js_str(to[1]))
    url = drive_url(frc, toc)
    code, body = drive_normal(resp)
    key = "v1:drive:%s,%s;%s,%s" % (frc + toc)
    if code is None:
        exp = ok_expect(body, [url], [{"key": key, "value": {"ok": body}, "ttl": 604800}])
    else:
        exp = err_expect(code, [url], [{"key": key, "value": {"miss": code}, "ttl": 86400}] if code == "no_route" else [])
    return wcase(name, refs, "/drive?from=%s&to=%s" % (fr_s, to_s), {url: resp}, exp, work=work, **kw)


def geo_case(name, refs, raw_q, resp, work="", **kw):
    q = norm_q(raw_q)
    url = geo_url(q)
    code, body = geocode_normal(resp)
    key = "v1:geocode:" + hashlib.sha256(q.lower().encode("utf-8")).hexdigest()
    if code is None:
        exp = ok_expect(body, [url], [{"key": key, "value": {"ok": body}, "ttl": 2592000}])
    else:
        exp = err_expect(code, [url], [{"key": key, "value": {"miss": code}, "ttl": 86400}] if code == "not_found" else [])
    return wcase(name, refs, "/geocode?" + qs([("q", raw_q)]), {url: resp}, exp, work=work, **kw)


def nearby_case(name, refs, lat_s, lon_s, R, resp, work="", **kw):
    la, lo = coord(lat_s, -90, 90), coord(lon_s, -180, 180)
    lac, loc = js_str(la), js_str(lo)
    url = ovp_url(lac, loc, R)
    code, body = nearby_normal(resp, la, lo, R)
    key = "v1:nearby:%s,%s/%d" % (lac, loc, R)
    exp = ok_expect(body, [url], [{"key": key, "value": {"ok": body}, "ttl": 604800}]) if code is None else err_expect(code, [url])
    return wcase(name, refs, "/nearby?lat=%s&lon=%s&radius=%d" % (lat_s, lon_s, R), {url: resp}, exp, work=work, **kw), body


def rec(rel):
    """A fixture file's response, as the fake fetch returns it."""
    return dict(fixture(rel)["response"], fixture=rel)


def inline(status, text, ctype="application/json"): return {"status": status, "contentType": ctype, "bodyKind": "text", "text": text}


# ---- /drive (§2)
BT, LV, NY, ND = "45.834,-109.95", "45.67,-110.546", "40.749,-73.986", "40.755,-73.989"
c = drive_case("drive: Big Timber to the Livingston Domino's (recorded)", ["§2", "§5"], BT, LV, rec("osrm/bigtimber_livingston.json"),
               "54552.2 m / 1609.344 = %.6f -> 33.9 mi; 2176.1 s / 60 = %.4f -> 36.3 min. Cached 7 days." % (54552.2 / 1609.344, 2176.1 / 60))
assert c["expect"]["body"] == {"miles": 33.9, "minutes": 36.3, "source": "osrm"}
assert list(c["upstream"])[0] == fixture("osrm/bigtimber_livingston.json")["request"]["url"]
c = drive_case("drive: Empire State to the nearest Domino's (recorded)", ["§2"], NY, ND, rec("osrm/nyc_empire_dominos.json"),
               "1377.8 m -> %.5f -> 0.86 mi; 186.2 s -> 3.1 min." % (1377.8 / 1609.344))
assert c["expect"]["body"] == {"miles": 0.86, "minutes": 3.1, "source": "osrm"}
assert list(c["upstream"])[0] == fixture("osrm/nyc_empire_dominos.json")["request"]["url"]
c = drive_case("drive: canonical coordinates go upstream", ["§1", "§2"], "45.8340,-109.950", "45.670000,-110.546", rec("osrm/bigtimber_livingston.json"),
               "String(Number('45.8340')) = '45.834', '-109.950' -> '-109.95', '45.670000' -> '45.67': the same URL and cache key as the recorded case.")
assert list(c["upstream"])[0] == fixture("osrm/bigtimber_livingston.json")["request"]["url"]
drive_case("drive: no road route (recorded NoRoute, status 400)", ["§2", "§5"], "21.307,-157.858", "21.09,-157.02",
           rec("osrm/oahu_molokai_noroute.json"), "OSRM answers 400 with code NoRoute: 404 no_route, remembered for a day.")
G = fixture("osrm/bigtimber_livingston.json")["response"]["body"]
for label, resp in [("status 502 with an HTML body", inline(502, "<html>Bad Gateway</html>", "text/html")),
                    ("status 200 that isn't JSON", inline(200, "not json")),
                    ("an empty route list", inline(200, json.dumps({"code": "Ok", "routes": []}))),
                    ("a string distance", inline(200, json.dumps({"code": "Ok", "routes": [{"distance": "54552.2", "duration": 2176.1}]}))),
                    ("a negative duration", inline(200, json.dumps({"code": "Ok", "routes": [{"distance": 54552.2, "duration": -1}]}))),
                    ("code InvalidQuery", inline(400, json.dumps({"code": "InvalidQuery", "message": "Query string malformed"}))),
                    ("code Ok with status 500", inline(500, json.dumps(G))),
                    ("a rejected fetch (network error or timeout)", {"reject": True})]:
    drive_case("drive: upstream failure, %s" % label, ["§2"], BT, LV, resp, "502 upstream; nothing cached.")
for label, q in [("no from", "/drive?to=" + LV), ("no to", "/drive?from=" + BT),
                 ("from twice", "/drive?from=%s&from=%s&to=%s" % (BT, BT, LV)), ("three numbers", "/drive?from=45.834,-109.95,1&to=" + LV),
                 ("seven decimals", "/drive?from=45.8341234,-109.95&to=" + LV), ("a plus sign", "/drive?from=%2B45.834,-109.95&to=" + LV),
                 ("a space", "/drive?from=45.834,%20-109.95&to=" + LV), ("an exponent", "/drive?from=4e1,-109.95&to=" + LV),
                 ("latitude 90.5", "/drive?from=90.5,-109.95&to=" + LV), ("longitude -180.000001", "/drive?from=45.834,-180.000001&to=" + LV),
                 ("four integer digits", "/drive?from=45.834,-1099.5&to=" + LV), ("empty", "/drive?from=&to=" + LV)]:
    wcase("drive: bad input, %s" % label, ["§1", "§2"], q, None, err_expect("bad_param"))
wcase("drive: the edges -90, 180, 90 and -180 parse (and are too far apart)", ["§1", "§2"], "/drive?from=-90,180&to=90,-180", None, err_expect("too_far"),
      work="Both points are in range (not bad_param); they are %.1f mi apart in a straight line, so too_far." % dist_mi(-90, 180, 90, -180))
wcase("drive: more than 100 miles apart", ["§2"], "/drive?from=%s&to=%s" % (BT, NY), None, err_expect("too_far"),
      work="%.1f mi straight." % dist_mi(45.834, -109.95, 40.749, -73.986))
d100 = 100 / (R_MI * math.pi / 180)
assert dist_mi(0, 0, 1.448, 0) > 100 > dist_mi(0, 0, 1.447, 0)
wcase("drive: just over 100 miles", ["§2"], "/drive?from=0,0&to=1.448,0", None, err_expect("too_far"),
      work="1.448 deg of latitude = %.4f mi > 100 (100 mi is %.6f deg)." % (dist_mi(0, 0, 1.448, 0), d100))
drive_case("drive: just under 100 miles goes to the provider", ["§2"], "0,0", "1.447,0",
           inline(200, json.dumps({"code": "Ok", "routes": [{"distance": 161000, "duration": 6000}]})),
           "1.447 deg = %.4f mi <= 100, so OSRM is asked (an inline answer): 161000 m -> %.4f -> 100.04 mi; 6000 s -> 100 min." % (dist_mi(0, 0, 1.447, 0), 161000 / 1609.344))
key_bt = "v1:drive:45.834,-109.95;45.67,-110.546"
body_bt = {"miles": 33.9, "minutes": 36.3, "source": "osrm"}
wcase("drive: a cache hit answers without the provider", ["§5"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], []), kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("drive: a cached miss answers 404 without the provider", ["§5"], "/drive?from=%s&to=%s" % (BT, LV), None,
      err_expect("no_route"), kv={"preset": {key_bt: {"miss": "no_route"}}})
url_bt = drive_url(("45.834", "-109.95"), ("45.67", "-110.546"))
wcase("drive: a cache that throws is ignored", ["§5"], "/drive?from=%s&to=%s" % (BT, LV), {url_bt: rec("osrm/bigtimber_livingston.json")},
      ok_expect(body_bt, [url_bt], []), kv="throws")
wcase("drive: no cache binding at all", ["§0", "§5"], "/drive?from=%s&to=%s" % (BT, LV), {url_bt: rec("osrm/bigtimber_livingston.json")},
      ok_expect(body_bt, [url_bt], []), kv=None)

# ---- HTTP rules and CORS (§1)
wcase("OPTIONS: the preflight", ["§1"], "/drive", None, {"status": 204, "headers": {
    "access-control-allow-origin": "null", "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400", "vary": "Origin"},
    "body": None, "upstreamCalls": [], "kvPuts": []}, method="OPTIONS")
wcase("POST is refused", ["§1"], "/drive?from=%s&to=%s" % (BT, LV), None, err_expect("method", extra={"allow": "GET, OPTIONS"}), method="POST")
wcase("an unknown path", ["§1"], "/nearest?lat=1&lon=2&brand=x", None, err_expect("no_endpoint"))
wcase("the root path", ["§1"], "/", None, err_expect("no_endpoint"))
wcase("no USER_AGENT: 503 before parameters", ["§0", "§1"], "/drive?from=bad", None, err_expect("not_configured"),
      env={"ALLOW_ORIGINS": ORIGIN_OK})
wcase("an empty USER_AGENT: 503 before the cache", ["§0", "§1"], "/drive?from=%s&to=%s" % (BT, LV), None, err_expect("not_configured"),
      env={"USER_AGENT": "", "ALLOW_ORIGINS": ORIGIN_OK}, kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("CORS: an allowed origin is echoed", ["§1"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], [], origin_hdr=ORIGIN_OK), origin=ORIGIN_OK, kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("CORS: another origin gets no allow header", ["§1"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], [], origin_hdr=None), origin="https://other.example", kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("CORS: no Origin header gets no allow header", ["§1"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], [], origin_hdr=None), origin=None, kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("CORS: ALLOW_ORIGINS is a comma list with spaces", ["§0", "§1"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], [], origin_hdr="https://b.example"), origin="https://b.example",
      env={"USER_AGENT": UA, "ALLOW_ORIGINS": " https://a.example , https://b.example "}, kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("CORS: without ALLOW_ORIGINS only null is allowed", ["§0", "§1"], "/drive?from=%s&to=%s" % (BT, LV), None,
      ok_expect(body_bt, [], [], origin_hdr=None), origin=ORIGIN_OK, env={"USER_AGENT": UA}, kv={"preset": {key_bt: {"ok": body_bt}}})
wcase("errors carry CORS too", ["§1"], "/drive?from=1", None, err_expect("bad_param", origin_hdr=ORIGIN_OK), origin=ORIGIN_OK)

# ---- /geocode (§3)
ES_Q = "350 5th Ave, New York, NY 10118"
c = geo_case("geocode: a street address (recorded)", ["§3", "§5"], ES_Q, rec("nominatim/empire_state.json"),
             "city 'New York'; ISO3166-2-lvl4 'US-NY' -> NY; postcode 10118; lat/lon from Nominatim's strings. Cached 30 days under sha256 of the lowercase query.")
assert list(c["upstream"])[0] == fixture("nominatim/empire_state.json")["request"]["url"]
assert c["expect"]["body"]["zip"] == "10118" and c["expect"]["body"]["state"] == "NY" and c["expect"]["body"]["lat"] == 40.7484421
c = geo_case("geocode: a town (recorded)", ["§3"], "Big Timber, MT", rec("nominatim/big_timber.json"),
             "No address.city, so address.town 'Big Timber'.")
assert c["expect"]["body"]["city"] == "Big Timber" and c["expect"]["body"]["zip"] == "59011"
assert list(c["upstream"])[0] == fixture("nominatim/big_timber.json")["request"]["url"]
c = geo_case("geocode: nothing found (recorded [])", ["§3", "§5"], "Qqzzx Nowhere Road 99999", rec("nominatim/not_found.json"), "404 not_found, remembered a day.")
assert list(c["upstream"])[0] == fixture("nominatim/not_found.json")["request"]["url"]
c = geo_case("geocode: the query is trimmed and its spaces collapsed", ["§3"], "  350   5th Ave,\tNew York,  NY 10118 ", rec("nominatim/empire_state.json"),
             "Normalized to '%s', the recorded request." % ES_Q)
assert list(c["upstream"])[0] == fixture("nominatim/empire_state.json")["request"]["url"]
ES = fixture("nominatim/empire_state.json")["response"]["body"][0]
def es_with(**kw):
    r = copy.deepcopy(ES)
    for k, v in kw.items():
        if k.startswith("a_"):
            if v is None:
                r["address"].pop(k[2:].replace("_", "-") if k[2:] == "ISO3166_2_lvl4" else k[2:], None)
            else:
                r["address"][k[2:].replace("_", "-") if k[2:] == "ISO3166_2_lvl4" else k[2:]] = v
        elif v is None:
            r.pop(k, None)
        else:
            r[k] = v
    return inline(200, json.dumps([r]))
for label, resp in [("numeric lat and lon", es_with(lat=40.5, lon=-73.5)), ("an integer-string lat", es_with(lat="40")),
                    ("a ZIP+4 postcode", es_with(a_postcode="10118-0110")), ("a 4-digit postcode", es_with(a_postcode="1011")),
                    ("a lowercase ISO code", es_with(a_ISO3166_2_lvl4="US-ny")), ("a Puerto Rico ISO code", es_with(a_ISO3166_2_lvl4="PR-SJ")),
                    ("no city but a village", es_with(a_city=None, a_village="Fixture Village")),
                    ("an empty city, then a hamlet", es_with(a_city="", a_hamlet="Fixture Hamlet")),
                    ("no display_name", es_with(display_name=None)), ("a numeric postcode", es_with(a_postcode=10118))]:
    geo_case("geocode: %s" % label, ["§3"], ES_Q, resp)
for label, resp in [("lat that isn't a number", es_with(lat="abc")), ("lat 91", es_with(lat="91.0")), ("no address", es_with(address=None)),
                    ("an empty lat", es_with(lat="")), ("no lat", es_with(lat=None)), ("a hex lat", es_with(lat="0x28")),
                    ("a lat with spaces", es_with(lat=" 40.7")), ("a lat with an underscore", es_with(lat="40_7")),
                    ("lat Infinity", es_with(lat="Infinity")), ("a boolean lon", es_with(lon=True)),
                    ("an object, not an array", inline(200, json.dumps({"lat": "1"}))), ("status 429", inline(429, "Too Many Requests", "text/plain")),
                    ("an HTML body", inline(200, "<html></html>", "text/html")), ("a rejected fetch", {"reject": True})]:
    geo_case("geocode: upstream failure, %s" % label, ["§3"], ES_Q, resp, "502 upstream; nothing cached.")
for label, q in [("missing", "/geocode"), ("two characters", "/geocode?q=ab"), ("only spaces", "/geocode?q=%20%20%20%20"),
                 ("201 characters", "/geocode?q=" + "a" * 201), ("a control character", "/geocode?q=abc%07def"),
                 ("199 letters and an emoji (201 UTF-16 units)", "/geocode?" + qs([("q", "a" * 199 + "\U0001F355")])),
                 ("given twice", "/geocode?q=abc&q=def")]:
    wcase("geocode: bad input, %s" % label, ["§3"], q, None, err_expect("bad_param"))
wcase("geocode: exactly 200 characters is fine (cache hit)", ["§3", "§5"], "/geocode?q=" + "a" * 200, None,
      ok_expect({"lat": 1, "lon": 2, "city": None, "state": None, "zip": None, "label": None, "source": "nominatim"}, [], []),
      kv={"preset": {"v1:geocode:" + hashlib.sha256(("a" * 200).encode()).hexdigest():
                     {"ok": {"lat": 1, "lon": 2, "city": None, "state": None, "zip": None, "label": None, "source": "nominatim"}}}})
wcase("geocode: the cache key ignores case", ["§5"], "/geocode?" + qs([("q", ES_Q.upper())]), None,
      err_expect("not_found"), kv={"preset": {"v1:geocode:" + hashlib.sha256(ES_Q.lower().encode()).hexdigest(): {"miss": "not_found"}}},
      work="sha256('%s')." % ES_Q.lower())

# ---- /nearby (§4)
c, small = nearby_case("nearby: a small town (constructed)", ["§4", "§5"], "45.834", "-109.95", 5, rec("overpass/constructed_small_town.json"),
                       "Skipped: 1003 and 1013 (brand tags), 1004 (no name), 1008 (%.2f mi > 5), 1009 (bar), the second 1002 (repeat), "
                       "2002 (no center), 0 (id < 1), 1012 (tags not an object), 1017 (type area), 1018 (lat 91), 1019 (121-character name), 1020 (119 + an emoji = 121 UTF-16 units). Kept 1021 (119 units). "
                       "Kept 1010 (empty brand). Categories by D-021: american -> casual (restaurant), 'burger;american' -> burger, "
                       "'Pizza ;italian' -> pizza, thai -> asian, tacos -> mexican, ' Noodle' -> asian, french -> casual, "
                       "wings -> chicken, sandwich -> sandwich, no cuisine -> by amenity." % dist_mi(45.834, -109.95, 45.95, -109.95))
got = {p["id"]: p["category"] for p in small["places"]}
assert got == {"osm:n1001": "casual", "osm:n1002": "burger", "osm:w2001": "coffee", "osm:n1005": "dessert", "osm:n1006": "pizza",
               "osm:r3001": "asian", "osm:n1007": "mexican", "osm:n1010": "chicken", "osm:n1011": "sandwich", "osm:n1014": "asian",
               "osm:n1015": "other", "osm:n1016": "casual", "osm:n1021": "casual"}, got
assert [p["name"] for p in small["places"] if p["id"] == "osm:n1007"] == ["Fixture Taqueria"]
c, dense = nearby_case("nearby: a dense block keeps the nearest 40 (constructed)", ["§4"], "40.749", "-73.986", 2, rec("overpass/constructed_dense.json"),
                       "47 places within 0.7 mi. n9 and n10 share a point: by id in codepoint order 'osm:n10' < 'osm:n9'. Then n101 ... n138; n139-n145 dropped.")
assert [p["id"] for p in dense["places"][:3]] == ["osm:n10", "osm:n9", "osm:n101"] and len(dense["places"]) == 40 and dense["places"][-1]["id"] == "osm:n138"
nearby_case("nearby: a remark with a runtime error is a failure (constructed)", ["§4"], "45.834", "-109.95", 10, rec("overpass/constructed_remark.json"),
            "Overpass's partial results with status 200: 502, nothing cached.")
nearby_case("nearby: status 429 (constructed)", ["§4"], "45.834", "-109.95", 2, rec("overpass/constructed_429.json"))
for label, resp in [("elements not an array", inline(200, json.dumps({"elements": {}}))), ("a JSON array", inline(200, "[]")),
                    ("a rejected fetch", {"reject": True}), ("status 504", inline(504, "Gateway Timeout", "text/plain"))]:
    nearby_case("nearby: upstream failure, %s" % label, ["§4"], "45.834", "-109.95", 2, resp)
c, empty = nearby_case("nearby: no places is a 200 with an empty list", ["§4", "§5"], "45.834", "-109.95", 2,
                       inline(200, json.dumps({"version": 0.6, "elements": []})), "Cached like any other answer.")
assert empty["places"] == []
c, _ = nearby_case("nearby: a remark without 'runtime error' is fine", ["§4"], "45.834", "-109.95", 2,
                   inline(200, json.dumps({"elements": [], "remark": "note: nothing to report"})))
for label, q in [("radius 3", "/nearby?lat=45.834&lon=-109.95&radius=3"), ("radius 05", "/nearby?lat=45.834&lon=-109.95&radius=05"),
                 ("radius 2.0", "/nearby?lat=45.834&lon=-109.95&radius=2.0"), ("no radius", "/nearby?lat=45.834&lon=-109.95"),
                 ("no lat", "/nearby?lon=-109.95&radius=2"), ("lon 200", "/nearby?lat=45.834&lon=200&radius=2"),
                 ("lat given twice", "/nearby?lat=45.834&lat=45.834&lon=-109.95&radius=2")]:
    wcase("nearby: bad input, %s" % label, ["§4"], q, None, err_expect("bad_param"))
assert ovp_url("45.834", "-109.95", 5).count("%7E") == 1 and "around%3A8047%2C45.834%2C-109.95" in ovp_url("45.834", "-109.95", 5)
assert [jsround(r * 1609.344) for r in (2, 5, 10)] == [3219, 8047, 16093]

# ---------------------------------------------------------------- the browser seam (§6)
def T(tag): return {"$": tag}          # NaN, Infinity, -Infinity, -0, undefined (JSON can't carry them)
SEAM = []


def seam(fn, args, returns, work="", **kw):
    d = {"fn": fn, "args": args, "returns": returns, "work": work}
    d.update(kw)
    SEAM.append(d)


def fmt3(x):
    if not is_num(x):
        return None
    k = jsround(x * 1000)
    a = abs(k)
    return ("-" if k < 0 else "") + str(a // 1000) + "." + "%03d" % (a % 1000)


def point(lat, lon):
    if not (is_num(lat) and is_num(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return fmt3(lat) + "," + fmt3(lon)


def pt(o): return point(o.get("lat"), o.get("lon")) if isinstance(o, dict) else None


def drive_key(pos, store):
    a, b = pt(pos), pt(store)
    return None if a is None or b is None else a + ";" + b


def geo_query(text):
    if not isinstance(text, str):
        return None
    t = norm_q(text)
    return t if t is not None and re.search("[A-Za-z]", t) else None


def geo_key(text):
    q = geo_query(text)
    return None if q is None else q.lower()


def name_key(s): return re.sub("[^a-z0-9]", "", s.lower()) if isinstance(s, str) else None


for x, want in [(45.834, "45.834"), (-109.95, "-109.950"), (-0.0004, "0.000"), (0, "0.000"), (T("-0"), "0.000"), (0.0005, "0.001"),
                (-0.0005, "0.000"), (-1.0005, "-1.000"), (1.0005, "1.001"), (0.5005, "0.500"), (40.7484421, "40.748"), (-73.9856589, "-73.986"),
                (123456.7, "123456.700"), (T("NaN"), None), (T("Infinity"), None), ("1", None), (None, None), (True, None)]:
    xv = {"-0": -0.0}.get(x["$"]) if isinstance(x, dict) else x
    if not isinstance(x, dict) or x["$"] == "-0":
        assert fmt3(xv) == want, (x, fmt3(xv), want)
    seam("fmt3", [x], want, "k = Math.round(x * 1000), on the double: 1.0005 * 1000 = 1000.5 -> 1001, but 0.5005 * 1000 = 500.49999999999994 -> 500; -1.0005 * 1000 = -1000.5 rounds up to -1000; -0.0005 * 1000 = -0.5 rounds up to -0, which prints without a sign.")
for a, want in [((45.834, -109.95), "45.834,-109.950"), ((91, 0), None), ((0, 180.0001), None), (("45", 1), None), ((-90, -180), "-90.000,-180.000")]:
    seam("point", list(a), want)
for a, want in [(({"lat": 40, "lon": -74}, {"lat": 40.03, "lon": -74}), "40.000,-74.000;40.030,-74.000"),
                (({"lat": 40.0004, "lon": -74, "src": "gps"}, {"id": "pz@40030,-74000", "lat": 40.03, "lon": -74}), "40.000,-74.000;40.030,-74.000"),
                ((None, {"lat": 1, "lon": 1}), None), (({"lat": 1, "lon": 1}, {"lat": 1}), None), (([1, 2], {"lat": 1, "lon": 1}), None)]:
    seam("driveKey", list(a), want)
for t in ["350 5th Ave, New York, NY 10118", "  350   5th Ave ", "10118", "10118-0110", "NY", "a b", "12 b", "x" * 200, "x" * 201,
          "\tBig\nTimber ", "Big Timber", "Big\u001fTimber", "Big\u0007Timber", "﻿Big Timber﻿", "Café Olé", 10118, None, ["NY"]]:
    seam("geoQuery", [t], geo_query(t), "Trim, collapse JS whitespace runs (incl. U+00A0, U+FEFF; not U+001F), 3-200 UTF-16 units, no char < U+0020, a letter A-Z.")
    seam("geoKey", [t], geo_key(t))
seam("nearbyKey", [{"lat": 40.749, "lon": -73.986}, 5], "40.749,-73.986/5")
seam("nearbyKey", [{"lat": 91, "lon": 0}, 5], None)
for s in ["Domino's", "Subway", "Café Olé", "  Five  Guys ", "", 3]:
    seam("nameKey", [s], name_key(s))

def check_drive(b):
    if not isinstance(b, dict):
        return None
    m, n = b.get("miles"), b.get("minutes")
    return {"miles": m, "minutes": n} if is_num(m) and 0 <= m <= 1000 and is_num(n) and n >= 0 else None
def check_geocode(b):
    if not isinstance(b, dict):
        return None
    la, lo, z, s = b.get("lat"), b.get("lon"), b.get("zip"), b.get("state")
    if not (is_num(la) and is_num(lo) and -90 <= la <= 90 and -180 <= lo <= 180):
        return None
    if not (z is None or (isinstance(z, str) and re.fullmatch("[0-9]{5}", z))) or not (s is None or (isinstance(s, str) and re.fullmatch("[A-Z]{2}", s))):
        return None
    return {"lat": la, "lon": lo, "zip": z, "state": s}
ID_RE = re.compile("osm:[nwr][1-9][0-9]{0,15}")
def check_nearby(b):
    if not isinstance(b, dict) or not isinstance(b.get("places"), list):
        return None
    out = []
    for p in b["places"]:
        if not isinstance(p, dict):
            continue
        i, n, c_, la, lo = p.get("id"), p.get("name"), p.get("category"), p.get("lat"), p.get("lon")
        if not (isinstance(i, str) and ID_RE.fullmatch(i) and isinstance(n, str) and 1 <= u16len(n) <= 120 and c_ in CATS
                and is_num(la) and is_num(lo) and -90 <= la <= 90 and -180 <= lo <= 180):
            continue
        out.append({"id": i, "name": n, "category": c_, "lat": la, "lon": lo})
    return {"places": out}
for b in [body_bt, {"miles": 1000, "minutes": 0}, {"miles": 1000.01, "minutes": 1}, {"miles": -0.01, "minutes": 1}, {"miles": "3", "minutes": 1},
          {"miles": 3}, {"miles": 3, "minutes": -1}, None, [3, 4], "x"]:
    seam("checkDrive", [b], check_drive(b))
E_BODY = CASES[[x["name"] for x in CASES].index("geocode: a street address (recorded)")]["expect"]["body"]
for b in [E_BODY, dict(E_BODY, zip=None, state=None), dict(E_BODY, zip="1011"), dict(E_BODY, state="ny"), dict(E_BODY, lat=91),
          dict(E_BODY, lon="1"), dict(E_BODY, zip=10118), None, []]:
    seam("checkGeocode", [b], check_geocode(b))
NB = [{"id": "osm:n1", "name": "A", "category": "pizza", "lat": 1, "lon": 2, "miles": 0.1},
      {"id": "osm:x1", "name": "B", "category": "pizza", "lat": 1, "lon": 2}, {"id": "osm:n01", "name": "C", "category": "pizza", "lat": 1, "lon": 2},
      {"id": "osm:w2", "name": "", "category": "pizza", "lat": 1, "lon": 2}, {"id": "osm:w3", "name": "D", "category": "sushi", "lat": 1, "lon": 2},
      {"id": "osm:r4", "name": "E", "category": "asian", "lat": 95, "lon": 2}, {"id": "osm:r5", "name": "F" * 120, "category": "other", "lat": -1, "lon": -2},
      "osm:n6", None]
for b in [{"places": NB}, small, {"places": {}}, None, {"places": []}]:
    seam("checkNearby", [b], check_nearby(b))
for cfg, want in [("", False), ("https://w.example", True), ("http://localhost:8787", True), ("ftp://w.example", False), ("https://", False),
                  ("https://a b", False), (5, False), (None, False)]:
    seam("enabled", [], want, config={"apiBase": cfg} if cfg is not None else {})


def api(drive=None, geo=None, nearby=None): return {"failed": {}, "api": {"drive": drive or {}, "geo": geo or {}, "nearby": nearby or {}}}


def asks(S, opts):
    if not isinstance(opts, dict) or not isinstance(opts.get("api"), dict):
        return []
    A = opts["api"]
    if not all(isinstance(A.get(k), dict) for k in ("drive", "geo", "nearby")):
        return []
    out = []
    pos = S.get("pos")
    if not (isinstance(pos, dict) and pos.get("src") == "gps"):
        k = geo_key(S.get("address"))
        if k is not None and k not in A["geo"]:
            out.append({"kind": "geocode", "key": k, "q": geo_query(S.get("address"))})
    if S.get("milesSrc") == "store":
        k = drive_key(pos, S.get("store"))
        if k is not None and k not in A["drive"]:
            out.append({"kind": "drive", "key": k, "from": pt(pos), "to": pt(S["store"])})
    if pt(pos) is not None:
        for r in (2, 5, 10):
            k = pt(pos) + "/" + str(r)
            if k not in A["nearby"]:
                out.append({"kind": "nearby", "key": k, "lat": fmt3(pos["lat"]), "lon": fmt3(pos["lon"]), "radius": r})
                break
            v = A["nearby"][k]
            if v is False or len(v["places"]) >= 10:
                break
    return out


ESQ = "350 5th Ave, New York, NY 10118"
S_NY = {"address": ESQ, "pos": {"lat": 40.749, "lon": -73.986, "src": "zip"}, "milesSrc": "store",
        "store": {"id": "dominos@40755,-73989", "lat": 40.755, "lon": -73.989}}
DK = "40.749,-73.986;40.755,-73.989"
def places(n, base=0): return {"places": [{"id": "osm:n%d" % (base + i + 1), "name": "P%d" % (base + i + 1), "category": "casual",
                                          "lat": 40.749, "lon": -73.986} for i in range(n)]}
ASK_CASES = [
    ("Worker off: opts undefined", S_NY, T("undefined")), ("Worker off: opts without api", S_NY, {"failed": {}}),
    ("api missing a table", S_NY, {"failed": {}, "api": {"drive": {}, "geo": {}}}), ("api tables that aren't objects", S_NY, {"api": {"drive": {}, "geo": {}, "nearby": None}}),
    ("all three, in order", S_NY, api()),
    ("answered geocode and drive (false counts as answered)", S_NY, api(drive={DK: False}, geo={ESQ.lower(): {"lat": 1, "lon": 1, "zip": None, "state": None}})),
    ("nearby widens after 3 places at 2 mi", S_NY, api(drive={DK: False}, geo={ESQ.lower(): False}, nearby={"40.749,-73.986/2": places(3)})),
    ("nearby stops at 10 places", S_NY, api(drive={DK: False}, geo={ESQ.lower(): False}, nearby={"40.749,-73.986/2": places(10)})),
    ("nearby stops after a failure", S_NY, api(drive={DK: False}, geo={ESQ.lower(): False}, nearby={"40.749,-73.986/2": False})),
    ("nearby: 3 then 4 asks for 10 mi", S_NY, api(drive={DK: False}, geo={ESQ.lower(): False}, nearby={"40.749,-73.986/2": places(3), "40.749,-73.986/5": places(4)})),
    ("nearby: all three radii answered", S_NY, api(drive={DK: False}, geo={ESQ.lower(): False},
                                                   nearby={"40.749,-73.986/2": places(3), "40.749,-73.986/5": places(4), "40.749,-73.986/10": places(5)})),
    ("a GPS position isn't geocoded", dict(S_NY, pos={"lat": 40.749, "lon": -73.986, "src": "gps"}), api()),
    ("a drive distance already in use isn't asked again", dict(S_NY, milesSrc="drive"), api()),
    ("a pinned trip asks no drive", dict(S_NY, milesSrc="pinned"), api()),
    ("no position: only the geocode", {"address": "Big Timber, MT", "pos": None, "milesSrc": None, "store": None}, api()),
    ("a bare ZIP isn't geocoded", dict(S_NY, address="10118"), api()),
    ("a position out of range asks nothing for it", dict(S_NY, address="", pos={"lat": 95, "lon": 0, "src": "zip"}), api()),
    ("a GPS position at full precision is asked at 3 decimals", dict(S_NY, address="", pos={"lat": 45.83412, "lon": -109.94987, "src": "gps"}, milesSrc=None), api()),
]
for label, S, opts in ASK_CASES:
    o = None if isinstance(opts, dict) and opts.get("$") == "undefined" else opts
    seam("asks", [S, T("D"), opts], asks(S, o), label=label)

BR = {"subway": {"name": "Subway", "category": "sandwich", "wikidata": "Q1", "stores": 1},
      "dominos": {"name": "Domino's", "category": "pizza", "wikidata": "Q2", "stores": 1}}
def places_for(S, D, opts):
    if not isinstance(opts, dict) or not isinstance(opts.get("api"), dict) or not isinstance(opts["api"].get("nearby"), dict):
        return []
    p0 = pt(S.get("pos"))
    if p0 is None:
        return []
    ans = None
    for r in (10, 5, 2):
        v = opts["api"]["nearby"].get(p0 + "/" + str(r))
        if isinstance(v, dict):
            ans = v
            break
    if ans is None:
        return []
    chains = {name_key(b["name"]) for b in D["BRANDS"].values()}
    rows = []
    for p in ans["places"]:
        if name_key(p["name"]) in chains:
            continue
        rows.append({"brand": p["id"], "id": p["id"] + "@" + point(p["lat"], p["lon"]), "name": p["name"], "category": p["category"],
                     "lat": p["lat"], "lon": p["lon"], "mi": dist_mi(S["pos"]["lat"], S["pos"]["lon"], p["lat"], p["lon"]), "profiled": False})
    rows.sort(key=lambda r: (r["mi"], r["id"]))
    return rows[:10]
SPOS = {"address": "", "pos": {"lat": 40.7491, "lon": -73.9861, "src": "gps"}}
PL3 = {"places": [{"id": "osm:n5", "name": "Far Grill", "category": "casual", "lat": 40.7531, "lon": -73.9861},
                  {"id": "osm:n6", "name": "SUBWAY", "category": "sandwich", "lat": 40.7492, "lon": -73.9861},
                  {"id": "osm:n7", "name": "Near Cafe", "category": "coffee", "lat": 40.7495, "lon": -73.9861},
                  {"id": "osm:w2", "name": "Same Spot", "category": "pizza", "lat": 40.7495, "lon": -73.9861}]}
P12 = {"places": [{"id": "osm:n%d" % (20 + i), "name": "Spot %d" % i, "category": "casual", "lat": 40.7491 + 0.0001 * i, "lon": -73.9861} for i in range(12)]}
for label, S, opts in [
        ("sorted by distance from S.pos, chains by name dropped, ties by id", SPOS, api(nearby={"40.749,-73.986/2": PL3})),
        ("the largest answered radius wins; false is skipped", SPOS, api(nearby={"40.749,-73.986/2": places(2), "40.749,-73.986/5": PL3, "40.749,-73.986/10": False})),
        ("at most 10 rows", SPOS, api(nearby={"40.749,-73.986/2": P12})),
        ("no answer yet", SPOS, api()), ("Worker off", SPOS, {"failed": {}}), ("no position", {"address": "", "pos": None}, api(nearby={"40.749,-73.986/2": PL3}))]:
    seam("placesFor", [S, {"BRANDS": BR}, opts], places_for(S, {"BRANDS": BR}, opts), label=label,
         work="mi is distMi from S.pos (40.7491, -73.9861), compared with a relative tolerance of 1e-9; 'SUBWAY' -> nameKey 'subway' = Subway's.")
r0 = places_for(SPOS, {"BRANDS": BR}, api(nearby={"40.749,-73.986/2": PL3}))
assert [r["brand"] for r in r0] == ["osm:n7", "osm:w2", "osm:n5"] and r0[0]["id"] == "osm:n7@40.750,-73.986"

def remember(D, opts, ask, value):
    D, opts = copy.deepcopy(D), copy.deepcopy(opts)
    table = {"drive": "drive", "geocode": "geo", "nearby": "nearby"}[ask["kind"]]
    opts["api"][table][ask["key"]] = False if value is None else value
    if ask["kind"] == "nearby" and value is not None:
        D.setdefault("PLACES", {})
        for p in value["places"]:
            if p["id"] not in D["PLACES"]:
                D["PLACES"][p["id"]] = {"name": p["name"], "category": p["category"], "lat": p["lat"], "lon": p["lon"]}
    return {"D": D, "opts": opts}
A_D = {"kind": "drive", "key": DK, "from": "40.749,-73.986", "to": "40.755,-73.989"}
A_N = {"kind": "nearby", "key": "40.749,-73.986/2", "lat": "40.749", "lon": "-73.986", "radius": 2}
A_G = {"kind": "geocode", "key": ESQ.lower(), "q": ESQ}
NBV = {"places": [{"id": "osm:n1", "name": "One", "category": "pizza", "lat": 40.75, "lon": -73.98},
                  {"id": "osm:n2", "name": "Two", "category": "other", "lat": 40.76, "lon": -73.97}]}
for label, D, opts, ask, val in [("a drive answer", {}, api(), A_D, {"miles": 0.86, "minutes": 3.1}), ("a failed drive", {}, api(), A_D, None),
                                 ("a geocode answer", {}, api(), A_G, {"lat": 1, "lon": 2, "zip": None, "state": None}),
                                 ("nearby fills D.PLACES", {}, api(), A_N, NBV),
                                 ("nearby keeps a place already known", {"PLACES": {"osm:n1": {"name": "Saved", "category": "casual", "lat": 1, "lon": 2}}}, api(), A_N, NBV),
                                 ("a failed nearby leaves D alone", {}, api(), A_N, None)]:
    seam("remember", [D, opts, ask, val], None, label=label, after=remember(D, opts, ask, val))

doc = {
    "about": ("Hand-worked cases for docs/api-contract.md (D-040), written by build.py, an independent Python reading of the "
              "contract that never runs worker/ or src/js/api.js. `worker` cases: send request.method to request.url with an "
              "Origin header when request.origin isn't null, to handle(request, env, deps) with env as given and env.POD_CACHE "
              "a fake KV per `kv` (null = no binding, \"empty\", \"throws\" = get and put reject, or {preset: {key: storedValue}}; "
              "get(key, 'json') returns the stored value or null, put records {key, value: JSON.parse(value), ttl: expirationTtl}). "
              "deps.fetch answers only the URLs in `upstream` (any other URL fails the test), and must be called with header "
              "user-agent = env.USER_AGENT: a {fixture} or {status, contentType, text} entry becomes a Response with that status, "
              "content type and body (a fixture's JSON body re-serialized); {reject: true} rejects. Then check status, every "
              "header in expect.headers (names lowercase; null in the table means absent: see absentHeaders), the body "
              "(JSON.parse, deep-equal; for errors only error.code is compared, and error.message must be a non-empty string), "
              "the exact upstream URLs called in order, and the KV puts in order. `seam` cases: call POD.api[fn](...args) in the "
              "app's VM (\"$\" tags: NaN, Infinity, -Infinity, -0, undefined; {\"$\": \"D\"} is the real POD.data), with "
              "POD.config = config when given; compare `returns` (placesFor rows' mi with relative tolerance 1e-9), and for "
              "remember compare D and opts afterwards with `after`."),
    "env": ENV,
    "worker": CASES,
    "seam": SEAM,
}
for c in CASES:   # absent CORS header made explicit for the runner
    e = c["expect"]
    if "access-control-allow-origin" not in e["headers"]:
        e["absentHeaders"] = ["access-control-allow-origin"]
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print(len(CASES), "worker cases,", len(SEAM), "seam cases")
