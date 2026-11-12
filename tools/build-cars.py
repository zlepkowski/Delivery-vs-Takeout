#!/usr/bin/env python3
"""build-cars.py: EPA vehicles.csv -> src/data/cars.js (CAR_DATA, BUILD.md §6, D-023).

Usage (from the repo root):
  python3 -I tools/build-cars.py --since 2025 --as-of 2026-11-12 \
      --cache <scratch dir> --out src/data/cars.js

Stdlib only. The download goes into --cache, never the repo. The output is
deterministic: the only input that changes it is --as-of (provenance header)
and the EPA file itself.

D-023 rules implemented here:
  * Model = (make, baseModel) with a record in model year >= --since. Only the
    records from that model's latest model year are used.
  * Fuel = most common fuelType1 among those records. Ties: Regular (incl.
    Midgrade, one gasoline group) > Premium > Diesel > Electricity > other.
    Regular/Midgrade -> no suffix, Premium -> '*', Diesel -> 'd',
    Electricity -> 'e'. Other fuels (hydrogen, natural gas, blank) are dropped.
  * Value = median over the records with that fuel of comb08 (gas, diesel) or
    1000 / combE (electric, mi/kWh x 10). The median uses exact fractions and
    rounds half up: floor(x + 1/2).
  * Makes are merged case-insensitively; the spelling used is the most common
    one across the file (ties: smallest string). ',', ':' and '|' in names
    become spaces and whitespace is collapsed. Makes and models sort by
    plain codepoint order.
"""

import argparse
import csv
import hashlib
import io
import os
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from fractions import Fraction
from math import floor

SOURCE_NAME = "EPA fueleconomy.gov vehicles.csv"
SOURCE_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip"
ZIP_NAME = "vehicles.csv.zip"
CSV_NAME = "vehicles.csv"

# Preference order for fuel ties (lower = wins).
FUEL_RANK = {"regular": 0, "premium": 1, "diesel": 2, "electric": 3, "other": 4}
SUFFIX = {"regular": "", "premium": "*", "diesel": "d", "electric": "e"}


def fuel_group(fuel_type1):
    if fuel_type1 in ("Regular Gasoline", "Midgrade Gasoline"):
        return "regular"
    if fuel_type1 == "Premium Gasoline":
        return "premium"
    if fuel_type1 == "Diesel":
        return "diesel"
    if fuel_type1 == "Electricity":
        return "electric"
    return "other"


