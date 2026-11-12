"""Independent Python implementation of the pricing engine (docs/engine-contract.md, D-029).

Written by the orchestrator from the contract, never from the JS. Don't edit it to match
src/js/engine.js: when the two disagree, one of them is wrong and the orchestrator decides
which (test-runner skill).

Floating-point operations follow the contract's formulas in the same order as the JS, so
both produce the same IEEE-754 doubles. round2 reproduces POD.util.round2 exactly,
including JavaScript's Math.round tie rule (ties go toward +infinity).

Standard library only (D-017).
"""
import math

CHANNELS = ["direct-d", "direct-p", "dd-d", "dd-p", "ue-d", "ue-p", "gh-d", "gh-p"]
APPS = ("dd", "ue", "gh")
PLAT_NAME = {"direct": "Order direct", "dd": "DoorDash", "ue": "Uber Eats", "gh": "Grubhub"}
MEMBER_NAME = {"dd": "DashPass", "ue": "Uber One", "gh": "Grubhub+"}


def js_round(x):
    """JavaScript Math.round: the nearest integer, ties toward +infinity."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def round2(n):
    """POD.util.round2: half away from zero at the cent, after a +/-1e-9 nudge."""
    return js_round((n + (-1e-9 if n < 0 else 1e-9)) * 100) / 100


def _cap(x, mx):
    return min(x, mx) if (mx is not None and mx > 0) else x


def _num(v, default=0):
    return default if v is None else v


def _effective(S, override):
    """The inputs after override (contract section 1)."""
    o = override or {}
    return {
        "cart": o["cart"] if "cart" in o else S.get("cart") or {},
        "manualSubtotal": o["manualSubtotal"] if "manualSubtotal" in o else _num(S.get("manualSubtotal")),
        "miles": o["miles"] if "miles" in o else _num(S.get("miles")),
        "minutes": o["minutes"] if "minutes" in o else _num(S.get("minutes")),
    }


def _cart_lines(rest, cart):
    """[(index, qty)] for valid menu indexes, ascending by index (contract section 4)."""
    menu = rest.get("menu") or []
    out = []
    for k, q in cart.items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        if str(i) != str(k) or i < 0 or i >= len(menu):
            continue
        out.append((i, q))
    out.sort()
    return out


def cart_info(S, override=None):
    rest = S["rest"]
    eff = _effective(S, override)
    deal = rest.get("deal")
    if not rest.get("profiled"):
        menu_sub = round2(eff["manualSubtotal"])
        qty = 0
        elig = 0
        lines = []
    else:
        lines = _cart_lines(rest, eff["cart"])
        total = 0
        qty = 0
        elig = 0
        for i, q in lines:
            item = rest["menu"][i]
            total = total + item[1] * q
            qty = qty + q
            if item[2]:
                elig = elig + q
        menu_sub = round2(total)
    deal_ready = deal is not None and elig >= deal["minItems"]
    if deal_ready:
        total = 0
        for i, q in lines:
            item = rest["menu"][i]
            price = min(item[1], deal["price"]) if item[2] else item[1]
            total = total + price * q
        deal_sub = round2(total)
    else:
        deal_sub = menu_sub
    short_by = max(deal["minItems"] - elig, 0) if deal is not None else 0
    return {"menuSub": menu_sub, "dealSub": deal_sub, "qty": qty, "eligQty": elig,
            "dealReady": deal_ready, "shortBy": short_by}


def available(S, ch):
    p, m = ch.split("-")
    plats = S.get("plats") or {}
    rest = S["rest"]
    if p == "direct":
        if not (plats.get("direct") or {}).get("on"):
            return False
        return m == "p" or rest.get("directDelivery") is True
    return bool((plats.get(p) or {}).get("on")) and p in (rest.get("platforms") or [])


def per_mile(S):
    ev = S.get("fuel") == "ev"
    if ev:
        e = S["kwh"] / S["miPerKwh"] if _num(S.get("miPerKwh")) > 0 else 0
    else:
        e = S["gas"] / S["mpg"] if _num(S.get("mpg")) > 0 else 0
    return e + _num(S.get("wear"))


def calc(S, ch, override=None):
    if ch not in CHANNELS or not available(S, ch):
        return None
    p, m = ch.split("-")
    app = p != "direct"
    rest = S["rest"]
    eff = _effective(S, override)
    ci = cart_info(S, override)
    P = (S.get("plats") or {}).get(p) or {}

    # 5.1 deal
    deal = rest.get("deal")
    deal_applied = (not app) and bool(S.get("dealOn")) and ci["dealReady"] and (
        deal["scope"] == "both" or (deal["scope"] == "delivery" and m == "d")
        or (deal["scope"] == "pickup" and m == "p"))
    base = ci["dealSub"] if deal_applied else ci["menuSub"]

    # 5.2 markup
    food = round2(base * (1 + _num(P.get("markup")) / 100)) if app else base

    # 5.3 fees
    delivery = service = small = reg = dsvc = 0
    member_on = False
    if app and m == "d":
        member_on = bool(P.get("member")) and food >= _num(P.get("memberMin"))
        delivery = 0 if member_on else round2(_num(P.get("delFee")))
        rate = _num(P.get("memberSvc")) if member_on else _num(P.get("svc"))
        service = round2(max(food * rate / 100, _num(P.get("svcMin"))))
        small = round2(_num(S.get("smallFee"))) if food < _num(S.get("smallMin")) else 0
        reg = round2(_num(S.get("regFee")))
    if (not app) and m == "d":
        delivery = round2(rest["directFee"])
    ds = rest.get("directSvc")
    dsvc_on = (not app) and ds is not None and m in (ds.get("modes") or [])
    if dsvc_on:
        dsvc = round2(_cap(_num(ds.get("flat")) + food * _num(ds.get("pct")) / 100, ds.get("max")))
    fees = round2(delivery + service + small + reg + dsvc)

    # 5.4 discounts (apps only)
    promo = pick = 0
    t = "none"
    if app:
        pr = (S.get("promos") or {}).get(p) or {"type": "none"}
        t = pr.get("type") or "none"
        promo_on = t != "none" and food >= _num(pr.get("min"))
        if promo_on:
            if t == "percent":
                promo = round2(_cap(food * _num(pr.get("value")) / 100, pr.get("cap")))
            elif t == "dollar":
                promo = round2(_num(pr.get("value")))
            elif t == "freedel":
                promo = delivery if m == "d" else 0
        pick = round2(food * _num(P.get("pickDisc")) / 100) if m == "p" else 0
        promo = min(promo, food)
        pick = round2(min(pick, food - promo))
    disc = round2(promo + pick)

    # 5.5 tax, 5.6 tip
    tax_disc = (pick if t == "freedel" else disc) if app else 0
    tax = round2((food - tax_disc) * _num(S.get("tax")) / 100)
    tip = round2(food * _num(S.get("tipDel") if m == "d" else S.get("tipPick")) / 100)

    # 5.7 drive
    ev = S.get("fuel") == "ev"
    energy = wear_c = time_c = drive = 0
    if m == "p":
        miles = eff["miles"]
        if ev:
            energy = round2(miles / S["miPerKwh"] * S["kwh"]) if _num(S.get("miPerKwh")) > 0 else 0
        else:
            energy = round2(miles / S["mpg"] * S["gas"]) if _num(S.get("mpg")) > 0 else 0
        wear_c = round2(miles * _num(S.get("wear")))
        time_c = round2(_num(S.get("hourly")) * eff["minutes"] / 60)
        drive = round2(energy + wear_c + time_c)

    # 5.8 gross
    gross = round2(food + fees + tax + tip + drive)

    # 5.9 credits
    opt = S.get("creditOptIn") or {}
    total = 0
    for c in S.get("credits") or []:
        if c.get("locked") or c.get("used"):
            continue
        if c.get("restricted") and not opt.get(c.get("key")):
            continue
        plats = c.get("plats") or []
        if not (p in plats or (p == "direct" and c.get("goldPartner") and rest.get("amexGoldDirect"))):
            continue
        modes = c.get("modes")
        if modes is not None and m not in modes:
            continue
        total = total + c["amount"]
    credit = round2(min(total, max(gross - disc, 0)))

    # 5.10 net
    net = max(round2(gross - disc - credit), 0)
    off = round2(disc + credit)

    # 6 result
    lines = [["Food", food]]
    if m == "d":
        lines.append(["Delivery fee", delivery])
    if app and m == "d":
        lines.append(["Service fee", service])
    if dsvc_on:
        lines.append(["Service fee", dsvc])
    if small > 0:
        lines.append(["Small-order fee", small])
    if reg > 0:
        lines.append(["Regulatory fee", reg])
    lines.append(["Tax", tax])
    if tip > 0:
        lines.append(["Tip", tip])
    if m == "p":
        lines.append(["Charging" if ev else "Gas", energy])
        if wear_c > 0:
            lines.append(["Wear", wear_c])
        if time_c > 0:
            lines.append(["Time", time_c])
    if promo > 0:
        lines.append(["Promo", round2(-promo)])
    if pick > 0:
        lines.append(["Pickup discount", round2(-pick)])
    if credit > 0:
        lines.append(["Card credits", round2(-credit)])
    lines.append(["TOTAL", net])

    notes = []
    if deal_applied:
        notes.append("Deal: " + deal["label"])
    if not rest.get("profiled"):
        notes.append("Estimate")

    return {
        "id": ch, "plat": p, "mode": m,
        "name": PLAT_NAME[p] + " · " + ("delivery" if m == "d" else "pickup"),
        "parts": {"food": food, "fees": fees, "tax": tax, "tip": tip, "drive": drive},
        "gross": gross, "net": net, "disc": disc, "credit": credit, "off": off,
        "lines": lines, "notes": notes,
        "member": MEMBER_NAME[p] if member_on else None,
    }


def all_results(S, override=None):
    out = []
    for idx, ch in enumerate(CHANNELS):
        r = calc(S, ch, override)
        if r is not None:
            out.append((r["net"], idx, r))
    out.sort(key=lambda t: (t[0], t[1]))
    return [t[2] for t in out]


def rest_for(brand_id, D):
    brands = D.get("BRANDS") or {}
    profiles = D.get("PROFILES") or {}
    b = brands.get(brand_id)
    prof = profiles.get(brand_id)
    if b is None and prof is None:
        return None
    name = b["name"] if b is not None else brand_id
    if prof is not None:
        r = {"id": brand_id, "name": name, "profiled": True, "menu": prof["menu"], "deal": prof["deal"],
             "directDelivery": prof["directDelivery"], "directSvc": prof.get("directSvc"),
             "amexGoldDirect": prof["amexGoldDirect"], "platforms": prof["platforms"],
             "markup": prof["markup"], "markupEst": prof["markupEst"]}
        if prof["directDelivery"]:
            r["directFee"] = prof["directFee"]
        return r
    cat = (D.get("CATEGORY_DEFAULTS") or {})[b["category"]]
    return {"id": brand_id, "name": name, "profiled": False, "menu": [], "deal": None,
            "directDelivery": False, "directSvc": None, "amexGoldDirect": False,
            "platforms": ["dd", "ue", "gh"], "markup": cat["markup"], "markupEst": True}
