"""build.py: hand-worked cases for POD.links (docs/links-contract.md, D-041).

    python3 -I tests/fixtures/links/build.py tests/fixtures/links/cases.json

Every expected value below is written out by hand from the contract, never computed here. The
script then checks each one against the Python reference (tests/oracle/links.py) and refuses to
write the file if any disagrees, so a slip in either shows up before any JS exists.

Dataset "T" uses the real link formats of src/data/links.js (2026-11-16) with a short `order`
table; the others break one entry each.
"""

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(ROOT, "tests", "oracle"))
import links as R  # noqa: E402

DD_HOME, UE_HOME, GH_HOME = "https://www.doordash.com/", "https://www.ubereats.com/", "https://www.grubhub.com/"
DD_SEARCH = "https://www.doordash.com/search/store/{q}/"
DIR = "https://www.google.com/maps/dir/?api=1&destination={lat}%2C{lon}"
MSEARCH = "https://www.google.com/maps/search/?api=1&query={q}"
GDIR = "https://www.google.com/maps/dir/?api=1&destination="
GSEARCH = "https://www.google.com/maps/search/?api=1&query="

T = {"LINKS": {
    "asOf": "2026-11-16",
    "apps": {
        "dd": {"home": DD_HOME, "search": DD_SEARCH, "source": "s", "checked": "2026-11-16"},
        "ue": {"home": UE_HOME, "search": None, "source": "s", "checked": "2026-11-16"},
        "gh": {"home": GH_HOME, "search": None, "source": "s", "checked": "2026-11-16"},
    },
    "maps": {"name": "Google Maps", "dir": DIR, "search": MSEARCH, "source": "s", "checked": "2026-11-16"},
    "order": {
        "dominos": {"url": "https://www.dominos.com/", "source": "s", "checked": "2026-11-16"},
        "wingstop": {"url": "https://www.wingstop.com/", "source": "s", "checked": "2026-11-16"},
        "__proto__": {"url": "https://proto.example/", "source": "s", "checked": "2026-11-16"},
    },
}}


def variant(**edits):
    d = copy.deepcopy(T)
    for path, v in edits.items():
        keys = path.split("__")
        o = d["LINKS"]
        for k in keys[:-1]:
            o = o[k]
        if v is DELETE:
            del o[keys[-1]]
        else:
            o[keys[-1]] = v
    return d


DELETE = object()

DATASETS = {
    "T": T,
    # Uber Eats with a search format (not the real data: shows the query-string encoding)
    "T:ue-search": variant(apps__ue__search="https://www.ubereats.com/search?q={q}"),
    # every app entry broken a different way, the map's name empty, the order URL not https
    "T:broken": variant(apps__dd__search="http://www.doordash.com/search/store/{q}/",
                        apps__ue__search="https://www.ubereats.com/search", apps__ue__home="javascript:alert(1)",
                        apps__gh="https://www.grubhub.com/", maps__name="",
                        order__dominos__url="http://www.dominos.com/"),
    # templates that can't be built
    "T:templates": variant(apps__dd__search="{q}", apps__ue__search=7, apps__gh__search="https://g.example/{q}/{q}",
                           maps__dir="https://www.google.com/maps/dir/?api=1&destination={lat}",
                           order__dominos=DELETE),
    "T:no-maps": variant(maps=DELETE),
    "T:no-gh": variant(apps__gh=DELETE),
    "T:maps-no-search": variant(maps__search=None),
    "T:apps-not-object": variant(apps=["dd", "ue", "gh"]),
    "T:order-array": variant(order=[{"url": "https://www.dominos.com/"}]),
    "T:no-links": {},
    # "https:" without the "//" isn't https:// (added after the orchestrator's mutant check of 9.5:
    # a check for "https:" alone passed every other case)
    "T:https-no-slashes": variant(apps__dd__search="https:www.doordash.com/search/store/{q}/", apps__ue__home="https:www.ubereats.com/",
                                  maps__dir="https:/www.google.com/maps/dir/?api=1&destination={lat}%2C{lon}",
                                  order__dominos__url="https:www.dominos.com/"),
}

