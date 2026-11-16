"""Python reference for POD.vin (docs/vin-contract.md, D-038) and the car-table helpers of the
state contract §4.0 (D-037): carMakes, carModels, carYears, carLookup.

Written from the contracts by the orchestrator, independently of src/js/vin.js and state.js.
Standard library only. JS strings are UTF-16, so every length and every order here is in
UTF-16 code units, not Python code points.
"""
import math
import re

BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/"
ALLOWED = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ"
LETTER = dict(zip("ABCDEFGHJKLMNPRSTUVWXYZ", [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9]))
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
RUN_RE = re.compile(r"([0-9]+)([*de]?)@([0-9]{4})(-([0-9]{4}))?")
VALUE_RE = re.compile(r"([0-9]+)([*de]?)")
YEAR_RE = re.compile(r"[0-9]{4}")
FUEL = {"": "regular", "*": "premium", "d": "diesel", "e": "ev"}
TRIM = " \t\n\r"


def is_str(x):
    return isinstance(x, str)


def is_int(x):
    return (isinstance(x, (int, float)) and not isinstance(x, bool)
            and math.isfinite(x) and math.floor(x) == x)


def is_obj(x):
    return isinstance(x, dict)


def units(s):
    """The UTF-16 code units of s, as a list of ints (JS's view of a string)."""
    b = s.encode("utf-16-le", "surrogatepass")
    return [b[i] | (b[i + 1] << 8) for i in range(0, len(b), 2)]


def from_units(us):
    return b"".join(bytes([u & 0xFF, u >> 8]) for u in us).decode("utf-16-le", "surrogatepass")


def js_sorted(xs):
    """Plain JS string order: by UTF-16 code units."""
    return sorted(xs, key=units)


def js_int(text):
    """parseInt(text, 10) of a string of ASCII digits, as JS holds it (a double)."""
    n = int(text)
    return n if n <= 2 ** 53 else float(n)


# ---------------------------------------------------------------- vin contract §2-§7

def clean(text):
    if not is_str(text):
        return ""
    out = []
    for u in units(text):
        if 0x61 <= u <= 0x7A:
            out.append(u - 0x20)
        elif u in (0x20, 0x09, 0x0A, 0x0D, 0x2D):
            continue
        else:
            out.append(u)
    return from_units(out)


def check(vin):
    if not is_str(vin) or len(units(vin)) != 17:
        return "length"
    if any(ch not in ALLOWED for ch in vin):
        return "chars"
    total = 0
    for ch, w in zip(vin, WEIGHTS):
        total += (int(ch) if ch.isdigit() else LETTER[ch]) * w
    r = total % 11
    expected = "X" if r == 10 else str(r)
    return "ok" if vin[8] == expected else "digit"


def url(vin):
    return BASE + vin + "?format=json" if check(vin) == "ok" else None


def trim(s):
    return s.strip(TRIM)


def decode(body):
    if not is_obj(body):
        return None
    res = body.get("Results")
    if not isinstance(res, list) or len(res) < 1 or not is_obj(res[0]):
        return None
    r = res[0]
    y, mk, md = r.get("ModelYear"), r.get("Make"), r.get("Model")
    if not (is_str(y) and is_str(mk) and is_str(md)):
        return None
    y = trim(y)
    if not YEAR_RE.fullmatch(y):
        return None
    year = int(y)
    if not 1900 <= year <= 2100:
        return None
    mk, md = trim(mk), trim(md)
    if mk == "" or md == "":
        return None
    return {"year": year, "make": mk, "model": md}


def key(s):
    if not is_str(s):
        return ""
    out = []
    for ch in s:
        o = ord(ch)
        if 0x41 <= o <= 0x5A:
            out.append(chr(o + 0x20))
        elif 0x61 <= o <= 0x7A or 0x30 <= o <= 0x39:
            out.append(ch)
    return "".join(out)


