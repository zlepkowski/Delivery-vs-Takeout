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

ROOT = os.path.dirname(os.path.dirname(HERE))
RECEIPTS = os.path.join(ROOT, "tests", "fixtures", "receipts")
N = int(os.environ.get("ORACLE_N", "500"))
SEED = int(os.environ.get("ORACLE_SEED", "20261112"))
APPS = ("dd", "ue", "gh")
GEO_FIX = os.path.join(ROOT, "tests", "fixtures", "geo")
GEO_N = int(os.environ.get("ORACLE_GEO_N", "60"))


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
        menu = [["Item %d" % i, money(0.5, 30), r.random() < 0.4] for i in range(n)]
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
        t = r.choice(["none", "percent", "dollar", "freedel"])
        pr = {"type": t, "value": pct(5, 60) if t == "percent" else (money(1, 40) if t == "dollar" else 0)}
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
        base = E.cart_info(S, ov)["menuSub"]
        food = E.round2(base * (1 + plats[p]["markup"] / 100))
        which = r.choice(["memberMin", "promoMin", "smallMin"])
        if which == "memberMin":
            plats[p]["memberMin"] = food
        elif which == "promoMin":
            promos[p]["min"] = food
        else:
            S["smallMin"] = food
    return S, ov


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
        for (i, req), res in zip(fuzz, js_fuzz):
            if not res["ok"]:
                d = "JS error: " + res["err"]
            else:
                d = diff(py_call(req), res["v"], req["call"] + (" " + req["channel"] if "channel" in req else ""))
            if d and i not in bad_scen:
                bad_scen.add(i)
                failures.append("scenario seed %d (ORACLE_SEED=%d, index %d): %s" % (SEED + i, SEED, i, d))
        print("oracle: %d seeded scenarios x %d calls: %d scenarios differ" % (N, len(fuzz) // max(N, 1), len(bad_scen)))

    geo_checks(failures)

    for f in failures[:10]:
        print("FAIL " + f)
    if len(failures) > 10:
        print("... and %d more" % (len(failures) - 10))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