DOM_STORE = {"id": "dominos@40755,-73989", "lat": 40.755, "lon": -73.989}
TB_STORE = {"id": "taco_bell@40749,-73995", "lat": 40.749, "lon": -73.995}


def s(brand, name, store=None):
    return {"brand": brand, "rest": {"name": name}, "store": store}


DOM = s("dominos", "Domino's", DOM_STORE)
TB = s("taco_bell", "Taco Bell", TB_STORE)
PJ = s("papa_johns", "Papa John's", None)


def search(app, name, href):
    return {"kind": "search", "label": "Search " + app + " for " + name, "href": href}


def home(app, href):
    return {"kind": "app", "label": "Open " + app, "href": href}


def order(name, href):
    return {"kind": "order", "label": "Order from " + name, "href": href}


def dirl(lat, lon):
    return {"kind": "dir", "label": "Directions in Google Maps", "href": GDIR + lat + "%2C" + lon}


def mapl(name, q):
    return {"kind": "map", "label": "Find " + name + " in Google Maps", "href": GSEARCH + q}


ORDER_DOM = order("Domino's", "https://www.dominos.com/")
DIR_DOM = dirl("40.75500", "-73.98900")

CASES = []


def case(cid, ch, S, expect, data="T"):
    CASES.append({"id": cid, "fn": "forChannel", "ch": ch, "S": S, "data": data, "expect": expect})


# ---- the real formats, Domino's at 10118 (the first-visit example's store)
case("dd-d searches DoorDash by name", "dd-d", DOM, [search("DoorDash", "Domino's", "https://www.doordash.com/search/store/Domino's/")])
case("dd-p is the same link", "dd-p", DOM, [search("DoorDash", "Domino's", "https://www.doordash.com/search/store/Domino's/")])
case("ue-d opens Uber Eats' home page", "ue-d", DOM, [home("Uber Eats", UE_HOME)])
case("ue-p opens Uber Eats' home page", "ue-p", DOM, [home("Uber Eats", UE_HOME)])
case("gh-d opens Grubhub's home page", "gh-d", DOM, [home("Grubhub", GH_HOME)])
case("gh-p opens Grubhub's home page", "gh-p", DOM, [home("Grubhub", GH_HOME)])
case("direct-d: the chain's site only", "direct-d", DOM, [ORDER_DOM])
case("direct-p: the chain's site, then directions to the store", "direct-p", DOM, [ORDER_DOM, DIR_DOM])

# ---- an unprofiled chain (no order entry)
case("unprofiled direct-p: directions only", "direct-p", TB, [dirl("40.74900", "-73.99500")])
case("unprofiled direct-d: nothing", "direct-d", TB, [])
case("unprofiled dd-p: still searches", "dd-p", TB, [search("DoorDash", "Taco Bell", "https://www.doordash.com/search/store/Taco%20Bell/")])

# ---- no store: a map search by name
case("no store: Find by name", "direct-p", PJ, [mapl("Papa John's", "Papa%20John's")])
case("no store, profiled: the site, then Find", "direct-p", s("dominos", "Domino's"),
     [ORDER_DOM, mapl("Domino's", "Domino's")])
case("store is a string: Find", "direct-p", s("dominos", "Domino's", "dominos@40755,-73989"), [ORDER_DOM, mapl("Domino's", "Domino's")])
case("store of another brand: Find", "direct-p", s("dominos", "Domino's", TB_STORE), [ORDER_DOM, mapl("Domino's", "Domino's")])
case("store id only shares a prefix with the brand: Find", "direct-p",
     s("taco", "Taco", {"id": "taco_bell@40749,-73995", "lat": 40.749, "lon": -73.995}), [mapl("Taco", "Taco")])
