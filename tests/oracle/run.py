"""Differential oracle runner (D-017, D-029, D-030).

1. Receipts: every case in tests/fixtures/receipts/ is checked against the Python engine
   (tests/oracle/engine.py). The receipts are worked by hand, so this checks the oracle.
2. Once src/js/engine.js is in index.html, the same cases run through the JS engine, and
   ORACLE_N seeded random scenarios (default 500) are run through both engines. Every
   field of every result is compared exactly, receipt lines included. Before the JS engine
   exists, step 2 is skipped and says so.

  python3 -I tests/oracle/run.py              # receipts + 500 scenarios
  ORACLE_N=5000 python3 -I tests/oracle/run.py
  ORACLE_SEED=7 python3 -I tests/oracle/run.py

3. Geography (docs/geo-contract.md): the hand-worked cases in tests/fixtures/geo/synthetic.json
   are checked against the Python reference (tests/oracle/geo.py), and tests/fixtures/geo/real.json
   must equal what the reference computes now (else: python3 -I tests/oracle/geo.py --write).
   Once src/js/geo.js is in index.html, both case files and ORACLE_GEO_N seeded random calls
   (default 60 points and 40 ZIPs) run through the JS too. Unrounded numbers compare with a
   relative tolerance of 1e-9 (contract §2); everything else compares exactly.

  ORACLE_GEO_N=200 python3 -I tests/oracle/run.py

4. Insights (docs/insights-contract.md): fixtures and seeded scenarios (D-034).

5. VIN and the car tables (docs/vin-contract.md, state contract §4.0; D-037, D-038): the
   hand-worked cases in tests/fixtures/vin/cases.json are checked against the Python reference
   (tests/oracle/vin.py). Once src/js/vin.js exists (it must then be in index.html), the cases
   and ORACLE_VIN_N seeded random calls (default 400) run through the JS too, exactly.

  ORACLE_VIN_N=4000 python3 -I tests/oracle/run.py

7. Links (docs/links-contract.md, D-041): tests/fixtures/links/cases.json must equal what its
   build.py writes now (its hand-worked values are asserted against tests/oracle/links.py there).
   Once src/js/links.js exists (it must then be in index.html), the cases and ORACLE_LINKS_N seeded
   random calls (default 2000) run through the JS too, exactly.

  ORACLE_LINKS_N=20000 python3 -I tests/oracle/run.py

On a failure it prints the receipt case or the scenario seed, the call, and the first
differing field, then exits 1. Standard library only.
"""
import json
import os
import random
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # -I leaves the script's own directory off sys.path
import engine as E  # noqa: E402
import geo as G  # noqa: E402
import insights as I  # noqa: E402
import vin as V  # noqa: E402
import links as LK  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
RECEIPTS = os.path.join(ROOT, "tests", "fixtures", "receipts")
N = int(os.environ.get("ORACLE_N", "500"))
SEED = int(os.environ.get("ORACLE_SEED", "20261112"))
APPS = ("dd", "ue", "gh")
GEO_FIX = os.path.join(ROOT, "tests", "fixtures", "geo")
GEO_N = int(os.environ.get("ORACLE_GEO_N", "60"))
VIN_FIX = os.path.join(ROOT, "tests", "fixtures", "vin")
VIN_N = int(os.environ.get("ORACLE_VIN_N", "400"))
API_FIX = os.path.join(ROOT, "tests", "fixtures", "api")
API_N = int(os.environ.get("ORACLE_API_N", "2000"))
LINKS_FIX = os.path.join(ROOT, "tests", "fixtures", "links")
LINKS_N = int(os.environ.get("ORACLE_LINKS_N", "2000"))


# ---------------------------------------------------------------- helpers

# Objects whose keys are data, not schema: a patch replaces them whole.
REPLACE = ("cart", "creditOptIn", "markup")


def merge(a, b):
    """Deep merge: objects merge key by key, except REPLACE keys; anything else in b replaces a."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = merge(a[k], v) if (k in a and k not in REPLACE) else json.loads(json.dumps(v))
        return out
    return json.loads(json.dumps(b))


def diff(exp, act, path="", full=True):
    """First difference as a string, or None. full=False checks only the keys in exp."""
    if isinstance(exp, bool) or isinstance(act, bool):
        return None if exp is act else "%s: expected %r, got %r" % (path, exp, act)
    if isinstance(exp, (int, float)) and isinstance(act, (int, float)):
        return None if float(exp) == float(act) else "%s: expected %r, got %r" % (path, exp, act)
    if isinstance(exp, dict) and isinstance(act, dict):
        keys = sorted(set(exp) | set(act)) if full else sorted(exp)
        for k in keys:
            if k not in act:
                return "%s.%s: missing in result" % (path, k)
            if k not in exp:
                return "%s.%s: unexpected key in result" % (path, k)
            d = diff(exp[k], act[k], "%s.%s" % (path, k), full)
            if d:
                return d
        return None
    if isinstance(exp, list) and isinstance(act, list):
        if len(exp) != len(act):
            return "%s: expected %d items %r, got %d %r" % (path, len(exp), exp, len(act), act)
        for i, (x, y) in enumerate(zip(exp, act)):
            d = diff(x, y, "%s[%d]" % (path, i), full)
            if d:
                return d
        return None
    return None if exp == act else "%s: expected %r, got %r" % (path, exp, act)


def py_call(req):
    c = req["call"]
    ov = req.get("override")
    if c == "calc":
        return E.calc(req["S"], req["channel"], ov)
    if c == "allResults":
        return E.all_results(req["S"], ov)
    if c == "cartInfo":
        return E.cart_info(req["S"], ov)
    if c == "perMile":
        return E.per_mile(req["S"])
    raise ValueError(c)


def check_expect(case, res):
    """Compare a result with a receipt case's `expect` (only the keys it names)."""
    exp = case["expect"]
    c = case["call"]
    if c == "calc":
        if "result" in exp:
            return None if res is None else "expected null (channel unavailable), got a result"
        if res is None:
            return "expected a result, got null"
        return diff(exp, res, "", full=False)
    if c == "allResults":
        ids = [r["id"] for r in res]
        if "order" in exp and ids != exp["order"]:
            return "order: expected %s, got %s" % (exp["order"], ids)
        for ch, net in (exp.get("net") or {}).items():
            got = [r["net"] for r in res if r["id"] == ch]
            if not got or float(got[0]) != float(net):
                return "net[%s]: expected %r, got %r" % (ch, net, got[0] if got else "absent")
        return None
    if c == "cartInfo":
        return diff(exp, res, "", full=False)
    return "unknown call " + c


