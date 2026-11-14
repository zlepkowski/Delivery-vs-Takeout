"""Independent Python implementation of POD.insights (docs/insights-contract.md, D-034).

Written by the orchestrator from the contract, never from src/js/insights.js. It prices
counterfactuals with the Python engine oracle (engine.py), so it shares no code with the JS.
When the two disagree, one of them is wrong and the orchestrator decides which.

`now` is a (year, month0, day) tuple: the contract reads only the local calendar date.
Standard library only (D-017).
"""
import math

import engine as E

APP_NAME = {"dd": "DoorDash", "ue": "Uber Eats", "gh": "Grubhub"}
CADENCES = ("monthly", "quarterly", "semiannual", "annual")


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _obj(x):
    return isinstance(x, dict)


def round1(x):
    return E.js_round(x * 10) / 10


def z(x):
    """Contract §0: data numbers are x + 0, so -0 becomes 0."""
    return x + 0.0 if isinstance(x, float) else x


def mi(x):
    return "%.1f" % (round1(x) + 0.0)


def money(n):
    v = "%.2f" % E.round2(abs(n))
    whole, cents = v.split(".")
    whole = "{:,}".format(int(whole))
    return ("−$" if n < 0 else "$") + whole + "." + cents


def _find(R, cid):
    for r in R:
        if r["id"] == cid:
            return r
    return None


def _first(R, pred):
    for r in R:
        if pred(r):
            return r
    return None


def _cheapest(menu, idxs):
    best = None
    for i in idxs:
        if best is None or menu[i]["price"] < menu[best]["price"]:
            best = i
    return best


def _cart_plus(cart, j, k):
    c = dict(cart or {})
    v = c.get(str(j))
    c[str(j)] = (v if _num(v) else 0) + k
    return c


def _blocked(F, c):
    """A restricted credit not opted in (§9.1)."""
    opt = F.get("creditOptIn") if _obj(F.get("creditOptIn")) else {}
    return c.get("restricted") is True and opt.get(c.get("key")) is not True


def _ins(iid, label, cls, text, data):
    return {"id": iid, "label": label, "cls": cls, "text": text,
            "data": {k: ([dict((a, z(b)) for a, b in it.items()) for it in v] if isinstance(v, list) and v and isinstance(v[0], dict) else z(v))
                     for k, v in data.items()}}


def unlock(F, R):
    rest = F["rest"]
    deal = rest.get("deal")
    if not _obj(deal) or F.get("dealOn") is not True:
        return None
    ci = E.cart_info(F)
    if not ci["shortBy"] > 0:
        return None
    menu = rest.get("menu") or []
    j = _cheapest(menu, [i for i in range(len(menu)) if menu[i].get("dealItem") is True])
    if j is None:
        return None
    cart2 = _cart_plus(F.get("cart"), j, ci["shortBy"])
    best = None
    for ch in ("direct-d", "direct-p"):
        a = E.calc(F, ch, {"cart": cart2})
        if a is not None and ("Deal: " + deal["label"]) in a["notes"]:
            if best is None or a["net"] < best["net"]:
                best = a
    if best is None:
        return None
    was = _find(R, best["id"])["net"]
    text = ("Add " + str(ci["shortBy"]) + " × " + menu[j]["name"] + " and " + deal["label"] + " applies: "
            + best["name"] + " comes to " + money(best["net"]) + " (now " + money(was) + ").")
    return _ins("unlock", "Unlock", "good" if best["net"] <= R[0]["net"] else "", text,
                {"n": ci["shortBy"], "item": menu[j]["name"], "channel": best["id"], "net": best["net"], "was": was})


def distance(F, R):
    bp = _first(R, lambda r: r["mode"] == "p")
    bd = _first(R, lambda r: r["mode"] == "d")
    if bp is None or bd is None:
        return None
    hourly, speed = F.get("hourly"), F.get("speed")
    rate = E.per_mile(F) + (hourly / speed if (_num(hourly) and _num(speed) and hourly > 0 and speed > 0) else 0)
    if not rate > 0:
        return None
    fixed = E.calc(F, bp["id"], {"miles": 0, "minutes": 0})["net"]
    be = (bd["net"] - fixed) / rate
    miles = F["miles"]
    data = {"breakEven": round1(be), "miles": round1(miles), "pickup": bp["id"], "delivery": bd["id"]}
    if be <= 0:
        return _ins("distance", "Distance", "", "Delivery (" + bd["name"] + ", " + money(bd["net"])
                    + ") costs less than picking up, even from next door.", data)
    if be >= miles:
        return _ins("distance", "Distance", "good", "Picking up stays cheaper than delivery up to a " + mi(be)
                    + " mi round trip. Yours is " + mi(miles) + " mi.", data)
    return _ins("distance", "Distance", "", "Delivery wins once the round trip passes " + mi(be)
                + " mi, and yours is " + mi(miles) + " mi.", data)