case("store id without the @: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell", "lat": 40.749, "lon": -73.995}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store id not a string: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": 5, "lat": 40.749, "lon": -73.995}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store lat above 90: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell@1,2", "lat": 90.5, "lon": 2}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store lon below -180: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell@1,2", "lat": 1, "lon": -180.001}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store lat a string: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell@1,2", "lat": "40.7", "lon": 2}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store lat a boolean: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell@1,2", "lat": True, "lon": 2}),
     [mapl("Taco Bell", "Taco%20Bell")])
case("store lon missing: Find", "direct-p", s("taco_bell", "Taco Bell", {"id": "taco_bell@1,2", "lat": 1}),
     [mapl("Taco Bell", "Taco%20Bell")])

# ---- coordinates: toFixed(5) exactly
case("the edges 90 and -180 are allowed", "direct-p", s("x", "X", {"id": "x@1", "lat": 90, "lon": -180}), [dirl("90.00000", "-180.00000")])
case("the edges -90 and 180 are allowed", "direct-p", s("x", "X", {"id": "x@1", "lat": -90, "lon": 180}), [dirl("-90.00000", "180.00000")])
case("an exact tie rounds up in size, both signs (0.015625 = 1/64)", "direct-p",
     s("x", "X", {"id": "x@1", "lat": 0.015625, "lon": -0.015625}), [dirl("0.01563", "-0.01563")])
case("a tiny negative keeps its sign; 0 has none", "direct-p", s("x", "X", {"id": "x@1", "lat": -0.000001, "lon": 0}),
     [dirl("-0.00000", "0.00000")])
case("seven decimals (an OpenStreetMap independent) round to five", "direct-p",
     s("osm:n123", "Joe's Diner", {"id": "osm:n123@40.7484421,-73.9856589", "lat": 40.7484421, "lon": -73.9856589}),
     [dirl("40.74844", "-73.98566")])
case("Big Timber's Livingston Domino's", "direct-p",
     s("dominos", "Domino's", {"id": "dominos@45670,-110546", "lat": 45.67, "lon": -110.546}), [ORDER_DOM, dirl("45.67000", "-110.54600")])
case("a whole-number coordinate", "direct-p", s("x", "X", {"id": "x@1", "lat": 40, "lon": -74}), [dirl("40.00000", "-74.00000")])
case("12.3456789 rounds up, -12.3456749 rounds down", "direct-p", s("x", "X", {"id": "x@1", "lat": 12.3456789, "lon": -12.3456749}),
     [dirl("12.34568", "-12.34567")])

# ---- names: encodeURIComponent exactly
case("the user's own test link: Ben & Jerry's", "dd-p", s("ben_and_jerrys", "Ben & Jerry's"),
     [search("DoorDash", "Ben & Jerry's", "https://www.doordash.com/search/store/Ben%20%26%20Jerry's/")])
case("a slash is encoded", "dd-p", s("x", "AC/DC Diner"), [search("DoorDash", "AC/DC Diner", "https://www.doordash.com/search/store/AC%2FDC%20Diner/")])
case("a percent sign is encoded", "dd-p", s("x", "100% Juice"), [search("DoorDash", "100% Juice", "https://www.doordash.com/search/store/100%25%20Juice/")])
case("an accent is UTF-8", "dd-p", s("cafe_zupas", "Café Zupas"),
     [search("DoorDash", "Café Zupas", "https://www.doordash.com/search/store/Caf%C3%A9%20Zupas/")])
case("a degree sign is UTF-8", "dd-p", s("85c_bakery_cafe", "85°C Bakery Cafe"),
     [search("DoorDash", "85°C Bakery Cafe", "https://www.doordash.com/search/store/85%C2%B0C%20Bakery%20Cafe/")])
case("an emoji is 4 UTF-8 bytes", "dd-p", s("x", "Taco \U0001F32E"),
     [search("DoorDash", "Taco \U0001F32E", "https://www.doordash.com/search/store/Taco%20%F0%9F%8C%AE/")])