def receipt_cases():
    with open(os.path.join(RECEIPTS, "_base.json"), encoding="utf-8") as fh:
        base = json.load(fh)["S"]
    out = []
    for name in sorted(os.listdir(RECEIPTS)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        with open(os.path.join(RECEIPTS, name), encoding="utf-8") as fh:
            r = json.load(fh)
        S = merge(base, r.get("patch") or {})
        for i, case in enumerate(r["cases"]):
            Sc = merge(S, case.get("patch") or {})
            req = {"call": case["call"], "S": Sc, "override": case.get("override")}
            if "channel" in case:
                req["channel"] = case["channel"]
            out.append(("%s #%d (%s %s)" % (r["id"], i, case["call"], case.get("channel", "")), case, req))
    return out


# ---------------------------------------------------------------- scenario generator

def gen_scenario(seed):
    r = random.Random(seed)

    def money(lo, hi):
        return round(r.uniform(lo, hi), 2)

    def pct(lo, hi, nd=1):
        return round(r.uniform(lo, hi), nd)

    profiled = r.random() < 0.8
    if profiled:
        n = r.randint(1, 10)
        menu = []
        for i in range(n):
            it = {"name": "Item %d" % i, "price": money(0.5, 30), "dealItem": r.random() < 0.4}
            if r.random() < 0.4:   # D-036: per-item overrides, some malformed (they fall back)
                mk = {}
                for p in APPS:
                    roll = r.random()
                    if roll < 0.45:
                        mk[p] = r.choice([0, pct(0, 45), pct(0, 45), r.randint(5, 40)])
                    elif roll < 0.55:
                        mk[p] = r.choice([-5, "20", None, True, [10], {"v": 10}])
                it["markup"] = mk if r.random() < 0.95 else r.choice([None, [12], "x", 7])
            menu.append(it)
        deal = None if r.random() < 0.35 else {
            "label": "Deal %d" % r.randint(1, 9), "price": money(2, 20),
            "minItems": r.randint(1, 3), "scope": r.choice(["both", "pickup", "delivery"])}
        dd = r.random() < 0.5
        rest = {"id": "fuzz", "name": "Fuzz", "profiled": True, "menu": menu, "deal": deal,
                "directDelivery": dd, "directSvc": None, "amexGoldDirect": r.random() < 0.3,
                "platforms": [p for p in APPS if r.random() < 0.7], "markup": {}, "markupEst": True}
        if dd:
            rest["directFee"] = money(0.99, 7.99)
        if r.random() < 0.35:
            ds = {"modes": r.choice([["d"], ["p"], ["d", "p"]])}
            if r.random() < 0.7:
                ds["flat"] = r.choice([0, money(0.25, 3)])
            if r.random() < 0.7:
                ds["pct"] = r.choice([0, pct(1, 15)])
            if r.random() < 0.5:
                ds["max"] = r.choice([0, money(0.5, 5)])
            rest["directSvc"] = ds
        cart = {}
        for i in range(n):
            if r.random() < 0.6:
                cart[str(i)] = r.randint(0, 3)
        if r.random() < 0.15:
            cart[r.choice(["99", "x", "01", "-1", str(n)])] = r.randint(1, 2)
        if r.random() < 0.05:   # D-036: a malformed quantity or menu entry gives no cart line
            k = str(r.randrange(n))
            if r.random() < 0.5:
                cart[k] = r.choice(["2", None, True, [1]])
            else:
                menu[int(k)] = r.choice([None, ["Item", 3.5, False], "x"])
                cart[k] = r.randint(1, 3)
    else:
        rest = {"id": "fuzz_u", "name": "Fuzz U", "profiled": False, "menu": [], "deal": None,
                "directDelivery": False, "directSvc": None, "amexGoldDirect": False,
                "platforms": ["dd", "ue", "gh"], "markup": {}, "markupEst": True}
        cart = {}

    plats = {"direct": {"on": r.random() < 0.9}}
    promos = {}
    for p in APPS:
        plats[p] = {
            "on": r.random() < 0.85, "markup": pct(0, 35),
            "delFee": r.choice([0, money(0.49, 7.99)]), "svc": pct(0, 20),
            "svcMin": r.choice([0, money(0.5, 4)]), "member": r.random() < 0.4,
            "memberSvc": pct(0, 10), "memberMin": r.choice([0, 10, 12, 15, money(5, 40)]),
            "pickDisc": r.choice([0, 0, pct(1, 25)])}
        if r.random() < 0.15:
            plats[p]["noDelivery"] = True   # D-033
        t = r.choice(["none", "percent", "dollar", "freedel", "bogo", "bogo"])
        pr = {"type": t, "value": pct(5, 60) if t == "percent" else (money(1, 40) if t == "dollar" else 0)}
        if t == "bogo" or r.random() < 0.1:   # D-036: a menu index, sometimes invalid (no promo)
            nm = len(rest["menu"])
            roll = r.random()
            if roll < 0.75 and nm:
                pr["item"] = r.randrange(nm)
                if r.random() < 0.6:
                    cart[str(pr["item"])] = r.randint(0, 5)
            elif roll < 0.95:
                pr["item"] = r.choice([None, -1, nm, nm + 3, 1.5, "0", True, [0]])
        if r.random() < 0.7:
            pr["cap"] = r.choice([0, money(2, 20)])
        if r.random() < 0.7:
            pr["min"] = r.choice([0, money(5, 50)])
        promos[p] = pr

    credits = []
    for j in range(r.randint(0, 4)):
        c = {"key": "c%d" % j, "name": "Credit %d" % j, "amount": r.choice([money(1, 60), r.randint(5, 50)]),
             "plats": [x for x in ("direct", "dd", "ue", "gh") if r.random() < 0.4]}
        m = r.choice([None, None, ["d"], ["p"], ["d", "p"]])
        if m is not None:
            c["modes"] = m
        for flag, prob in (("restricted", 0.25), ("locked", 0.1), ("goldPartner", 0.2), ("used", 0.15)):
            if r.random() < prob:
                c[flag] = True
        credits.append(c)
    opt = {c["key"]: True for c in credits if r.random() < 0.5}

    S = {
        "rest": rest, "cart": cart, "manualSubtotal": money(0, 80), "dealOn": r.random() < 0.8,
        "tax": round(r.uniform(0, 11), r.choice([0, 2, 3])),
        "fuel": r.choice(["regular", "premium", "diesel", "ev"]),
        "gas": round(r.uniform(2.5, 6.5), 3), "mpg": r.choice([r.randint(8, 60), pct(8, 60), 0]),
        "miPerKwh": r.choice([pct(1.5, 5), pct(1.5, 5), 0]), "kwh": round(r.uniform(0.08, 0.6), 3),
        "miles": pct(0, 40), "minutes": r.randint(0, 90), "wear": round(r.uniform(0, 0.4), 3),
        "hourly": r.choice([0, 0, money(5, 60)]),
        "tipDel": pct(0, 25), "tipPick": r.choice([0, pct(0, 15)]),
        "regFee": r.choice([0, money(0.1, 3)]), "smallMin": r.choice([0, 10, 12, 15, money(5, 20)]),
        "smallFee": r.choice([0, money(0.5, 4)]),
        "plats": plats, "promos": promos, "credits": credits, "creditOptIn": opt,
    }

    ov = r.choice([None, None, {}, "miles", "cart", "manual", "minutes", "mix"])
    if ov == "miles":
        ov = {"miles": pct(0, 60)}
    elif ov == "cart":
        ov = {"cart": {str(i): r.randint(0, 4) for i in range(len(rest["menu"])) if r.random() < 0.5}}
    elif ov == "manual":
        ov = {"manualSubtotal": money(0, 90)}
    elif ov == "minutes":
        ov = {"minutes": r.randint(0, 120)}
    elif ov == "mix":
        ov = {"miles": pct(0, 60), "minutes": r.randint(0, 120), "manualSubtotal": money(0, 90)}

    # Boundary injection: put a threshold exactly on an app's food, so >= vs > is tested.
    if r.random() < 0.35:
        p = r.choice(APPS)
        food = app_food(S, p, ov)
        which = r.choice(["memberMin", "promoMin", "smallMin"])
        if which == "memberMin":
            plats[p]["memberMin"] = food
        elif which == "promoMin":
            promos[p]["min"] = food
        else:
            S["smallMin"] = food
    return S, ov


def app_food(S, p, ov):
    """App p's food (contract 5.2, D-036), for the boundary injection."""
    rest, P = S["rest"], S["plats"][p]
    if not rest["profiled"]:
        return E.round2(E.cart_info(S, ov)["menuSub"] * (1 + P["markup"] / 100))
    acc = 0
    for i, q in E._cart_lines(rest, E._effective(S, ov)["cart"]):
        acc = acc + rest["menu"][i]["price"] * q * (1 + E._mk(rest["menu"][i], p, P) / 100)
    return E.round2(acc)


def scenario_requests(i):
    S, ov = gen_scenario(SEED + i)
    reqs = [{"call": "allResults", "S": S, "override": ov}, {"call": "cartInfo", "S": S, "override": ov},
            {"call": "perMile", "S": S, "override": None}]
    for ch in E.CHANNELS:
        reqs.append({"call": "calc", "S": S, "channel": ch, "override": ov})
    return reqs


# ---------------------------------------------------------------- geography (D-030)

# Unrounded distances may differ in the last bits between two sin/asin implementations
# (contract §2): only these compare with a tolerance. Everything else, including the rounded
# trip, one and round, compares exactly.
TOL_KEYS = ("mi", "spacing", "zipsPerStore")
TOL_CALLS = ("distMi", "zipSpacing")


def close(exp, act, path="", tol=False):
    """First difference as a string, or None. tol: relative tolerance 1e-9 (absolute below 1)."""
    if isinstance(exp, bool) or isinstance(act, bool):
        return None if exp is act else "%s: expected %r, got %r" % (path, exp, act)
    if isinstance(exp, (int, float)) and isinstance(act, (int, float)):
        if tol:
            ok = abs(float(exp) - float(act)) <= 1e-9 * max(1.0, abs(float(exp)))
        else:
            ok = float(exp) == float(act)
        return None if ok else "%s: expected %r, got %r" % (path, exp, act)
    if isinstance(exp, dict) and isinstance(act, dict):
        for k in sorted(set(exp) | set(act)):
            if k not in act:
                return "%s.%s: missing in result" % (path, k)
            if k not in exp:
                return "%s.%s: unexpected key in result" % (path, k)
            d = close(exp[k], act[k], "%s.%s" % (path, k), k in TOL_KEYS)
            if d:
                return d
        return None
    if isinstance(exp, list) and isinstance(act, list):
        if len(exp) != len(act):
            return "%s: expected %d items, got %d" % (path, len(exp), len(act))
        for i, (x, y) in enumerate(zip(exp, act)):
            d = close(x, y, "%s[%d]" % (path, i), tol)
            if d:
                return d
        return None
    return None if exp == act else "%s: expected %r, got %r" % (path, exp, act)


def close_call(c, exp, act):
    return close(exp, act, c["call"], c["call"] in TOL_CALLS)


def geo_d(c, syn, base, tiles):
    if c.get("data") is None:
        return None
    if c["data"] == "real":
        return G.real_D(base, tiles, c)
    return G.synthetic_D(syn["datasets"], c)


def geo_random_cases(base, tiles):
    """Seeded random calls over the fixture regions (NYC, Big Timber) and random real ZIPs."""
    r = random.Random(SEED + 30)
    recs = G.zip_records(base)
    ids = base["BRAND_IDS"]
    near = sorted(set(ids[int(rec.split(",")[0])] for t in tiles.values() for rec in t["s"].split(";")))
    cells = sorted(tiles)
    out = []
    for i in range(GEO_N):
        if r.random() < 0.5:
            lat, lon = round(r.uniform(40.45, 40.98), 4), round(r.uniform(-74.6, -73.7), 4)
        else:
            lat, lon = round(r.uniform(45.3, 46.45), 4), round(r.uniform(-110.95, -108.6), 4)
        case = {"data": "real"}
        opts = None
        roll = r.random()
        if roll < 0.2:
            # one fixture cell missing and reported failed: partial results below r=50
            gone = r.choice(cells)
            case["tiles"] = [c for c in cells if c != gone]
            opts = {"failed": {gone: True}}
        elif roll < 0.45:
            case["tiles"] = [c for c in cells if r.random() < 0.6]
            if r.random() < 0.5:
                opts = {"failed": {c: True for c in base["TILE_INDEX"] if r.random() < 0.002 or
                                   (c not in case["tiles"] and r.random() < 0.7)}}
        elif roll < 0.55:
            case["tileRun"] = {r.choice(cells): "1999-01-01-00-00-00"}  # a stale tile
        if r.random() < 0.05:
            lat = r.choice([95, -91, "__NaN__", "__Infinity__"])  # bad input -> null
        brand = r.choice(near + ["zippys", "dominos", "the_cheesecake_factory", "not_a_brand"])
        out.append(dict(case, id="random %d storesNear" % i, call="storesNear", args=[lat, lon, opts]))
        out.append(dict(case, id="random %d nearestStore %s" % (i, brand), call="nearestStore", args=[lat, lon, brand, opts]))
        out.append(dict(case, id="random %d cellsFor" % i, call="cellsFor",
                        args=[lat, lon, r.choice([5, 10, 25, 50, round(r.uniform(0.5, 90), 3)])]))
        if i % 2 == 0:
            out.append({"data": "real", "id": "random %d nearestZip" % i, "call": "nearestZip", "args": [lat, lon]})
    brand_ids = sorted(base["BRANDS"])
    for i in range(GEO_N * 2 // 3):
        z = recs[r.randrange(len(recs))]
        rec = G.rec_obj(z)
        out.append({"data": "real", "id": "random zip %s zipSpacing" % z[0], "call": "zipSpacing", "args": [rec]})
        b = r.choice(brand_ids)
        out.append({"data": "real", "id": "random zip %s estimateMiles %s" % (z[0], b), "call": "estimateMiles", "args": [rec, b]})
        out.append({"data": "real", "id": "random zip %s zipByCode" % z[0], "call": "zipByCode", "args": [z[0]]})
    return out


def geo_built(failures):
    """True once src/js/geo.js exists. It must then be loaded by index.html, or that's a failure."""
    if not os.path.exists(os.path.join(ROOT, "src", "js", "geo.js")):
        return False
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        if not re.search(r"""<script\b[^>]*\bsrc=["']src/js/geo\.js["']""", fh.read()):
            failures.append("geo: src/js/geo.js exists but index.html doesn't load it")
    return True


def run_js_geo(datasets, cases):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        keep = ("call", "args", "data", "patch", "tiles", "tileRun")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump({"datasets": datasets, "cases": [{k: c[k] for k in keep if k in c} for c in cases]}, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "geo_runner.js"), fin, fout], cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


def geo_checks(failures):
    with open(os.path.join(GEO_FIX, "synthetic.json"), encoding="utf-8") as fh:
        syn = json.load(fh)
    with open(os.path.join(GEO_FIX, "real.json"), encoding="utf-8") as fh:
        real = json.load(fh)
    base = G.real_data()
    tiles = G.fixture_tiles()

    bad = 0
    for c in syn["cases"]:
        d = close_call(c, c["expect"], G.call(c["call"], c["args"], geo_d(c, syn, base, tiles)))
        if d:
            bad += 1
            failures.append("geo synthetic %r, python reference: %s" % (c["id"], d))
    print("oracle: geo hand-worked %d/%d cases match the python reference" % (len(syn["cases"]) - bad, len(syn["cases"])))

    bad = 0
    if real["run"] != base["BRANDS_RUN"]:
        bad += 1
        failures.append("geo real.json is for run %s but brands.js is %s: rerun tests/oracle/geo.py --write"
                        % (real["run"], base["BRANDS_RUN"]))
    want = [c["id"] for c in G.real_case_inputs()]
    if [c["id"] for c in real["cases"]] != want:
        bad += 1
        failures.append("geo real.json's case list differs from geo.py's: rerun tests/oracle/geo.py --write")
    for c in real["cases"]:
        d = close_call(c, G.call(c["call"], c["args"], geo_d(c, syn, base, tiles)), c["expect"])
        if d:
            bad += 1
            failures.append("geo real.json %r is stale (rerun tests/oracle/geo.py --write): %s" % (c["id"], d))
    print("oracle: geo real.json %d/%d cases are current" % (len(real["cases"]) - min(bad, len(real["cases"])), len(real["cases"])))

    if not geo_built(failures):
        print("oracle: src/js/geo.js is not built yet, so the JS geo comparison is skipped")
        return
    rand = geo_random_cases(base, tiles)
    tally = {}
    for c in rand:
        if c["call"] in ("storesNear", "nearestStore"):
            v = G.call(c["call"], c["args"], geo_d(c, syn, base, tiles))
            k = "null" if v is None else v["status"] + (" partial" if v["partial"] else "") + " r=%d" % v["radius"]
            tally[k] = tally.get(k, 0) + 1
    print("oracle: geo random store searches by outcome: " + ", ".join("%s %d" % kv for kv in sorted(tally.items())))
    groups = (("hand-worked", syn["cases"], True), ("real.json", real["cases"], True), ("random", rand, False))
    allc = [c for _, cs, _ in groups for c in cs]
    res = run_js_geo(syn["datasets"], allc)
    if len(res) != len(allc):
        failures.append("geo: the JS runner returned %d results for %d calls" % (len(res), len(allc)))
        return
    i = 0
    for name, cs, has_expect in groups:
        bad = 0
        for c in cs:
            r_ = res[i]
            i += 1
            if not r_["ok"]:
                d = "JS error: " + r_["err"].splitlines()[0]
            else:
                exp = c["expect"] if has_expect else G.call(c["call"], c["args"], geo_d(c, syn, base, tiles))
                d = close_call(c, exp, r_["v"]) if r_["v"] != "__undefined__" else "returned undefined"
            if d:
                bad += 1
                failures.append("geo %s %r, JS: %s" % (name, c["id"], d))
        print("oracle: geo %s %d/%d calls match the JS" % (name, len(cs) - bad, len(cs)))


# ---------------------------------------------------------------- insights (D-034)

INS_FIX = os.path.join(ROOT, "tests", "fixtures", "insights", "cases.json")


def ins_merge(a, b, replace):
    out = json.loads(json.dumps(a))
    for k, v in b.items():
        if k in replace or not isinstance(v, dict) or not isinstance(out.get(k), dict):
            out[k] = json.loads(json.dumps(v))
        else:
            out[k] = ins_merge(out[k], v, replace)
    return out


def ins_fuzz(i):
    """An insights request built on the engine fuzzer's scenario i: speed, credit cadences and a date added."""
    S, _ = gen_scenario(SEED + i)
    r = random.Random("insights-%d" % (SEED + i))
    S["speed"] = r.choice([27, 15, 45, 0])
    for c in S["credits"]:
        c["cadence"] = r.choice(["monthly", "quarterly", "semiannual", "annual", "once", "weekly"])
        if r.random() < 0.2:
            c["name"] = "Same name"
    now = None if r.random() < 0.05 else [r.choice([2026, 2027, 2028, 2100]), r.randint(0, 11), r.randint(1, 28)]
    return {"F": S, "now": now}


def run_js_insights(requests):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump(requests, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "insights_runner.js"), fin, fout], cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