def fuel(F, R):
    if F.get("fuel") == "ev" or not (_num(F.get("mpg")) and F["mpg"] > 0) or not (_num(F.get("miles")) and F["miles"] > 0):
        return None
    bp = _first(R, lambda r: r["mode"] == "p")
    bd = _first(R, lambda r: r["mode"] == "d")
    if bp is None or bd is None or not bp["net"] < bd["net"]:
        return None
    be = F["gas"] + (bd["net"] - bp["net"]) / (F["miles"] / F["mpg"])
    capped = be > 12
    data = {"gas": F["gas"], "breakEven": E.round2(be), "capped": capped}
    if capped:
        return _ins("fuel", "Fuel", "", "Even at $12.00/gal, picking up still wins.", data)
    return _ins("fuel", "Fuel", "", "Picking up wins until gas reaches " + money(E.round2(be)) + "/gal. Yours costs "
                + money(F["gas"]) + "/gal.", data)


def minimum(F, R):
    rest = F["rest"]
    menu = rest.get("menu") or []
    profiled = rest.get("profiled") is True
    best = None
    for r in R:
        if r["plat"] == "direct":
            continue
        pr = (F.get("promos") or {}).get(r["plat"])
        types = ("percent", "dollar", "freedel", "bogo") if profiled else ("percent", "dollar", "freedel")
        if not _obj(pr) or pr.get("type") not in types:   # D-036: bogo needs a menu
            continue
        mn = pr.get("min")
        if not (_num(mn) and mn > 0) or not r["parts"]["food"] < mn:
            continue
        if pr["type"] == "freedel" and r["mode"] == "p":
            continue
        a = None
        if profiled:
            j = _cheapest(menu, range(len(menu)))
            if j is None:
                continue
            for k in range(1, 21):
                t = E.calc(F, r["id"], {"cart": _cart_plus(F.get("cart"), j, k)})
                if t["parts"]["food"] >= mn:
                    a = t
                    break
            if a is None:
                continue
            if pr["type"] == "bogo" and not any(n.startswith("BOGO: ") for n in a["notes"]):
                continue   # D-036: reaching the minimum must make something free
            add_qty, add_item, add_amount = k, menu[j]["name"], E.round2(k * menu[j]["price"])
        else:
            pl = (F.get("plats") if _obj(F.get("plats")) else {}).get(r["plat"])
            mk = pl.get("markup") if _obj(pl) else None
            if not _num(mk):
                continue
            ms = math.ceil(mn / (1 + mk / 100) * 100) / 100
            for _ in range(5):
                t = E.calc(F, r["id"], {"manualSubtotal": ms})
                if t["parts"]["food"] >= mn:
                    a = t
                    break
                ms = E.round2(ms + 0.01)
            if a is None:
                continue
            add_qty, add_item, add_amount = None, None, E.round2(ms - F["manualSubtotal"])
        delta = E.round2(a["net"] - r["net"])
        if best is None or delta < best[0]:
            best = (delta, r, a, mn, add_qty, add_item, add_amount)
    if best is None:
        return None
    delta, r, a, mn, add_qty, add_item, add_amount = best
    short = E.round2(mn - r["parts"]["food"])
    add = ("Adding " + str(add_qty) + " × " + add_item + " (" + money(add_amount) + ")") if profiled \
        else ("Adding " + money(add_amount) + " of food")
    change = (money(-delta) + " less") if delta < 0 else (money(delta) + " more")
    text = (r["name"] + " is " + money(short) + " short of its " + money(mn) + " promo minimum. " + add
            + " brings it to " + money(a["net"]) + ": " + change + " than now.")
    return _ins("minimum", "Minimum", "good" if delta < 0 else "", text,
                {"channel": r["id"], "min": mn, "short": short, "addQty": add_qty, "addItem": add_item,
                 "addAmount": add_amount, "net": a["net"], "was": r["net"], "delta": delta})


def wallet(F, R):
    rest = F["rest"]
    direct = (F.get("plats") or {}).get("direct")
    if rest.get("amexGoldDirect") is not True or not _obj(direct) or direct.get("on") is not True:
        return None
    credits = F.get("credits")
    if not isinstance(credits, list):
        return None
    c = _first(credits, lambda c: _obj(c) and c.get("goldPartner") is True and c.get("locked") is not True
               and not _blocked(F, c))
    if c is None:
        return None
    used = c.get("used") is True
    data = {"credit": c["key"], "amount": c["amount"], "used": used}
    if used:
        return _ins("wallet", "Wallet", "", rest["name"] + " is an Amex Gold dining partner, but your " + c["name"]
                    + " is marked used this period.", data)
    return _ins("wallet", "Wallet", "good", rest["name"] + " is an Amex Gold dining partner, so your " + money(c["amount"])
                + " " + c["name"] + " works when you order direct.", data)


def _dim(y, t):
    if t == 1:
        return 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][t]