case("the unescaped marks stay", "dd-p", s("x", "!*'()-_.~"), [search("DoorDash", "!*'()-_.~", "https://www.doordash.com/search/store/!*'()-_.~/")])
case("URL syntax is encoded", "dd-p", s("x", "a+b=c?d#e&f"),
     [search("DoorDash", "a+b=c?d#e&f", "https://www.doordash.com/search/store/a%2Bb%3Dc%3Fd%23e%26f/")])
case("a name holding a placeholder isn't filled again", "dd-p", s("x", "{q}{lat}"),
     [search("DoorDash", "{q}{lat}", "https://www.doordash.com/search/store/%7Bq%7D%7Blat%7D/")])
case("a name of spaces still searches", "dd-p", s("x", "  "), [search("DoorDash", "  ", "https://www.doordash.com/search/store/%20%20/")])
case("in a query string too (a format that isn't real data)", "ue-p", s("ben_and_jerrys", "Ben & Jerry's"),
     [search("Uber Eats", "Ben & Jerry's", "https://www.ubereats.com/search?q=Ben%20%26%20Jerry's")], data="T:ue-search")
case("a map search encodes the same way", "direct-p", s("x", "Ben & Jerry's"), [mapl("Ben & Jerry's", "Ben%20%26%20Jerry's")])

# ---- a lone surrogate: encodeURIComponent throws, so that link is left out
case("lone surrogate: DoorDash falls back to its home page", "dd-p", s("x", "Bad\ud800Name"), [home("DoorDash", DD_HOME)])
case("lone surrogate: no map search, no store: nothing", "direct-p", s("x", "Bad\ud800Name"), [])
case("lone surrogate: directions don't need the name", "direct-p", s("x", "Bad\ud800Name", {"id": "x@1", "lat": 1, "lon": 2}),
     [dirl("1.00000", "2.00000")])
case("lone surrogate: the site link keeps the raw name", "direct-p", s("dominos", "Dom\udfffino's"),
     [order("Dom\udfffino's", "https://www.dominos.com/")])
case("a surrogate pair written as escapes is one character", "dd-p", s("x", "\ud83c\udf2e"), [search("DoorDash", "\U0001F32E", "https://www.doordash.com/search/store/%F0%9F%8C%AE/")])

# ---- data entries that can't be used
case("a search that isn't https falls back home", "dd-p", DOM, [home("DoorDash", DD_HOME)], data="T:broken")
case("a search with no {q} and a home that isn't https: nothing", "ue-p", DOM, [], data="T:broken")
case("an app entry that isn't an object: nothing", "gh-d", DOM, [], data="T:broken")
case("a map with no name and a site that isn't https: nothing", "direct-p", DOM, [], data="T:broken")
case("a search template of just {q} isn't https: home", "dd-p", DOM, [home("DoorDash", DD_HOME)], data="T:templates")
case("a search template that's a number: home", "ue-p", DOM, [home("Uber Eats", UE_HOME)], data="T:templates")
case("{q} twice is filled twice", "gh-p", DOM, [search("Grubhub", "Domino's", "https://g.example/Domino's/Domino's")], data="T:templates")
case("directions with no {lon}: the map search instead", "direct-p", DOM, [mapl("Domino's", "Domino's")], data="T:templates")
case("no maps entry: the site only", "direct-p", DOM, [ORDER_DOM], data="T:no-maps")
case("no maps entry, no site: nothing", "direct-p", TB, [], data="T:no-maps")
case("no store and no map search: the site only", "direct-p", s("dominos", "Domino's"), [ORDER_DOM], data="T:maps-no-search")
case("a store still gets directions without a map search", "direct-p", DOM, [ORDER_DOM, DIR_DOM], data="T:maps-no-search")
case("an app missing from apps: nothing", "gh-p", DOM, [], data="T:no-gh")
case("apps an array: nothing", "dd-p", DOM, [], data="T:apps-not-object")
case("order an array: no site, directions still", "direct-p", DOM, [DIR_DOM], data="T:order-array")
case("D without LINKS: nothing", "dd-p", DOM, [], data="T:no-links")
case("a search starting https: without // falls back home", "dd-p", DOM, [home("DoorDash", DD_HOME)], data="T:https-no-slashes")
case("a home page starting https: without //: nothing", "ue-p", DOM, [], data="T:https-no-slashes")
case("a site and directions starting https: without //: only the map search", "direct-p", DOM, [mapl("Domino's", "Domino's")],
     data="T:https-no-slashes")

