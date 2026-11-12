#!/usr/bin/env python3
"""Build src/data/states.js: STATES rows and GRADE_ADD (D-022, BUILD.md §6).

Gas: EIA weekly retail prices (www.eia.gov), latest week on the U.S. regular
series. Each state uses its own EIA series when one exists, otherwise its PADD
(or PADD 1 sub-region) series. PADD definitions: EIA glossary (https://www.eia.gov/tools/glossary/index.php?id=Petroleum%20Administration%20for%20Defense%20District).

Tax: tools/data/state-tax.csv (hand-entered from source; see its source_url and
note columns). This script merges it, it does not invent any rate.

Usage (stdlib only, run with -I):
  python3 -I tools/build-states.py --as-of 2026-11-12 --cache DIR \
      --tax tools/data/state-tax.csv --out src/data/states.js

Downloads go into --cache and are reused on re-runs, so output is byte-identical.
A series that can't be fetched or parsed gives null, and the header says so.
"""

import argparse
import csv
import html
import os
import re
import sys
import urllib.error
import urllib.request
from decimal import Decimal, ROUND_HALF_UP

EIA_HIST = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s={sid}&f=W"
EIA_PAGE = "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm"
EIA_PADD_GLOSSARY = "https://www.eia.gov/tools/glossary/index.php?id=Petroleum%20Administration%20for%20Defense%20District"
TAX_SOURCE = "https://taxfoundation.org/data/all/state/2026-sales-tax-rates-midyear/"
USER_AGENT = "pod-data-builder/1.0"

# Grade series (U.S., weekly, dollars per gallon).
US_SERIES = {
    "regular": ("EMM_EPMR_PTE_NUS_DPG", "U.S. Regular"),
    "midgrade": ("EMM_EPMM_PTE_NUS_DPG", "U.S. Midgrade"),
    "premium": ("EMM_EPMP_PTE_NUS_DPG", "U.S. Premium"),
    "diesel": ("EMD_EPD2D_PTE_NUS_DPG", "Diesel"),
}

# Regional regular-gas series. Key -> (series id, expected title fragment, label).
REGION_SERIES = {
    "1A": ("EMM_EPMR_PTE_R1X_DPG", "New England (PADD 1A)", "PADD 1A New England"),
    "1B": ("EMM_EPMR_PTE_R1Y_DPG", "Central Atlantic (PADD 1B)", "PADD 1B Central Atlantic"),
    "1C": ("EMM_EPMR_PTE_R1Z_DPG", "Lower Atlantic (PADD 1C)", "PADD 1C Lower Atlantic"),
    "2": ("EMM_EPMR_PTE_R20_DPG", "Midwest", "PADD 2 Midwest"),
    "3": ("EMM_EPMR_PTE_R30_DPG", "Gulf Coast", "PADD 3 Gulf Coast"),
    "4": ("EMM_EPMR_PTE_R40_DPG", "Rocky Mountain", "PADD 4 Rocky Mountain"),
    # PADD 5 except California, for the PADD 5 states with no series of their own (D-022).
    "5X": ("EMM_EPMR_PTE_R5XCA_DPG", "Except California", "PADD 5 West Coast except California"),
}

# State series EIA publishes (regular gas). Code -> (series id, title fragment).
STATE_SERIES = {
    "CA": ("EMM_EPMR_PTE_SCA_DPG", "California"),
    "CO": ("EMM_EPMR_PTE_SCO_DPG", "Colorado"),
    "FL": ("EMM_EPMR_PTE_SFL_DPG", "Florida"),
    "MA": ("EMM_EPMR_PTE_SMA_DPG", "Massachusetts"),
    "MN": ("EMM_EPMR_PTE_SMN_DPG", "Minnesota"),
    "NY": ("EMM_EPMR_PTE_SNY_DPG", "New York"),
    "OH": ("EMM_EPMR_PTE_SOH_DPG", "Ohio"),
    "TX": ("EMM_EPMR_PTE_STX_DPG", "Texas"),
    "WA": ("EMM_EPMR_PTE_SWA_DPG", "Washington"),
}