def insights_checks(failures):
    doc = json.load(open(INS_FIX, encoding="utf-8"))
    reqs, bad = [], 0
    for c in doc["cases"]:
        F = ins_merge(doc["base"], c["patch"], doc["replace"])
        got = I.build(F, E.all_results(F), tuple(c["now"]) if c["now"] else None)
        d = close(c["expect"], got, c["id"])
        if d:
            bad += 1
            failures.append("insights fixture %s is stale vs the python reference: %s" % (c["id"], d))
        reqs.append({"F": F, "now": c["now"]})
    print("oracle: insights fixtures %d/%d cases match the python reference" % (len(doc["cases"]) - bad, len(doc["cases"])))
    if len(doc["cases"]) < 47:
        failures.append("insights: only %d fixture cases (at least 47 expected)" % len(doc["cases"]))
    if not os.path.exists(os.path.join(ROOT, "src", "js", "insights.js")):
        print("oracle: src/js/insights.js is not built yet, so the JS insights comparison is skipped")
        return
    fuzz = [ins_fuzz(i) for i in range(N)]
    res = run_js_insights(reqs + fuzz)
    if len(res) != len(reqs) + len(fuzz):
        failures.append("insights: the JS runner returned %d results for %d requests" % (len(res), len(reqs) + len(fuzz)))
        return
    bad = 0
    for c, r_ in zip(doc["cases"], res[:len(reqs)]):
        d = ("JS error: " + r_["err"].splitlines()[0]) if not r_["ok"] else close(c["expect"], r_["v"], c["id"])
        if d:
            bad += 1
            failures.append("insights fixture %s, JS: %s" % (c["id"], d))
    print("oracle: insights fixtures %d/%d cases match the JS" % (len(reqs) - bad, len(reqs)))
    bad, shown, tally = 0, 0, {}
    for i, (q, r_) in enumerate(zip(fuzz, res[len(reqs):])):
        exp = I.build(q["F"], E.all_results(q["F"]), tuple(q["now"]) if q["now"] else None)
        for x in exp:
            tally[x["id"]] = tally.get(x["id"], 0) + 1
        d = ("JS error: " + r_["err"].splitlines()[0]) if not r_["ok"] else close(exp, r_["v"], "build")
        if d:
            bad += 1
            failures.append("insights scenario seed %d (ORACLE_SEED=%d, index %d): %s" % (SEED + i, SEED, i, d))
    print("oracle: insights %d seeded scenarios: %d differ; insights shown: %s"
          % (N, bad, ", ".join("%s %d" % kv for kv in sorted(tally.items()))))
    for iid in ("unlock", "distance", "fuel", "minimum", "wallet", "timing", "locked", "nuance", "spread"):
        if N >= 200 and tally.get(iid, 0) < 3:
            failures.append("insights: the fuzzer produced %r only %d times in %d scenarios" % (iid, tally.get(iid, 0), N))


