"""Build src/data/profiles.js and src/data/categories.js from hand-entered evidence (D-027).

Inputs (hand-entered, with evidence):
  tools/data/profiles/<brandId>.json   one file per profiled chain (D-026)
  tools/data/categories.json           category defaults (D-021 categories)

Every menu price and direct-delivery fee is the MEDIAN of observations taken at
stores in different states; this script computes it, so no final number is typed
by hand. It validates every rule in D-027 and exits non-zero on the first problem.

Usage:
  python3 -I tools/build-profiles.py --as-of YYYY-MM-DD \
      [--profiles-dir tools/data/profiles] [--categories tools/data/categories.json] \
      [--brands src/data/brands.js] \
      [--out-profiles src/data/profiles.js] [--out-categories src/data/categories.js]

Stdlib only. Output is deterministic (sorted keys, no timestamps beyond --as-of).
"""
import argparse
import decimal
import json
import os
import re
import sys

PLATS = ("dd", "ue", "gh")
SCOPES = ("both", "pickup", "delivery")
GOLD = {"five_guys", "buffalo_wild_wings", "the_cheesecake_factory"}
PROFILED = ["dominos", "taco_bell", "chipotle", "papa_johns", "wingstop", "pizza_hut",
            "five_guys", "buffalo_wild_wings", "little_caesars", "the_cheesecake_factory",
            "subway", "dunkin"]  # D-026
CATEGORIES = ["pizza", "burger", "chicken", "mexican", "sandwich", "asian", "coffee",
              "dessert", "casual", "other"]  # D-021
URL_RE = re.compile(r"https://[A-Za-z0-9.-]+(/[^\s*]*)?\Z")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
ZIP_RE = re.compile(r"\d{5}\Z")
STATE_RE = re.compile(r"[A-Z]{2}\Z")


