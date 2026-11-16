"""links.py: the Python reference for POD.links (docs/links-contract.md, D-041).

Written from the contract by the orchestrator, independently of src/js/links.js. Standard library
only (D-017). Every property read is a dict lookup, which is what the contract's "own properties
only" rule makes the JS do.

    for_channel(ch, S, D) -> [{"kind", "label", "href"}]
"""

from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import quote
import math

CHANNELS = ("direct-d", "direct-p", "dd-d", "dd-p", "ue-d", "ue-p", "gh-d", "gh-p")
APP = {"dd": "DoorDash", "ue": "Uber Eats", "gh": "Grubhub"}


def is_obj(x):
    return isinstance(x, dict)


def is_str(x):
    return isinstance(x, str)


def non_empty(x):
    return is_str(x) and x != ""


def fin(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def enc(s):
    """encodeURIComponent: unescaped A-Z a-z 0-9 - _ . ! ~ * ' ( ); UTF-8 %XX upper case.
    A lone surrogate throws URIError in JS; here encoding to UTF-8 raises, and both give None."""
    try:
        return quote(s, safe="-_.!~*'()", encoding="utf-8", errors="strict")
    except UnicodeEncodeError:
        return None


def fill(t, key, v):
    return t.replace(key, v)


def https(h):
    return is_str(h) and h.startswith("https://")


def fix5(x):
    """Number.prototype.toFixed(5): the exact binary value, an exact tie to the larger digits,
    a minus sign only when x < 0 (so -0 gives "0.00000" and -0.000001 gives "-0.00000")."""
    d = Decimal(abs(x)).quantize(Decimal("0.00001"), rounding=ROUND_HALF_UP)
    return ("-" if x < 0 else "") + format(d, "f")


def get(o, k):
    return o[k] if is_obj(o) and k in o else None


def for_channel(ch, S, D):
    # 1. guards
    if not is_str(ch) or ch not in CHANNELS or not is_obj(S) or not is_obj(D):
        return []
    L = get(D, "LINKS")
    if not is_obj(L):
        return []
    brand = get(S, "brand")
    rest = get(S, "rest")
    if not is_str(brand) or not is_obj(rest) or not non_empty(get(rest, "name")):
        return []
    name = rest["name"]
    # 2.
    p, m = ch.split("-")
    # 3. an app
    if p in APP:
        a = get(get(L, "apps"), p)
        if not is_obj(a):
            return []
        search = get(a, "search")
        if is_str(search) and "{q}" in search:
            q = enc(name)
            if q is not None:
                h = fill(search, "{q}", q)
                if https(h):
                    return [{"kind": "search", "label": "Search " + APP[p] + " for " + name, "href": h}]
        home = get(a, "home")
        if https(home):
            return [{"kind": "app", "label": "Open " + APP[p], "href": home}]
        return []
    # 4. ordering direct
    out = []
    o = get(get(L, "order"), brand)
    if is_obj(o) and https(get(o, "url")):
        out.append({"kind": "order", "label": "Order from " + name, "href": o["url"]})
    if m == "p":
        mp = get(L, "maps")
        if is_obj(mp) and non_empty(get(mp, "name")):
            link = _dir_link(S, brand, mp) or _map_search(name, mp)
            if link:
                out.append(link)
    return out


def _dir_link(S, brand, mp):
    st = get(S, "store")
    if not is_obj(st):
        return None
    sid, lat, lon = get(st, "id"), get(st, "lat"), get(st, "lon")
    if not is_str(sid) or not sid.startswith(brand + "@"):
        return None
    if not fin(lat) or not fin(lon) or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return None
    t = get(mp, "dir")
    if not is_str(t) or "{lat}" not in t or "{lon}" not in t:
        return None
    h = fill(fill(t, "{lat}", fix5(lat)), "{lon}", fix5(lon))
    if not https(h):
        return None
    return {"kind": "dir", "label": "Directions in " + mp["name"], "href": h}


def _map_search(name, mp):
    t = get(mp, "search")
    if not is_str(t) or "{q}" not in t:
        return None
    q = enc(name)
    if q is None:
        return None
    h = fill(t, "{q}", q)
    if not https(h):
        return None
    return {"kind": "map", "label": "Find " + name + " in " + mp["name"], "href": h}


def call(fn, args):
    if fn == "forChannel":
        return for_channel(*args)
    raise ValueError("unknown fn " + str(fn))