def match(dec, D):
    if not is_obj(dec):
        return None
    y = dec.get("year")
    if not (is_int(y) and 1900 <= y <= 2100 and is_str(dec.get("make")) and is_str(dec.get("model"))):
        return None
    mk = key(dec["make"])
    make = None
    if mk != "":
        for m in car_makes(D):
            if key(m) == mk:
                make = m
                break
    if make is None:
        return {"make": "Other", "model": "", "year": y}
    md = key(dec["model"])
    model = ""
    if md != "":
        for n in car_models(D, make):
            if key(n) == md:
                model = n
                break
    return {"make": make, "model": model, "year": y}


# ---------------------------------------------------------------- state contract §4.0

def rows(D, name):
    """[(make, [(model, value text), ...]), ...] for one table, skipping what §4.0 skips."""
    t = D.get(name) if is_obj(D) else None
    if not isinstance(t, list):
        return []
    out = []
    for r in t:
        if not is_str(r) or "|" not in r:
            continue
        make, rest = r.split("|", 1)
        if make == "":
            continue
        entries = []
        for e in rest.split(","):
            if ":" not in e:
                continue
            model, val = e.split(":", 1)
            if model == "":
                continue
            entries.append((model, val))
        out.append((make, entries))
    return out


def uniq(xs):
    seen, out = set(), []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def car_makes(D):
    return js_sorted(uniq([mk for name in ("CAR_DATA", "CAR_YEARS") for mk, _ in rows(D, name)]))


def car_models(D, make):
    if not is_str(make):
        return []
    return js_sorted(uniq([md for name in ("CAR_DATA", "CAR_YEARS")
                           for mk, es in rows(D, name) if mk == make for md, _ in es]))


def spec(v, suffix):
    if suffix == "e":
        return {"fuel": "ev", "mpg": None, "miPerKwh": v / 10}
    return {"fuel": FUEL[suffix], "mpg": v, "miPerKwh": None}


def car_years(D, make, model):
    if not (is_str(make) and is_str(model)):
        return []
    out = []
    for mk, es in rows(D, "CAR_YEARS"):
        if mk != make:
            continue
        for md, val in es:
            if md != model:
                continue
            for run in val.split(" "):
                m = RUN_RE.fullmatch(run)
                if not m:
                    continue
                v = js_int(m.group(1))
                frm = int(m.group(3))
                to = int(m.group(5)) if m.group(5) is not None else frm
                if v <= 0 or frm > to:
                    continue
                d = {"from": frm, "to": to}
                d.update(spec(v, m.group(2)))
                out.append(d)
    return out


def car_lookup(D, make, model, year):
    if not (is_str(make) and is_str(model)):
        return None
    if year is None:
        runs = car_years(D, make, model)
        if runs:
            best = runs[0]
            for r in runs[1:]:
                if r["to"] > best["to"]:
                    best = r
            return {"fuel": best["fuel"], "mpg": best["mpg"], "miPerKwh": best["miPerKwh"], "year": best["to"]}
        for mk, es in rows(D, "CAR_DATA"):
            if mk != make:
                continue
            for md, val in es:
                if md != model:
                    continue
                m = VALUE_RE.fullmatch(val)
                if m:
                    d = spec(js_int(m.group(1)), m.group(2))
                    d["year"] = None
                    return d
        return None
    if is_int(year) and 1900 <= year <= 2100:
        for r in car_years(D, make, model):
            if r["from"] <= year <= r["to"]:
                return {"fuel": r["fuel"], "mpg": r["mpg"], "miPerKwh": r["miPerKwh"], "year": year}
        return None
    return None


# ---------------------------------------------------------------- dispatch

FNS = {"clean": clean, "check": check, "url": url, "decode": decode, "key": key, "match": match,
       "carMakes": car_makes, "carModels": car_models, "carYears": car_years, "carLookup": car_lookup}
# Where D goes in each call's argument list (None: the call takes no D).
D_POS = {"clean": None, "check": None, "url": None, "decode": None, "key": None, "match": 1,
         "carMakes": 0, "carModels": 0, "carYears": 0, "carLookup": 0}


def call(fn, args, D):
    args = list(args)
    if D_POS[fn] is not None:
        args.insert(D_POS[fn], D)
    return FNS[fn](*args)