# ---------------------------------------------------------------- main

def js_engine_built():
    """True once src/js/engine.js exists. js_runner.js loads it through index.html's script list,
    which throws when the tag is missing, so a file that index.html doesn't load fails the run."""
    return os.path.exists(os.path.join(ROOT, "src", "js", "engine.js"))


def run_js(requests):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump(requests, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "js_runner.js"), fin, fout],
                       cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


# ---------------------------------------------------------------- VIN and car tables (D-037, D-038)

def vin_dataset(doc, name):
    if name is None:
        return None
    if name == "T1:bad":   # T1 with both tables replaced by values that aren't arrays
        return dict(doc["datasets"]["T1"], CAR_DATA=5, CAR_YEARS={"a": 1})
    return doc["datasets"][name]


def vin_args(c):
    if c.get("fixture"):
        with open(os.path.join(VIN_FIX, "vpic", c["fixture"] + ".json"), encoding="utf-8") as fh:
            return [json.load(fh)]
    return c["args"]


def vin_norm(v):
    """JS has one number type: 3.0 and 3 are the same value. Booleans stay booleans."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, list):
        return [vin_norm(x) for x in v]
    if isinstance(v, dict):
        return {k: vin_norm(x) for k, x in v.items()}
    return v


def same(a, b):
    """Exact equality that keeps true apart from 1 and null apart from 0 (compared as JSON text)."""
    return json.dumps(vin_norm(a), sort_keys=True) == json.dumps(vin_norm(b), sort_keys=True)


def vin_fix_check_digit(v):
    total = sum((int(ch) if ch.isdigit() else V.LETTER[ch]) * w for ch, w in zip(v, V.WEIGHTS)) % 11
    return v[:8] + ("X" if total == 10 else str(total)) + v[9:]


def vin_random_cases(seed):
    """Seeded random calls. Datasets are made per call and named R<i>."""
    rnd = random.Random(seed)
    datasets = {}
    cases = []
    junk = list("abcxyz-_ .\t\n\rßü ") + ["\U0001F600", "IOQ", "iOq"]
    for i in range(VIN_N):
        # clean / check / url / key on noisy strings, a third of them valid VINs
        base = "".join(rnd.choice(V.ALLOWED) for _ in range(17))
        if rnd.random() < 0.35:
            base = vin_fix_check_digit(base)
        s = list(base)
        for _ in range(rnd.choice((0, 0, 1, 2, 3))):
            op = rnd.random()
            pos = rnd.randrange(len(s) + 1)
            if op < 0.4:
                s.insert(pos, rnd.choice(junk))
            elif op < 0.7 and s:
                del s[min(pos, len(s) - 1)]
            elif s:
                s[min(pos, len(s) - 1)] = s[min(pos, len(s) - 1)].lower()
        text = "".join(s)
        cases.append({"id": "rand %d clean" % i, "fn": "clean", "args": [text]})
        cases.append({"id": "rand %d check" % i, "fn": "check", "args": [text]})
        cases.append({"id": "rand %d check(clean)" % i, "fn": "check", "args": [V.clean(text)]})
        cases.append({"id": "rand %d url" % i, "fn": "url", "args": [V.clean(text)]})
        cases.append({"id": "rand %d key" % i, "fn": "key", "args": [text]})
        # a small random pair of car tables, then lookups and a match on it
        makes = ["Acme", "acme", "Bolt Co", "Mercedes-Benz", "Mercedes Benz", "Zed"]
        models = ["Sedan", "F150", "F-150", "Model 3", "X", "Van 2WD", ""]
        def entry_runs():
            runs = []
            year = rnd.randint(2015, 2030)
            for _ in range(rnd.randint(0, 4)):
                to = year
                frm = to - rnd.choice((0, 0, 1, 3))
                v = rnd.choice(("0", "5", "24", "38", "120"))
                suf = rnd.choice(("", "", "*", "d", "e"))
                if rnd.random() < 0.85:
                    runs.append("%s%s@%d" % (v, suf, frm) if frm == to else "%s%s@%d-%d" % (v, suf, frm, to))
                else:
                    runs.append(rnd.choice(("x", "", "30@20", "25@2021-2020", "7@1999-2001", "12q@2020")))
                year = frm - rnd.choice((1, 1, 2, 4))
            return " ".join(runs)
        def table(kind):
            out = []
            for _ in range(rnd.randint(0, 3)):
                mk = rnd.choice(makes + [""])
                es = []
                for _ in range(rnd.randint(0, 3)):
                    md = rnd.choice(models)
                    if kind == "years":
                        es.append(md + ":" + entry_runs())
                    else:
                        es.append(md + ":" + rnd.choice(("30", "41*", "22d", "35e", "x", "")))
                out.append(mk + "|" + ",".join(es) if rnd.random() < 0.95 else mk)
            return out
        name = "R%d" % i
        datasets[name] = {"CAR_DATA": table("data"), "CAR_YEARS": table("years")}
        mk, md = rnd.choice(makes), rnd.choice(models)
        yr = rnd.choice([None, None, rnd.randint(2008, 2032), rnd.randint(2008, 2032), 2003.5, "2020", 1899])
        listed = [(m, n) for t in ("CAR_YEARS", "CAR_DATA") for m, es in V.rows(datasets[name], t) for n, _ in es]
        if listed and rnd.random() < 0.8:   # mostly ask about a car the tables list, so lookups hit
            mk, md = rnd.choice(listed)
            runs = V.car_years(datasets[name], mk, md)
            if runs and rnd.random() < 0.6:
                r = rnd.choice(runs)
                yr = rnd.randint(r["from"], r["to"])
        cases.append({"id": "rand %d carMakes" % i, "fn": "carMakes", "args": [], "data": name})
        cases.append({"id": "rand %d carModels" % i, "fn": "carModels", "args": [mk], "data": name})
        cases.append({"id": "rand %d carYears" % i, "fn": "carYears", "args": [mk, md], "data": name})
        cases.append({"id": "rand %d carLookup" % i, "fn": "carLookup", "args": [mk, md, yr], "data": name})
        dec = {"year": rnd.choice((2019, 2019, 1899, 2003.5)), "make": rnd.choice(makes + ["ACME", "MERCEDES-BENZ", "---"]),
               "model": rnd.choice(models + ["f-150", "MODEL 3", "---"])}
        cases.append({"id": "rand %d match" % i, "fn": "match", "args": [dec], "data": name})
    return datasets, cases


def vin_built(failures):
    if not os.path.exists(os.path.join(ROOT, "src", "js", "vin.js")):
        return False
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        if not re.search(r"""<script\b[^>]*\bsrc=["']src/js/vin\.js["']""", fh.read()):
            failures.append("vin: src/js/vin.js exists but index.html doesn't load it")
    return True


def run_js_vin(datasets, cases):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump({"datasets": datasets, "cases": [{"fn": c["fn"], "args": c["args"], "data": c.get("data")}
                                                       for c in cases]}, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "vin_runner.js"), fin, fout], cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