# ---- brand ids that are Object.prototype's names
case("__proto__ as a brand with its own entry gets it", "direct-d", s("__proto__", "Proto"), [order("Proto", "https://proto.example/")])
case("constructor as a brand has no site", "direct-d", s("constructor", "Constructor"), [])
case("toString as a brand: the map search only", "direct-p", s("toString", "To String"), [mapl("To String", "To%20String")])
case("hasOwnProperty as a brand", "direct-p", s("hasOwnProperty", "H", {"id": "hasOwnProperty@1", "lat": 1, "lon": 1}),
     [dirl("1.00000", "1.00000")])

# ---- guards: []
for cid, ch, S, data in [
    ("channel not a channel", "direct", DOM, "T"),
    ("channel in capitals", "DD-P", DOM, "T"),
    ("channel with a third part", "dd-p-x", DOM, "T"),
    ("channel null", None, DOM, "T"),
    ("channel a number", 5, DOM, "T"),
    ("S null", "dd-p", None, "T"),
    ("S an array", "dd-p", [DOM], "T"),
    ("D null", "dd-p", DOM, None),
    ("brand null", "dd-p", {"brand": None, "rest": {"name": "Domino's"}}, "T"),
    ("brand a number", "dd-p", {"brand": 7, "rest": {"name": "Domino's"}}, "T"),
    ("brand missing", "direct-p", {"rest": {"name": "Domino's"}, "store": DOM_STORE}, "T"),
    ("rest null", "dd-p", {"brand": "dominos", "rest": None}, "T"),
    ("rest missing", "ue-p", {"brand": "dominos"}, "T"),
    ("rest an array", "dd-p", {"brand": "dominos", "rest": ["Domino's"]}, "T"),
    ("rest.name empty", "ue-p", s("dominos", ""), "T"),
    ("rest.name a number", "dd-p", {"brand": "dominos", "rest": {"name": 5}}, "T"),
    ("rest.name missing", "direct-p", {"brand": "dominos", "rest": {}, "store": DOM_STORE}, "T"),
]:
    case("guard: " + cid, ch, S, [], data=data)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "cases.json")
    text = json.dumps({"contract": "docs/links-contract.md", "decision": "D-041",
                       "datasets": DATASETS, "cases": CASES}, indent=1, ensure_ascii=True) + "\n"
    # Check what the file holds, as both readers will see it: a surrogate pair written as two
    # escapes reads back as one character, and a lone surrogate stays lone.
    doc = json.loads(text)
    bad = 0
    for c in doc["cases"]:
        D = None if c["data"] is None else copy.deepcopy(doc["datasets"][c["data"]])
        got = R.for_channel(c["ch"], copy.deepcopy(c["S"]), D)
        if got != c["expect"]:
            bad += 1
            print("MISMATCH %r:\n  hand:      %r\n  reference: %r" % (c["id"], c["expect"], got))
    ids = [c["id"] for c in CASES]
    assert len(ids) == len(set(ids)), "duplicate case ids"
    kinds = {l["kind"] for c in CASES for l in c["expect"]}
    assert kinds == {"search", "app", "order", "dir", "map"}, kinds
    if bad:
        sys.exit("%d of %d hand-worked cases disagree with the reference: not written" % (bad, len(CASES)))
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("links: %d hand-worked cases agree with the reference; wrote %s" % (len(CASES), os.path.relpath(out, ROOT)))


if __name__ == "__main__":
    main()