class Bad(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Bad(msg)


def money(x):
    """Round half up to the cent (D-012 style), returning a float with 2 decimals."""
    d = decimal.Decimal(str(x)).quantize(decimal.Decimal("0.01"), rounding=decimal.ROUND_HALF_UP)
    return float(d)


def median(values):
    v = sorted(decimal.Decimal(str(x)) for x in values)
    n = len(v)
    mid = v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
    return money(mid)


def check_obs(obs, key, where):
    need(isinstance(obs, list) and len(obs) >= 2, "%s: needs >= 2 observations" % where)
    states = set()
    for o in obs:
        need(isinstance(o, dict), "%s: observation must be an object" % where)
        need(ZIP_RE.match(str(o.get("zip", ""))), "%s: bad zip %r" % (where, o.get("zip")))
        need(STATE_RE.match(str(o.get("state", ""))), "%s: bad state %r" % (where, o.get("state")))
        val = o.get(key)
        need(isinstance(val, (int, float)) and not isinstance(val, bool) and 0 < val < 200,
             "%s: bad %s %r" % (where, key, val))
        need(isinstance(o.get("url"), str) and URL_RE.match(o["url"]), "%s: bad url %r" % (where, o.get("url")))
        states.add(o["state"])
    need(len(states) >= 2, "%s: observations must span >= 2 states" % where)
    return median([o[key] for o in obs])


def brand_info(path):
    """{brandId: category} for every id in BRAND_IDS."""
    text = open(path, encoding="utf-8").read()
    m = re.search(r"BRAND_IDS\s*=\s*\[(.*?)\]", text, re.S)
    need(m, "%s: BRAND_IDS not found" % path)
    ids = set(re.findall(r'"([a-z0-9_]+)"', m.group(1)))
    cats = dict(re.findall(r'"([a-z0-9_]+)":\s*\{"name":\s*"(?:[^"\\]|\\.)*",\s*"category":\s*"([a-z]+)"', text))
    return {i: cats.get(i) for i in ids}


def item_markup(pid, name, m, plats):
    """D-036: an optional per-item markup, sourced, for platforms the chain is listed on. Never estimated."""
    where = "%s menu %r markup" % (pid, name)
    need(isinstance(m, dict), "%s must be an object" % where)
    for k in m:
        need(k in PLATS or k == "source", "%s: key %r is not dd, ue, gh or source" % (where, k))
    keys = [k for k in PLATS if k in m]
    need(keys, "%s has no platform key (dd, ue or gh)" % where)
    for k in keys:
        need(k in plats, "%s: platform %s is not listed in platforms" % (where, k))
        v = m[k]
        need(isinstance(v, (int, float)) and not isinstance(v, bool), "%s.%s must be a number, got %r" % (where, k, v))
        need(0 <= v <= 60, "%s.%s out of range 0-60: %r" % (where, k, v))
    need(isinstance(m.get("source"), str) and URL_RE.match(m["source"]), "%s needs a source url" % where)
    return {k: m[k] for k in PLATS if k in m}


def build_profile(raw, ids, cat_markup):
    pid = raw.get("id")
    need(pid in PROFILED, "profile id %r is not one of the D-026 chains" % pid)
    need(pid in ids, "%s: not in BRAND_IDS" % pid)
    need(DATE_RE.match(str(raw.get("asOf", ""))), "%s: bad asOf" % pid)
    menu = raw.get("menu")
    need(isinstance(menu, list) and 5 <= len(menu) <= 10, "%s: menu needs 5-10 items" % pid)
    plats = raw.get("platforms") or {}
    need(isinstance(plats, dict), "%s: platforms must be an object" % pid)
    out_menu, names = [], set()
    for i, item in enumerate(menu):
        name = item.get("name")
        need(isinstance(name, str) and name.strip() and name not in names, "%s: menu[%d] bad or duplicate name" % (pid, i))
        names.add(name)
        need(isinstance(item.get("dealItem"), bool), "%s: %s dealItem must be true/false" % (pid, name))
        price = check_obs(item.get("prices"), "price", "%s menu %r" % (pid, name))
        out_item = {"name": name, "price": price, "dealItem": item["dealItem"]}
        if "markup" in item:
            out_item["markup"] = item_markup(pid, name, item["markup"], plats)
        out_menu.append(out_item)
    deal = raw.get("deal")
    out_deal = None
    if deal is not None:
        need(isinstance(deal.get("label"), str) and deal["label"].strip(), "%s: deal label" % pid)
        need(isinstance(deal.get("price"), (int, float)) and deal["price"] > 0, "%s: deal price" % pid)
        need(isinstance(deal.get("minItems"), int) and deal["minItems"] >= 1, "%s: deal minItems" % pid)
        need(deal.get("scope") in SCOPES, "%s: deal scope" % pid)
        need(isinstance(deal.get("url"), str) and URL_RE.match(deal["url"]), "%s: deal url" % pid)
        need(isinstance(deal.get("terms"), str) and deal["terms"].strip(), "%s: deal terms" % pid)
        need(any(m["dealItem"] for m in out_menu), "%s: a deal needs at least one dealItem on the menu" % pid)
        out_deal = {"label": deal["label"], "price": money(deal["price"]),
                    "minItems": deal["minItems"], "scope": deal["scope"]}
    else:
        need(not any(m["dealItem"] for m in out_menu), "%s: dealItem set but no deal" % pid)
    dd = raw.get("directDelivery")
    need(isinstance(dd, bool), "%s: directDelivery must be true/false" % pid)
    out = {"menu": out_menu, "deal": out_deal, "directDelivery": dd}
    if dd:
        fee = check_obs((raw.get("directFee") or {}).get("observed"), "fee", "%s directFee" % pid)
        need(fee > 0, "%s: directFee must be > 0 (BUILD.md 9.3)" % pid)
        out["directFee"] = fee
    else:
        need(raw.get("directFee") in (None, {}), "%s: directFee given but directDelivery is false" % pid)
    need(set(plats) <= set(PLATS), "%s: platforms keys must be dd/ue/gh" % pid)
    for k, ev in plats.items():
        # Evidence must cite a source someone can re-read, not just describe one (review of 1.7).
        need(isinstance(ev, str) and ev.strip(), "%s: platform %s needs evidence" % (pid, k))
        need(re.search(r"https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}", ev) is not None, "%s: platform %s evidence needs an https URL" % (pid, k))
    markup = raw.get("markup") or {}
    if markup.get("useCategory"):
        # D-027: no chain-specific source, so the chain's category default (an estimate) is used.
        cat = ids.get(pid)
        need(cat in cat_markup, "%s: useCategory but no default for category %r (categories.json missing?)" % (pid, cat))
        markup = dict((k, cat_markup[cat][k]) for k in plats)
        markup.update({"est": True, "reason": "category default for %s" % cat})
    need(set(k for k in markup if k in PLATS) == set(plats), "%s: markup must cover exactly the listed platforms" % pid)
    for k in plats:
        need(isinstance(markup[k], (int, float)) and 0 <= markup[k] <= 60, "%s: markup.%s out of range" % (pid, k))
    est = markup.get("est", False)
    need(isinstance(est, bool), "%s: markup.est must be true/false" % pid)
    if plats:
        if est:
            need(isinstance(markup.get("reason"), str) and markup["reason"].strip(), "%s: est markup needs a reason" % pid)
        else:
            need(isinstance(markup.get("source"), str) and URL_RE.match(markup["source"]), "%s: markup needs a source url" % pid)
    gold = raw.get("amexGoldDirect")
    need(isinstance(gold, bool) and gold == (pid in GOLD), "%s: amexGoldDirect must be %s (BUILD.md 12)" % (pid, pid in GOLD))
    out.update({"markup": {k: markup[k] for k in PLATS if k in plats}, "markupEst": est,
                "amexGoldDirect": gold, "platforms": [k for k in PLATS if k in plats]})
    return pid, out


def build_categories(raw):
    need(isinstance(raw, dict) and sorted(raw) == sorted(CATEGORIES), "categories.json must have exactly the 10 D-021 categories")
    out = {}
    for c in CATEGORIES:
        v = raw[c]
        m = v.get("markup") or {}
        need(sorted(m) == sorted(PLATS), "category %s: markup needs dd, ue, gh" % c)
        for k in PLATS:
            need(isinstance(m[k], (int, float)) and 0 <= m[k] <= 60, "category %s: markup.%s out of range" % (c, k))
        need(isinstance(v.get("est"), bool), "category %s: est must be true/false" % c)
        need(isinstance(v.get("reason"), str) and v["reason"].strip(), "category %s: needs a reason" % c)
        srcs = v.get("sources") or []
        need(isinstance(srcs, list) and all(isinstance(u, str) and URL_RE.match(u) for u in srcs), "category %s: bad sources" % c)
        need(v["est"] or srcs, "category %s: a non-estimate needs a source" % c)
        out[c] = {"markup": {k: m[k] for k in PLATS}, "est": v["est"]}
    return out


def js(header_lines, name, value):
    body = json.dumps(value, sort_keys=True, ensure_ascii=True, indent=2)
    head = "/*\n" + "".join(" * %s\n" % l for l in header_lines) + " */\n"
    return (head + '(function (root) {\n  "use strict";\n  root.POD.data.%s = %s;\n})'
            '(typeof window !== "undefined" ? window : this);\n') % (name, body.replace("\n", "\n  "))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", required=True)
    ap.add_argument("--profiles-dir", default="tools/data/profiles")
    ap.add_argument("--categories", default="tools/data/categories.json")
    ap.add_argument("--brands", default="src/data/brands.js")
    ap.add_argument("--out-profiles", default="src/data/profiles.js")
    ap.add_argument("--out-categories", default="src/data/categories.js")
    a = ap.parse_args()
    need(DATE_RE.match(a.as_of), "--as-of must be YYYY-MM-DD")
    ids = brand_info(a.brands)
    cats, cat_raw = None, None
    if os.path.exists(a.categories):
        cat_raw = json.load(open(a.categories, encoding="utf-8"))
        cats = build_categories(cat_raw)
    cat_markup = dict((c, v["markup"]) for c, v in (cats or {}).items())

    profiles, est_ids = {}, []
    files = sorted(f for f in os.listdir(a.profiles_dir) if f.endswith(".json")) if os.path.isdir(a.profiles_dir) else []
    for f in files:
        raw = json.load(open(os.path.join(a.profiles_dir, f), encoding="utf-8"))
        need(f == "%s.json" % raw.get("id"), "%s: file name must be <id>.json" % f)
        pid, prof = build_profile(raw, ids, cat_markup)
        profiles[pid] = prof
        if prof["markupEst"]:
            est_ids.append(pid)
    missing = [p for p in PROFILED if p not in profiles]
    hdr = ["profiles: menus, direct-only deals, fees and app markups for the D-026 chains (D-027)",
           "Source:  per-chain evidence in tools/data/profiles/<id>.json: each chain's own ordering site",
           "         (store pickup prices at 2-3 stores in different states, with ZIP and URL), its deal page,",
           "         and cited markup reporting",
           "As of:   %s" % a.as_of,
           "Method:  generated by tools/build-profiles.py (menu prices and fees are medians of the observations)",
           "Nulls:   deal is null (no direct-only offer confirmed) for: %s. Chains not yet profiled: %s"
           % (", ".join(sorted(k for k in profiles if profiles[k]["deal"] is None)) or "none", ", ".join(missing) or "none"),
           "Est:     markup est: true (category default) for: %s" % (", ".join(est_ids) or "none")]
    with open(a.out_profiles, "w", encoding="utf-8") as fh:
        fh.write(js(hdr, "PROFILES", profiles))
    print("profiles: %d written (%s); missing: %s" % (len(profiles), ", ".join(sorted(profiles)), ", ".join(missing) or "none"))

    if cats is not None:
        raw = cat_raw
        srcs = sorted({u for c in CATEGORIES for u in raw[c].get("sources", [])})
        est_c = [c for c in CATEGORIES if cats[c]["est"]]
        hdr = ["categories: default app markups per restaurant category, for unprofiled brands (D-006, D-027)",
               "Source:  %s" % ("; ".join(srcs) if srcs else "none (all estimates)"),
               "         reasons per category in tools/data/categories.json",
               "As of:   %s" % a.as_of,
               "Method:  hand-entered in tools/data/categories.json, generated by tools/build-profiles.py",
               "Nulls:   none",
               "Est:     est: true for: %s" % (", ".join(est_c) or "none")]
        with open(a.out_categories, "w", encoding="utf-8") as fh:
            fh.write(js(hdr, "CATEGORY_DEFAULTS", cats))
        print("categories: %d written; est: %s" % (len(cats), ", ".join(est_c) or "none"))
    else:
        print("categories: %s not found, skipped" % a.categories)


if __name__ == "__main__":
    try:
        main()
    except Bad as e:
        print("build-profiles: " + str(e), file=sys.stderr)
        sys.exit(1)