def vin_checks(failures):
    with open(os.path.join(VIN_FIX, "cases.json"), encoding="utf-8") as fh:
        doc = json.load(fh)
    hand = doc["cases"]
    if len(hand) < 100:   # a vanished case list must not pass quietly
        failures.append("vin: only %d hand-worked cases (expected at least 100)" % len(hand))
    bad = 0
    for c in hand:
        got = V.call(c["fn"], vin_args(c), vin_dataset(doc, c.get("data")))
        if not same(got, c["expect"]):
            bad += 1
            failures.append("vin hand-worked %r, python reference: expected %r, got %r" % (c["id"], c["expect"], got))
    print("oracle: vin hand-worked %d/%d cases match the python reference" % (len(hand) - bad, len(hand)))

    if not vin_built(failures):
        print("oracle: src/js/vin.js is not built yet, so the JS vin comparison is skipped")
        return
    datasets = {k: vin_dataset(doc, k) for k in list(doc["datasets"]) + ["T1:bad"]}
    hand_js = [dict(c, args=vin_args(c)) for c in hand]
    rdata, rand = vin_random_cases(SEED)
    datasets.update(rdata)
    seen = {}
    for c in rand:
        if c["fn"] in ("check", "carLookup", "match"):
            v = V.call(c["fn"], c["args"], datasets.get(c.get("data")))
            k = c["fn"] + ":" + (v if isinstance(v, str) else ("null" if v is None else
                                 (v.get("fuel", "") if c["fn"] == "carLookup" else
                                  ("Other" if v["make"] == "Other" else ("model" if v["model"] else "make-only")))))
            seen[k] = seen.get(k, 0) + 1
    print("oracle: vin random outcomes: " + ", ".join("%s %d" % kv for kv in sorted(seen.items())))
    for must in ("check:ok", "check:digit", "check:chars", "check:length", "carLookup:null", "carLookup:regular",
                 "carLookup:ev", "match:Other", "match:model", "match:make-only"):
        if VIN_N >= 200 and seen.get(must, 0) < VIN_N // 100:
            failures.append("vin random: outcome %s seen only %d times" % (must, seen.get(must, 0)))
    res = run_js_vin(datasets, hand_js + rand)
    if len(res) != len(hand_js) + len(rand):
        failures.append("vin: the JS runner returned %d results for %d calls" % (len(res), len(hand_js) + len(rand)))
        return
    for name, cs, i0 in (("hand-worked", hand_js, 0), ("random", rand, len(hand_js))):
        bad = 0
        for j, c in enumerate(cs):
            r_ = res[i0 + j]
            if not r_["ok"]:
                d = "JS error: " + r_["err"].splitlines()[0]
            else:
                exp = c["expect"] if name == "hand-worked" else V.call(c["fn"], c["args"], datasets.get(c.get("data")))
                d = None if same(exp, r_["v"]) else "expected %r, JS gave %r" % (exp, r_["v"])
            if d:
                bad += 1
                failures.append("vin %s %r: %s" % (name, c["id"], d))
        print("oracle: vin %s %d/%d calls match the JS" % (name, len(cs) - bad, len(cs)))