# All 51 rows. code, name, and the region key used when there is no state series.
# PADD membership follows EIA's PADD definitions, EIA glossary: EIA_PADD_GLOSSARY
# (1A = CT ME MA NH RI VT; 1B = DE DC MD NJ NY PA; 1C = FL GA NC SC VA WV; 2 = IL IN IA KS KY
# MI MN MO NE ND OH OK SD TN WI; 3 = AL AR LA MS NM TX; 4 = CO ID MT UT WY; 5 = AK AZ CA HI NV OR WA). PADD 5 states with no
# series of their own (AK, AZ, HI, NV, OR) use "West Coast (PADD 5) Except California" (5X).
STATES = [
    ("AL", "Alabama", "3"), ("AK", "Alaska", "5X"), ("AZ", "Arizona", "5X"),
    ("AR", "Arkansas", "3"), ("CA", "California", None), ("CO", "Colorado", None),
    ("CT", "Connecticut", "1A"), ("DE", "Delaware", "1B"), ("DC", "District of Columbia", "1B"),
    ("FL", "Florida", None), ("GA", "Georgia", "1C"), ("HI", "Hawaii", "5X"),
    ("ID", "Idaho", "4"), ("IL", "Illinois", "2"), ("IN", "Indiana", "2"),
    ("IA", "Iowa", "2"), ("KS", "Kansas", "2"), ("KY", "Kentucky", "2"),
    ("LA", "Louisiana", "3"), ("ME", "Maine", "1A"), ("MD", "Maryland", "1B"),
    ("MA", "Massachusetts", None), ("MI", "Michigan", "2"), ("MN", "Minnesota", None),
    ("MS", "Mississippi", "3"), ("MO", "Missouri", "2"), ("MT", "Montana", "4"),
    ("NE", "Nebraska", "2"), ("NV", "Nevada", "5X"), ("NH", "New Hampshire", "1A"),
    ("NJ", "New Jersey", "1B"), ("NM", "New Mexico", "3"), ("NY", "New York", None),
    ("NC", "North Carolina", "1C"), ("ND", "North Dakota", "2"), ("OH", "Ohio", None),
    ("OK", "Oklahoma", "2"), ("OR", "Oregon", "5X"), ("PA", "Pennsylvania", "1B"),
    ("RI", "Rhode Island", "1A"), ("SC", "South Carolina", "1C"), ("SD", "South Dakota", "2"),
    ("TN", "Tennessee", "2"), ("TX", "Texas", None), ("UT", "Utah", "4"),
    ("VT", "Vermont", "1A"), ("VA", "Virginia", "1C"), ("WA", "Washington", None),
    ("WV", "West Virginia", "1C"), ("WI", "Wisconsin", "2"), ("WY", "Wyoming", "4"),
]

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def fetch(sid, cache_dir):
    """Return the EIA history HTML for a series, from cache or the network."""
    path = os.path.join(cache_dir, "eia_%s.htm" % sid)
    if not os.path.exists(path):
        req = urllib.request.Request(EIA_HIST.format(sid=sid), headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read()
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
    with open(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def title_of(doc):
    m = re.search(r"<title>(.*?)</title>", doc, re.S)
    return html.unescape(m.group(1)).strip() if m else ""


def parse_series(doc):
    """Return {iso_date: value_string} from the EIA history table.

    Each data row is 'YYYY-Mon' followed by (end date MM/DD, value) pairs.
    Empty cells and EIA codes (-, NA, W) are skipped.
    """
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", doc, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0", " ").strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if not cells:
            continue
        m = re.match(r"^(\d{4})-([A-Za-z]{3})$", cells[0])
        if not m or m.group(2) not in MONTHS:
            continue
        year = int(m.group(1))
        rest = cells[1:]
        for k in range(0, len(rest) - 1, 2):
            d, v = rest[k], rest[k + 1]
            dm = re.match(r"^(\d{2})/(\d{2})$", d)
            if not dm or not re.match(r"^\d+\.\d+$", v):
                continue
            iso = "%04d-%02d-%02d" % (year, int(dm.group(1)), int(dm.group(2)))
            out[iso] = v
    return out


def load_series(sid, expect, cache_dir, problems):
    """Fetch and parse one series. Returns (title_ok, {date: value}) or None on failure."""
    try:
        doc = fetch(sid, cache_dir)
    except (urllib.error.URLError, OSError) as exc:
        problems.append("%s: fetch failed (%s)" % (sid, exc))
        return None
    title = title_of(doc)
    if expect not in title:
        problems.append("%s: title %r does not contain %r" % (sid, title, expect))
        return None
    data = parse_series(doc)
    if not data:
        problems.append("%s: no data rows parsed" % sid)
        return None
    return data


def dec2(text):
    return Decimal(text).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def read_tax(path):
    """Return {code: (taxPct_string_or_None, kind, source_url, as_of, note)}."""
    rows = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            code = r["code"].strip()
            if code in rows:
                raise SystemExit("duplicate tax row %s" % code)
            pct = r["taxPct"].strip()
            if pct == "":
                pct = None
            else:
                float(pct)  # must parse as a number
            if r["kind"] not in ("meal", "combined"):
                raise SystemExit("bad kind for %s: %s" % (code, r["kind"]))
            rows[code] = (pct, r["kind"], r["source_url"].strip(), r["as_of"].strip(), r["note"].strip())
    return rows


def js_num(text):
    return "null" if text is None else text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--tax", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    os.makedirs(args.cache, exist_ok=True)
    problems = []

    # 1. Latest week, from the U.S. regular series.
    us = {}
    for key, (sid, expect) in US_SERIES.items():
        us[key] = load_series(sid, expect, args.cache, problems)
    if us["regular"] is None:
        print("FATAL: U.S. regular series unavailable", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1
    week = max(us["regular"])

    # 2. Values for that week only. A series without that week is null, never an older week.
    def value_at(data):
        return None if data is None else data.get(week)

    us_val = {k: value_at(v) for k, v in us.items()}
    for key in US_SERIES:
        if us_val[key] is None:
            problems.append("%s: no value for week %s" % (US_SERIES[key][0], week))

    region_val = {}
    region_label = {}
    for key, (sid, expect, label) in REGION_SERIES.items():
        data = load_series(sid, expect, args.cache, problems)
        region_val[key] = value_at(data)
        region_label[key] = label
        if region_val[key] is None and data is not None:
            problems.append("%s: no value for week %s" % (sid, week))

    state_val = {}
    for code, (sid, expect) in STATE_SERIES.items():
        data = load_series(sid, expect, args.cache, problems)
        state_val[code] = value_at(data)
        if state_val[code] is None and data is not None:
            problems.append("%s: no value for week %s" % (sid, week))

    # 3. Tax.
    tax = read_tax(args.tax)
    codes = [c for c, _, _ in STATES]
    if sorted(codes) != sorted(tax.keys()) or len(set(codes)) != 51:
        raise SystemExit("tax CSV codes do not match the 51 STATES rows")

    # 4. GRADE_ADD = U.S. grade minus U.S. regular, same week, cents.
    grade_add = {}
    for key in ("midgrade", "premium", "diesel"):
        if us_val[key] is None or us_val["regular"] is None:
            grade_add[key] = None
        else:
            grade_add[key] = (Decimal(us_val[key]) - Decimal(us_val["regular"])).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP)

    # 5. Rows.
    lines = []
    gas_nulls = []
    tax_nulls = []
    padd_counts = {}
    for code, name, region in STATES:
        if code in STATE_SERIES:
            sid = STATE_SERIES[code][0]
            gas = state_val[code]
            label = "EIA %s (%s state series)" % (sid, name)
        else:
            sid = REGION_SERIES[region][0]
            gas = region_val[region]
            label = "EIA %s (%s)" % (sid, region_label[region])
        padd_counts[region or code] = padd_counts.get(region or code, 0) + 1
        if gas is None:
            gas_nulls.append(code)
        pct, kind, _, _, _ = tax[code]
        if pct is None:
            tax_nulls.append(code)
        lines.append('    ["%s", "%s", %s, %s], // gas: %s; tax: %s' % (
            code, name, js_num(gas), js_num(pct), label, kind))

    # 6. Provenance header.
    null_bits = []
    if gas_nulls:
        null_bits.append("gasRegular null for %s (EIA series missing for week %s)" % (", ".join(gas_nulls), week))
    if tax_nulls:
        null_bits.append("mealTaxPct null for %s (no sourced rate; see tools/data/state-tax.csv note and docs/issues.md)" % ", ".join(tax_nulls))
    if any(v is None for v in grade_add.values()):
        null_bits.append("GRADE_ADD has null values (U.S. series missing)")
    nulls = "; ".join(null_bits) if null_bits else "none"

    header = (
        "/*\n"
        " * states: 50 states + DC, regular gas (EIA weekly) and sales/meal tax; GRADE_ADD spreads.\n"
        " * Source:  U.S. EIA weekly retail gasoline and diesel prices, week ending %s, %s\n"
        " *          (series: %s, %s, %s, %s; state, PADD and PADD 5 except-California series per row)\n"
        " *          PADD definitions: %s\n"
        " *          Sales tax: Tax Foundation, State and Local Sales Tax Rates, midyear 2026 published combined rates, %s\n"
        " *          Meal tax: NH https://www.revenue.nh.gov/taxes-glance/meals-rooms-rentals-tax ; VT https://tax.vermont.gov/data-and-stats/mrt ;\n"
        " *          DC https://otr.cfo.dc.gov/page/taxable-and-non-taxable-services\n"
        " *          NH, VT and DC meal rates were read from web search results on the official domains,\n"
        " *          because those sites refuse automated requests (docs/issues.md ISS-010)\n"
        " * As of:   %s (run date); EIA week %s; Tax Foundation rates as of 2026-07-01\n"
        " * Method:  generated by tools/build-states.py from EIA + tools/data/state-tax.csv (hand-entered)\n"
        " * Nulls:   %s\n"
        " * Est:     none\n"
        " */\n"
    ) % (week, EIA_PAGE, US_SERIES["regular"][0], US_SERIES["midgrade"][0],
         US_SERIES["premium"][0], US_SERIES["diesel"][0], EIA_PADD_GLOSSARY, TAX_SOURCE,
         args.as_of, week, nulls)

    body = (
        "(function (root) {\n"
        '  "use strict";\n'
        "  // Rows: [code, name, gasRegular, mealTaxPct], sorted by code.\n"
        "  // Gas: EIA regular, week %s. mealTaxPct: combined state+local (Tax Foundation) or meal rate.\n"
        "  root.POD.data.STATES = [\n"
        "%s\n"
        "  ];\n"
        "  // Grade spreads: U.S. grade minus U.S. regular, EIA week %s, rounded to cents.\n"
        "  root.POD.data.GRADE_ADD = {\n"
        "    midgrade: %s, // EMM_EPMM_PTE_NUS_DPG - EMM_EPMR_PTE_NUS_DPG\n"
        "    premium: %s, // EMM_EPMP_PTE_NUS_DPG - EMM_EPMR_PTE_NUS_DPG\n"
        "    diesel: %s // EMD_EPD2D_PTE_NUS_DPG - EMM_EPMR_PTE_NUS_DPG\n"
        "  };\n"
        "})(typeof window !== \"undefined\" ? window : this);\n"
    )
    rows_sorted = sorted(zip(codes, lines), key=lambda x: x[0])
    body = body % (week, "\n".join(l for _, l in rows_sorted), week,
                   js_num(str(grade_add["midgrade"]) if grade_add["midgrade"] is not None else None),
                   js_num(str(grade_add["premium"]) if grade_add["premium"] is not None else None),
                   js_num(str(grade_add["diesel"]) if grade_add["diesel"] is not None else None))

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + body)

    print("week: %s" % week)
    print("rows: %d" % len(lines))
    print("gas nulls: %d (%s)" % (len(gas_nulls), ", ".join(gas_nulls) or "none"))
    print("tax nulls: %d (%s)" % (len(tax_nulls), ", ".join(tax_nulls) or "none"))
    print("GRADE_ADD: midgrade=%s premium=%s diesel=%s" % (
        grade_add["midgrade"], grade_add["premium"], grade_add["diesel"]))
    print("rows per region: " + ", ".join("%s=%d" % (k, padd_counts[k]) for k in sorted(padd_counts)))
    for p in problems:
        print("PROBLEM: " + p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