def clean_name(s):
    s = re.sub(r"[,:|]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def round_half_up(x):
    return floor(x + Fraction(1, 2))


def median(values):
    vs = sorted(values)
    n = len(vs)
    if n % 2:
        return vs[n // 2]
    return (vs[n // 2 - 1] + vs[n // 2]) / 2


def fetch(cache_dir):
    """Returns the path to the cached zip, downloading it if absent."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, ZIP_NAME)
    if not os.path.exists(path):
        req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "research-client"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    return path


def read_rows(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        if CSV_NAME not in z.namelist():
            sys.exit("error: %s not found in zip" % CSV_NAME)
        with z.open(CSV_NAME) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            return list(csv.DictReader(text))


def build(rows, since):
    # Group by the case-folded make and the cleaned base model.
    spellings = defaultdict(Counter)  # makekey -> Counter of cleaned make spellings
    groups = defaultdict(list)        # (makekey, model) -> records
    for r in rows:
        make = clean_name(r["make"])
        model = clean_name(r["baseModel"])
        if not make or not model or not r["year"].strip().isdigit():
            continue
        key = make.casefold()
        spellings[key][make] += 1
        groups[(key, model)].append(r)

    def display_make(key):
        # Most common spelling; ties go to the smallest string.
        best = sorted(spellings[key].items(), key=lambda kv: (-kv[1], kv[0]))
        return best[0][0]

    models = defaultdict(dict)  # display make -> {model: (suffix, value)}
    dropped = Counter()
    tie_notes = []

    for (key, model), recs in groups.items():
        latest = max(int(r["year"]) for r in recs)
        if latest < since:
            dropped["before --since"] += 1
            continue
        newest = [r for r in recs if int(r["year"]) == latest]

        counts = Counter(fuel_group(r["fuelType1"]) for r in newest if fuel_group(r["fuelType1"]) != "other")
        other = sum(1 for r in newest if fuel_group(r["fuelType1"]) == "other")
        if not counts and other == 0:
            dropped["no fuel"] += 1
            continue
        ranked = sorted(
            [(-n, FUEL_RANK[g], g) for g, n in counts.items()]
            + ([(-other, FUEL_RANK["other"], "other")] if other else [])
        )
        if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
            tie_notes.append("%s %s: tie %s" % (display_make(key), model, ranked[0][2]))
        fuel = ranked[0][2]
        if fuel == "other":
            dropped["fuel other"] += 1
            continue

        chosen = [r for r in newest if fuel_group(r["fuelType1"]) == fuel]
        values = []
        for r in chosen:
            if fuel == "electric":
                e = r["combE"].strip()
                if e and Fraction(e) > 0:
                    values.append(Fraction(1000) / Fraction(e))
            else:
                c = r["comb08"].strip()
                if c and Fraction(c) > 0:
                    values.append(Fraction(c))
        if not values:
            dropped["no value"] += 1
            continue
        value = round_half_up(median(values))
        make = display_make(key)
        if model in models[make]:
            sys.exit("error: duplicate model after cleaning: %s %s" % (make, model))
        models[make][model] = (SUFFIX[fuel], value)

    # Makes can only appear once after case-folding, but two display names
    # could still collide if the display spelling were chosen per key; guard.
    makes = sorted(m for m in models if models[m])
    if len(set(m.casefold() for m in makes)) != len(makes):
        sys.exit("error: two makes differ only by case after merging")
    return makes, models, dropped, tie_notes


def pack_make(make, models):
    parts = []
    for name in sorted(models):
        suffix, value = models[name]
        parts.append("%s:%d%s" % (name, value, suffix))
    return "%s|%s" % (make, ",".join(parts))


def js_string(s):
    # Names are plain ASCII-ish text with no quotes/backslashes in practice;
    # escape defensively so the output is always a valid JS string literal.
    out = s.replace("\\", "\\\\").replace('"', '\\"')
    return '"' + out + '"'


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def header(as_of, since, digest):
    return (
        "/*\n"
        " * CAR_DATA: vehicles for the car-mileage picker, one packed string per make\n"
        " *   (\"Make|Model:value,Model:value*\"; no suffix = regular, * premium,\n"
        " *   d diesel, e electric with value = mi/kWh x 10). BUILD.md §6, D-023.\n"
        " * Source:  %s %s\n"
        " * As of:   %s\n"
        " * Method:  generated by tools/build-cars.py --since %d (input sha256 %s)\n"
        " * Nulls:   none (models without a usable value in the latest model year are left out)\n"
        " * Est:     none\n"
        " */\n"
    ) % (SOURCE_NAME, SOURCE_URL, as_of, since, digest)


def render(makes, models, as_of, since, digest):
    lines = [header(as_of, since, digest).rstrip("\n")]
    lines.append('(function (root) { "use strict"; root.POD.data.CAR_DATA = [')
    for i, make in enumerate(makes):
        comma = "," if i < len(makes) - 1 else ""
        lines.append("  " + js_string(pack_make(make, models[make])) + comma)
    lines.append("]; })(typeof window !== \"undefined\" ? window : this);")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since", type=int, required=True, help="earliest model year kept, e.g. 2025")
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD for the provenance header")
    ap.add_argument("--cache", required=True, help="scratch directory for the download")
    ap.add_argument("--out", required=True, help="output path, e.g. src/data/cars.js")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.as_of):
        sys.exit("error: --as-of must be YYYY-MM-DD")

    zip_path = fetch(args.cache)
    rows = read_rows(zip_path)
    print("records read: %d" % len(rows))

    makes, models, dropped, tie_notes = build(rows, args.since)
    text = render(makes, models, args.as_of, args.since, sha256_file(zip_path))

    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

    suffix_counts = Counter()
    n_models = 0
    for make in makes:
        for _, (suffix, _) in models[make].items():
            suffix_counts[suffix or "(none)"] += 1
            n_models += 1
    print("makes: %d" % len(makes))
    print("models: %d" % n_models)
    for s in ("(none)", "*", "d", "e"):
        print("  suffix %-6s %d" % (s, suffix_counts.get(s, 0)))
    print("dropped: %s" % (dict(dropped) if dropped else "none"))
    print("fuel ties resolved by rank: %d" % len(tie_notes))
    for note in tie_notes[:20]:
        print("  " + note)
    print("wrote %s (%d bytes)" % (args.out, len(text.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