# ---------------------------------------------------------------- the API seam (D-040)
def api_reference():
    """Runs tests/fixtures/api/build.py into a scratch file: its functions are the reference, its output the staleness check."""
    import contextlib
    import io
    import runpy
    build = os.path.join(API_FIX, "build.py")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "cases.json")
        saved = sys.argv
        sys.argv = [build, out]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                ref = runpy.run_path(build, run_name="api_build")
        finally:
            sys.argv = saved
        with open(out, encoding="utf-8") as fh:
            fresh = fh.read()
    return ref, fresh


def api_built(failures):
    if not os.path.exists(os.path.join(ROOT, "src", "js", "api.js")):
        return False
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        if not re.search(r"""<script\b[^>]*\bsrc=["']src/js/api\.js["']""", fh.read()):
            failures.append("api: src/js/api.js exists but index.html doesn't load it")
    return True


def api_random_cases(ref, seed):
    rnd = random.Random(seed)
    T = lambda tag: {"$": tag}
    out = []
    def num():
        r = rnd.random()
        if r < 0.05:
            return rnd.choice([T("NaN"), T("Infinity"), T("-Infinity"), T("-0"), "1", None, True])
        k = rnd.randint(-180000, 180000)
        return rnd.choice([k / 1000, k / 1000 + 0.0005, k / 1000 - 0.0005, k / 1000 + 1e-9, round(rnd.uniform(-181, 181), rnd.randint(0, 7))])
    def val(x):
        return {"-0": -0.0}.get(x["$"], float("nan")) if isinstance(x, dict) else x
    alphabet = "abcXYZ019 ,.-'#\t\n \u001f\u0007﻿ é"
    def text():
        if rnd.random() < 0.05:
            return rnd.choice([None, 12345, ["a"], ""])
        n = rnd.choice([0, 1, 2, 3, 4, 5, 10, 30, 199, 200, 201, 202])
        return "".join(rnd.choice(alphabet) for _ in range(n))
    for _ in range(API_N // 4):
        x = num()
        out.append(({"fn": "fmt3", "args": [x]}, ref["fmt3"](val(x)) if not (isinstance(x, dict) and x["$"] != "-0") else None))
    for _ in range(API_N // 4):
        t = text()
        fn = rnd.choice(["geoQuery", "geoKey", "nameKey"])
        f = {"geoQuery": ref["geo_query"], "geoKey": ref["geo_key"], "nameKey": ref["name_key"]}[fn]
        out.append(({"fn": fn, "args": [t]}, f(t)))
    for _ in range(API_N // 4):
        lat = rnd.choice([40.749, 40.7491, 45.834, -0.0004, 89.9999, 91, rnd.uniform(-90, 90)])
        lon = rnd.choice([-73.986, -109.95, 179.9996, -180, rnd.uniform(-180, 180)])
        pos = rnd.choice([None, {"lat": lat, "lon": lon, "src": rnd.choice(["zip", "gps", "addr"])}])
        store = rnd.choice([None, {"id": "x@1,2", "lat": lat + rnd.choice([0, 0.006, -0.0105]), "lon": lon}])
        S = {"address": rnd.choice(["", "10118", "350 5th Ave, New York, NY 10118", "Big Timber, MT", text()]),
             "pos": pos, "milesSrc": rnd.choice([None, "store", "drive", "pinned", "estimate"]), "store": store}
        A = {"drive": {}, "geo": {}, "nearby": {}}     # answer some of the possible asks at random
        dk = ref["drive_key"](pos, store)
        if dk and rnd.random() < 0.4:
            A["drive"][dk] = rnd.choice([False, {"miles": 1, "minutes": 2}])
        gk = ref["geo_key"](S["address"])
        if gk and rnd.random() < 0.4:
            A["geo"][gk] = False
        p0 = ref["pt"](pos)
        if p0:
            for r in (2, 5, 10):
                if rnd.random() < 0.5:
                    n = rnd.choice([0, 3, 9, 10, 12])
                    A["nearby"][p0 + "/" + str(r)] = rnd.choice([False, {"places": [
                        {"id": "osm:n%d" % (i + 1), "name": rnd.choice(["Subway", "Nook %d" % i, "DOMINO'S"]), "category": "casual",
                         "lat": max(-90, min(90, lat + rnd.uniform(-0.01, 0.01))), "lon": max(-180, min(180, lon + rnd.uniform(-0.01, 0.01)))}
                        for i in range(n)]}])
        opts = rnd.choice([{"failed": {}, "api": A}, {"failed": {}, "api": A}, {"failed": {}}, T("undefined")])
        o = None if isinstance(opts, dict) and opts.get("$") == "undefined" else opts
        if rnd.random() < 0.5:
            out.append(({"fn": "asks", "args": [S, T("D"), opts]}, ref["asks"](S, o)))
        else:
            D = {"BRANDS": {"subway": {"name": "Subway"}, "dominos": {"name": "Domino's"}}}
            out.append(({"fn": "placesFor", "args": [S, D, opts]}, ref["places_for"](S, D, o)))
    for _ in range(API_N // 4):
        b = rnd.choice([{"miles": rnd.choice([0, 33.9, 1000, 1000.01, -1, "3", None]), "minutes": rnd.choice([0, 3.1, -0.1, "1"])},
                        {"lat": rnd.choice([40.7, 91, "1"]), "lon": -73.9, "zip": rnd.choice([None, "10118", "1011", 10118]),
                         "state": rnd.choice([None, "NY", "ny"])},
                        {"places": rnd.choice([[], {}, [{"id": rnd.choice(["osm:n1", "osm:x1", "osm:r0", "osm:w12"]),
                                                         "name": rnd.choice(["A", "", "x" * 121]), "category": rnd.choice(["pizza", "sushi"]),
                                                         "lat": rnd.choice([1, 95]), "lon": 2}]])}, None, []])
        fn = rnd.choice(["checkDrive", "checkGeocode", "checkNearby"])
        f = {"checkDrive": ref["check_drive"], "checkGeocode": ref["check_geocode"], "checkNearby": ref["check_nearby"]}[fn]
        out.append(({"fn": fn, "args": [b]}, f(b)))
    return out


def run_js_api(cases):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump({"cases": cases}, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "api_runner.js"), fin, fout], cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


def api_same(fn, exp, got):
    if fn == "placesFor" and isinstance(exp, list) and isinstance(got, list) and len(exp) == len(got):
        for a, b in zip(exp, got):
            if not isinstance(b, dict) or set(a) != set(b):
                return False
            for k in a:
                if k == "mi":
                    if not (isinstance(b[k], (int, float)) and abs(a[k] - b[k]) <= 1e-9 * max(1.0, abs(a[k]))):
                        return False
                elif a[k] != b[k]:
                    return False
        return True
    return json.dumps(exp, sort_keys=True) == json.dumps(got, sort_keys=True)


def api_checks(failures):
    ref, fresh = api_reference()
    with open(os.path.join(API_FIX, "cases.json"), encoding="utf-8") as fh:
        current = fh.read()
    doc = json.loads(current)
    if fresh != current:
        failures.append("api: tests/fixtures/api/cases.json is stale: run python3 -I tests/fixtures/api/build.py tests/fixtures/api/cases.json")
    print("oracle: api cases.json %s (%d worker cases, %d seam cases)" % ("is current" if fresh == current else "IS STALE",
                                                                          len(doc["worker"]), len(doc["seam"])))
    if not api_built(failures):
        print("oracle: src/js/api.js is not built yet, so the JS comparison is skipped")
        return
    fixed = [({"fn": c["fn"], "args": c["args"], "config": c.get("config")}, c["returns"]) for c in doc["seam"] if c["fn"] != "remember"]
    rnd = api_random_cases(ref, SEED)
    results = run_js_api([c for c, _ in fixed + rnd])
    for label, group, res in (("hand-worked", fixed, results[:len(fixed)]), ("random", rnd, results[len(fixed):])):
        bad = 0
        for (c, exp), r in zip(group, res):
            got = r["v"] if r["ok"] else "JS error: " + r["err"]
            if not r["ok"] or not api_same(c["fn"], exp, got):
                bad += 1
                if bad <= 5:
                    failures.append("api %s %s(%s): expected %s, JS gave %s" % (label, c["fn"], json.dumps(c["args"])[:160],
                                                                             json.dumps(exp)[:160], json.dumps(got)[:160]))
        print("oracle: api %s %d/%d seam calls match the JS" % (label, len(group) - bad, len(group)))


# ---------------------------------------------------------------- links (D-041)

def links_built(failures):
    if not os.path.exists(os.path.join(ROOT, "src", "js", "links.js")):
        return False
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        if not re.search(r"""<script\b[^>]*\bsrc=["']src/js/links\.js["']""", fh.read()):
            failures.append("links: src/js/links.js exists but index.html doesn't load it")
    return True


def run_js_links(datasets, cases):
    with tempfile.TemporaryDirectory() as tmp:
        fin = os.path.join(tmp, "in.json")
        fout = os.path.join(tmp, "out.json")
        with open(fin, "w", encoding="utf-8") as fh:
            json.dump({"datasets": datasets, "cases": [{"ch": c["ch"], "S": c["S"], "data": c["data"]} for c in cases]}, fh)
        subprocess.run(["node", os.path.join("tests", "oracle", "links_runner.js"), fin, fout], cwd=ROOT, check=True)
        with open(fout, encoding="utf-8") as fh:
            return json.load(fh)


LINK_PARTS = ["Domino's", "Taco", " ", "Bell", "&", "'", "/", "%", "+", "?", "#", "=", ",", ";", ":", "@", "Café", "85°C",
              "Müller", "日本", "\U0001F32E", "{q}", "{lat}", "{lon}", "\ud800", "\udfff", "!*()~", "\t", "\n", "-_.", "%7B",
              "Ben & Jerry's", "A&W", "Chick-fil-A", "\"", "<b>", "\\", " ", "​"]
LINK_BRANDS = ["dominos", "wingstop", "taco_bell", "papa_johns", "osm:n42", "osm:w7", "__proto__", "constructor",
               "toString", "hasOwnProperty", "", "x", "dominos@"]
LINK_JUNK_CH = ["direct", "dd", "DD-P", "", "dd-p ", None, 3, "x-p", "direct-x", "ue_d", ["dd-p"]]


def links_coord(rnd, lim):
    k = rnd.random()
    if k < 0.35:
        return round(rnd.uniform(-lim, lim), 7)
    if k < 0.55:
        return rnd.randint(-lim * 1000, lim * 1000) / 1000
    if k < 0.65:
        return rnd.randint(-lim * 64, lim * 64) / 64          # exact ties at 5 decimals when odd
    if k < 0.72:
        return rnd.choice([lim, -lim, 0, 1e-06, -1e-06, 5e-06, -5e-06, 0.000005, lim - 0.000005])
    if k < 0.78:
        return rnd.randint(-lim, lim)
    if k < 0.84:
        return rnd.choice([lim + 0.0000001, -lim - 1, 1000, -1e9])
    if k < 0.9:
        return rnd.uniform(-lim, lim)
    return rnd.choice(["40.7", None, True, False, [1], {"v": 1}])


def links_random_data(rnd, base):
    d = json.loads(json.dumps(base))
    L = d["LINKS"]
    pick = lambda p: rnd.random() < p
    for p in ("dd", "ue", "gh"):
        if pick(0.15):
            L["apps"][p]["search"] = rnd.choice([None, "{q}", "http://a.example/{q}", "https://d.example/s?q={q}&r={q}",
                                                 5, "https://d.example/nosub", "https://www.ubereats.com/search?q={q}"])
        if pick(0.1):
            L["apps"][p]["home"] = rnd.choice(["http://x.example/", None, "https://h.example/", "javascript:alert(1)", "",
                                               "https:h.example/", "https:/h.example/", "HTTPS://h.example/"])
        if pick(0.05):
            L["apps"][p] = rnd.choice(["https://www.grubhub.com/", None, [], {"home": "https://www.grubhub.com/"}])
    if pick(0.1):
        L["maps"]["name"] = rnd.choice(["", None, "Apple Maps", 7])
    if pick(0.15):
        L["maps"]["dir"] = rnd.choice([None, "https://m.example/?d={lat}", "https://m.example/?d={lon},{lat}&again={lat}",
                                       "http://m.example/{lat},{lon}", "{lat}{lon}", "https:m.example/{lat},{lon}"])
    if pick(0.15):
        L["maps"]["search"] = rnd.choice([None, "https://m.example/?q={q}", "q={q}"])
    if pick(0.3):
        for b in rnd.sample(LINK_BRANDS, 3):
            L["order"][b] = rnd.choice([{"url": "https://site.example/" + str(rnd.randint(1, 9))}, {"url": "http://site.example/"},
                                        {"url": None}, {}, "https://site.example/", None])
    if pick(0.05):
        del L["maps"]
    if pick(0.03):
        L["apps"] = ["dd", "ue", "gh"]
    if pick(0.03):
        L["order"] = None
    if pick(0.02):
        del d["LINKS"]
    return d


def links_random_cases(base, seed):
    rnd = random.Random(seed)
    datasets = {"T": base}
    for k in range(40):
        datasets["R%d" % k] = links_random_data(rnd, base)
    names = ["T"] * 20 + ["R%d" % k for k in range(40)]
    cases = []
    for i in range(LINKS_N):
        ch = rnd.choice(LK.CHANNELS + ("direct-p",) * 4 + ("direct-d",)) if rnd.random() < 0.88 else rnd.choice(LINK_JUNK_CH)
        brand = rnd.choice(LINK_BRANDS) if rnd.random() < 0.95 else rnd.choice([None, 5, True])
        r = rnd.random()
        if r < 0.9:
            name = "".join(rnd.choice(LINK_PARTS) for _ in range(rnd.randint(1, 4)))
            rest = {"name": name}
        else:
            rest = rnd.choice([None, [], {}, {"name": ""}, {"name": 7}, "Domino's"])
        r = rnd.random()
        bstr = brand if isinstance(brand, str) else "x"
        if r < 0.5:
            store = {"id": bstr + "@" + str(rnd.randint(0, 99)), "lat": links_coord(rnd, 90), "lon": links_coord(rnd, 180)}
        elif r < 0.62:
            store = {"id": rnd.choice(["taco_bell@1,2", "dominos@40755,-73989", bstr, bstr + "x@1", "@"]), "lat": 40.7, "lon": -74}
        elif r < 0.75:
            store = None
        else:
            store = rnd.choice([{"id": bstr + "@1", "lat": 1}, {"id": 5, "lat": 1, "lon": 2}, "store", [], {"id": bstr + "@1"}])
        S = {"brand": brand, "rest": rest, "store": store}
        if rnd.random() < 0.03:
            del S["store"]
        if rnd.random() < 0.02:
            S = rnd.choice([None, [], "S"])
        data = rnd.choice(names) if rnd.random() < 0.97 else None
        cases.append({"ch": ch, "S": S, "data": data})
    return datasets, cases


def links_checks(failures):
    import contextlib
    import io
    import runpy
    path = os.path.join(LINKS_FIX, "cases.json")
    with open(path, encoding="utf-8") as fh:
        current = fh.read()
    build = os.path.join(LINKS_FIX, "build.py")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "cases.json")
        saved = sys.argv
        sys.argv = [build, out]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(build, run_name="__main__")
        except SystemExit as e:
            failures.append("links: build.py refused to write: %s" % e)
        finally:
            sys.argv = saved
        fresh = open(out, encoding="utf-8").read() if os.path.exists(out) else None
    if fresh != current:
        failures.append("links: tests/fixtures/links/cases.json is stale: run python3 -I tests/fixtures/links/build.py tests/fixtures/links/cases.json")
    doc = json.loads(current)
    hand = doc["cases"]
    if len(hand) < 80:
        failures.append("links: only %d hand-worked cases (expected at least 80)" % len(hand))
    bad = 0
    for c in hand:
        D = None if c["data"] is None else json.loads(json.dumps(doc["datasets"][c["data"]]))
        if LK.for_channel(c["ch"], c["S"], D) != c["expect"]:
            bad += 1
            failures.append("links hand-worked %r, python reference disagrees" % c["id"])
    print("oracle: links cases.json %s; %d/%d hand-worked cases match the python reference"
          % ("is current" if fresh == current else "IS STALE", len(hand) - bad, len(hand)))
    if not links_built(failures):
        print("oracle: src/js/links.js is not built yet, so the JS links comparison is skipped")
        return
    rdata, rand = links_random_cases(doc["datasets"]["T"], SEED)
    datasets = dict(doc["datasets"])
    datasets.update({k: v for k, v in rdata.items() if k != "T"})
    res = run_js_links(datasets, hand + rand)
    if len(res) != len(hand) + len(rand):
        failures.append("links: the JS runner returned %d results for %d calls" % (len(res), len(hand) + len(rand)))
        return
    seen = {}
    for c in rand:
        D = None if c["data"] is None else json.loads(json.dumps(datasets[c["data"]]))
        for l in LK.for_channel(c["ch"], json.loads(json.dumps(c["S"])), D):
            seen[l["kind"]] = seen.get(l["kind"], 0) + 1
    print("oracle: links random links by kind: " + ", ".join("%s %d" % kv for kv in sorted(seen.items())))
    for must in ("search", "app", "order", "dir", "map"):
        if LINKS_N >= 1000 and seen.get(must, 0) < LINKS_N // 100:
            failures.append("links random: kind %s seen only %d times" % (must, seen.get(must, 0)))
    for name, group, rs in (("hand-worked", hand, res[:len(hand)]), ("random", rand, res[len(hand):])):
        bad = 0
        for c, r in zip(group, rs):
            D = None if c["data"] is None else json.loads(json.dumps(datasets[c["data"]]))
            exp = c["expect"] if name == "hand-worked" else LK.for_channel(c["ch"], json.loads(json.dumps(c["S"])), D)
            got = r["v"] if r["ok"] else "JS error: " + r["err"]
            if not r["ok"] or json.dumps(exp, sort_keys=True) != json.dumps(got, sort_keys=True):
                bad += 1
                if bad <= 5:
                    failures.append("links %s ch=%s S=%s data=%s: expected %s, JS gave %s" % (
                        name, json.dumps(c["ch"]), json.dumps(c["S"])[:160], c["data"], json.dumps(exp)[:200], json.dumps(got)[:200]))
        print("oracle: links %s %d/%d calls match the JS" % (name, len(group) - bad, len(group)))


def main():
    failures = []

    cases = receipt_cases()
    for label, case, req in cases:
        d = check_expect(case, py_call(req))
        if d:
            failures.append("receipt %s, python oracle: %s" % (label, d))
    print("oracle: receipts %d/%d cases match the python oracle" % (len(cases) - len(failures), len(cases)))

    if not js_engine_built():
        print("oracle: src/js/engine.js is not built yet, so the JS comparison is skipped")
    else:
        rec_reqs = [req for _, _, req in cases]
        fuzz = []
        for i in range(N):
            for req in scenario_requests(i):
                fuzz.append((i, req))
        results = run_js(rec_reqs + [req for _, req in fuzz])
        js_rec, js_fuzz = results[:len(rec_reqs)], results[len(rec_reqs):]

        bad = 0
        for (label, case, req), res in zip(cases, js_rec):
            d = ("JS error: " + res["err"]) if not res["ok"] else check_expect(case, res["v"])
            if d:
                bad += 1
                failures.append("receipt %s, JS engine: %s" % (label, d))
        print("oracle: receipts %d/%d cases match the JS engine" % (len(cases) - bad, len(cases)))

        bad_scen = set()
        seen = {"bogo": set(), "itemMarkup": set()}
        for (i, req), res in zip(fuzz, js_fuzz):
            if req["call"] == "calc":
                v = py_call(req)
                if v is not None and any(n.startswith("BOGO: ") for n in v["notes"]):
                    seen["bogo"].add(i)
                if v is not None and v["plat"] != "direct" and req["S"]["rest"]["profiled"]:
                    plain = dict(req["S"], rest=dict(req["S"]["rest"], menu=[
                        ({k: x for k, x in it.items() if k != "markup"} if isinstance(it, dict) else it) for it in req["S"]["rest"]["menu"]]))
                    if E.calc(plain, req["channel"], req.get("override"))["parts"]["food"] != v["parts"]["food"]:
                        seen["itemMarkup"].add(i)
            if not res["ok"]:
                d = "JS error: " + res["err"]
            else:
                d = diff(py_call(req), res["v"], req["call"] + (" " + req["channel"] if "channel" in req else ""))
            if d and i not in bad_scen:
                bad_scen.add(i)
                failures.append("scenario seed %d (ORACLE_SEED=%d, index %d): %s" % (SEED + i, SEED, i, d))
        print("oracle: %d seeded scenarios x %d calls: %d scenarios differ; a BOGO applied in %d, a per-item markup moved food in %d"
              % (N, len(fuzz) // max(N, 1), len(bad_scen), len(seen["bogo"]), len(seen["itemMarkup"])))
        for k, v in seen.items():   # D-036: the fuzzer must keep exercising both features
            if N >= 200 and len(v) < N // 20:
                failures.append("scenarios: %s exercised in only %d of %d scenarios" % (k, len(v), N))

    geo_checks(failures)
    insights_checks(failures)
    vin_checks(failures)
    api_checks(failures)
    links_checks(failures)

    for f in failures[:10]:
        print("FAIL " + f)
    if len(failures) > 10:
        print("... and %d more" % (len(failures) - 10))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