def days_until_reset(cadence, now):
    y, m, d = now
    s = {"monthly": m + 1, "quarterly": (m // 3 + 1) * 3, "semiannual": (m // 6 + 1) * 6, "annual": 12}[cadence]
    return _dim(y, m) - d + 1 + sum(_dim(y, t) for t in range(m + 1, s))


def timing(F, R, now):
    if now is None:
        return None
    gold_here = F["rest"].get("amexGoldDirect") is True
    items = []
    for c in F.get("credits") or []:
        if not _obj(c) or c.get("locked") is True or c.get("used") is True or c.get("cadence") not in CADENCES:
            continue
        pl = c.get("plats")
        if not ((isinstance(pl, list) and len(pl) > 0) or (c.get("goldPartner") is True and gold_here and not _blocked(F, c))):
            continue
        items.append({"key": c["key"], "name": c["name"], "amount": c["amount"], "days": days_until_reset(c["cadence"], now)})
    if not items:
        return None
    items.sort(key=lambda it: (it["days"], _js_str_key(it["key"])))
    total = 0
    for it in items:
        total += it["amount"]

    def one(it):
        return it["name"] + " (" + money(it["amount"]) + ", resets in " + ("1 day" if it["days"] == 1 else str(it["days"]) + " days") + ")"
    text = "Unused this period: " + "; ".join(one(it) for it in items[:3])
    if len(items) > 3:
        text += "; and " + str(len(items) - 3) + " more"
    text += "."
    return _ins("timing", "Timing", "hot" if items[0]["days"] <= 7 else "", text,
                {"items": items, "total": E.round2(total)})


def _js_str_key(s):
    """JavaScript compares strings by UTF-16 code units."""
    return s.encode("utf-16-be")


def locked(F, R):
    credits = [c for c in (F.get("credits") or []) if _obj(c)]
    opt = F.get("creditOptIn") if _obj(F.get("creditOptIn")) else {}
    lk = [c for c in credits if c.get("locked") is True]
    rs = [c for c in credits if c.get("restricted") is True and c.get("locked") is not True and opt.get(c["key"]) is not True]
    if not lk and not rs:
        return None

    def names(cs):
        out = []
        for c in cs:
            if c["name"] not in out:
                out.append(c["name"])
        return ", ".join(out)
    parts = []
    if lk:
        parts.append("Can't be used on a restaurant order: " + names(lk) + ".")
    if rs:
        parts.append("Only at some restaurants (tick “Qualifies here” if this one takes it): " + names(rs) + ".")
    return _ins("locked", "Locked", "", " ".join(parts), {"locked": [c["key"] for c in lk], "restricted": [c["key"] for c in rs]})


def nuance(F, R):
    dp = _find(R, "direct-p")
    ap = _first(R, lambda r: r["plat"] != "direct" and r["mode"] == "p")
    if dp is None or ap is None or not ap["net"] < dp["net"]:
        return None
    why = "credit" if ap["credit"] > 0 else ("promo" if ap["disc"] > 0 else "other")
    diff = E.round2(dp["net"] - ap["net"])
    tail = {"credit": ", because your card credit works there.", "promo": ", thanks to its promo.", "other": "."}[why]
    return _ins("nuance", "Nuance", "good", "Ordering pickup in " + APP_NAME[ap["plat"]] + " beats ordering direct for pickup by "
                + money(diff) + tail, {"channel": ap["id"], "net": ap["net"], "direct": dp["net"], "diff": diff, "why": why})


def spread(F, R):
    if len(R) < 2:
        return None
    lo, hi = R[0], R[-1]
    gap = E.round2(hi["net"] - lo["net"])
    if not gap > 0:
        return None
    return _ins("spread", "Spread", "", "The same order costs " + money(lo["net"]) + " (" + lo["name"] + ") to "
                + money(hi["net"]) + " (" + hi["name"] + "): a " + money(gap) + " spread.",
                {"lo": lo["id"], "hi": hi["id"], "gap": gap})


def build(F, R, now):
    """now: (year, month0, day), or None for an invalid date."""
    if not _obj(F) or not _obj(F.get("rest")) or not isinstance(R, list) or not R:
        return []
    if F["rest"].get("profiled") is True and not isinstance(F["rest"].get("menu"), list):
        return []
    if F["rest"].get("profiled") is True and not all(_obj(it) for it in F["rest"]["menu"]):
        return []   # D-036: every menu item is an object
    ms = E.cart_info(F)["menuSub"]
    if not (_num(ms) and ms > 0):
        return []
    out = []
    for fn in (unlock, distance, fuel, minimum, wallet):
        x = fn(F, R)
        if x is not None:
            out.append(x)
    x = timing(F, R, now)
    if x is not None:
        out.append(x)
    for fn in (locked, nuance, spread):
        x = fn(F, R)
        if x is not None:
            out.append(x)
    return out
