#!/usr/bin/env python3
"""build-cars.py: EPA vehicles.csv -> src/data/cars.js (CAR_DATA and CAR_YEARS, BUILD.md §6, D-023, D-037).

Usage (from the repo root):
  python3 -I tools/build-cars.py --since 2025 --years-since 2000 --as-of 2026-11-16 \
      --cache <scratch dir> --out src/data/cars.js

Stdlib only. The download goes into --cache, never the repo. The output is
deterministic: the only inputs that change it are --as-of (provenance header),
--since, --years-since and the EPA file itself.

D-023 rules implemented here (CAR_DATA):
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

D-037 rules implemented here (CAR_YEARS, written only with --years-since):
  * Every (make, model) with a record in model year >= --years-since. Model
    years before --years-since are left out, and so is a model with no runs.
  * A model year's figure is the D-023 rule (figure() below) applied to that
    year's records alone. A year with no record, or no figure (winning fuel
    "other", or no usable values), has no figure and splits runs.
  * Grammar: one string per make, "Make|Model:runs,Model:runs". Runs are
    separated by one space, newest first. A run is value + suffix + '@' +
    first year, plus '-' + last year unless it is a single year. A run covers
    consecutive years with the same value and suffix.
  * Make spelling and name cleaning are the same as CAR_DATA's, so the tables
    cannot drift. Each CAR_DATA pair's newest run equals its CAR_DATA value and
    suffix and ends at its latest year; the build refuses to write otherwise.
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


def figure(recs):
    """D-023's rule on one set of records (one model year, or a model's latest year).

    Returns (fig, reason, tie_winner):
      fig       (suffix, value) or None
      reason    None when fig is set, else "no fuel", "fuel other" or "no value"
      tie_winner the winning fuel group when the top two fuel counts tie, else None
    """
    counts = Counter(fuel_group(r["fuelType1"]) for r in recs if fuel_group(r["fuelType1"]) != "other")
    other = sum(1 for r in recs if fuel_group(r["fuelType1"]) == "other")
    if not counts and other == 0:
        return None, "no fuel", None
    ranked = sorted(
        [(-n, FUEL_RANK[g], g) for g, n in counts.items()]
        + ([(-other, FUEL_RANK["other"], "other")] if other else [])
    )
    tie_winner = None
    if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
        tie_winner = ranked[0][2]
    fuel = ranked[0][2]
    if fuel == "other":
        return None, "fuel other", tie_winner

    values = []
    for r in recs:
        if fuel_group(r["fuelType1"]) != fuel:
            continue
        if fuel == "electric":
            e = r["combE"].strip()
            if e and Fraction(e) > 0:
                values.append(Fraction(1000) / Fraction(e))
        else:
            c = r["comb08"].strip()
            if c and Fraction(c) > 0:
                values.append(Fraction(c))
    if not values:
        return None, "no value", tie_winner
    return (SUFFIX[fuel], round_half_up(median(values))), None, tie_winner


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


def build(rows, since, years_since=None):
    """Returns (makes, models, years, dropped, tie_notes, runs_count).

    models: display make -> {model: (suffix, value)}        (CAR_DATA)
    years:  display make -> {model: [(suffix, value, first, last), ...]}
            oldest run first (CAR_YEARS writes them newest first); None when
            years_since is None.
    """
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
    latest_of = {}              # (display make, model) -> latest model year
    dropped = Counter()
    tie_notes = []

    for (key, model), recs in groups.items():
        latest = max(int(r["year"]) for r in recs)
        if latest < since:
            dropped["before --since"] += 1
            continue
        newest = [r for r in recs if int(r["year"]) == latest]
        fig, reason, tie_winner = figure(newest)
        if tie_winner is not None:
            tie_notes.append("%s %s: tie %s" % (display_make(key), model, tie_winner))
        if reason is not None:
            dropped[reason] += 1
            continue
        make = display_make(key)
        if model in models[make]:
            sys.exit("error: duplicate model after cleaning: %s %s" % (make, model))
        models[make][model] = fig
        latest_of[(make, model)] = latest

    years = None
    runs_count = 0
    if years_since is not None:
        years = defaultdict(dict)
        for (key, model), recs in groups.items():
            by_year = defaultdict(list)
            for r in recs:
                by_year[int(r["year"])].append(r)
            top = max(by_year)
            if top < years_since:
                continue
            runs = []  # oldest first: [suffix, value, first, last]
            cur = None
            for y in range(years_since, top + 1):
                fig = figure(by_year[y])[0] if y in by_year else None
                if fig is None:
                    cur = None  # a year with no figure splits the runs
                    continue
                if cur is not None and (cur[0], cur[1]) == fig:
                    cur[3] = y
                else:
                    cur = [fig[0], fig[1], y, y]
                    runs.append(cur)
            if not runs:
                continue
            make = display_make(key)
            if model in years[make]:
                sys.exit("error: duplicate model after cleaning: %s %s" % (make, model))
            years[make][model] = [tuple(r) for r in runs]
            runs_count += len(runs)

        # The newest run of each CAR_DATA pair must be its CAR_DATA figure, ending at its latest year.
        for make in models:
            for model, fig in models[make].items():
                runs = years.get(make, {}).get(model)
                if not runs:
                    sys.exit("error: CAR_DATA model %s %s has no CAR_YEARS runs" % (make, model))
                newest = runs[-1]
                if (newest[0], newest[1]) != fig or newest[3] != latest_of[(make, model)]:
                    sys.exit("error: CAR_YEARS newest run differs from CAR_DATA for %s %s" % (make, model))

    # Makes can only appear once after case-folding, but two display names
    # could still collide if the display spelling were chosen per key; guard.
    makes = sorted(m for m in models if models[m])
    if len(set(m.casefold() for m in makes)) != len(makes):
        sys.exit("error: two makes differ only by case after merging")
    if years is not None:
        year_makes = sorted(m for m in years if years[m])
        if len(set(m.casefold() for m in year_makes)) != len(year_makes):
            sys.exit("error: two makes differ only by case after merging (CAR_YEARS)")
        for m in makes:
            if m not in year_makes:
                sys.exit("error: CAR_DATA make %s missing from CAR_YEARS" % m)
    return makes, models, years, dropped, tie_notes, runs_count


def pack_make(make, models):
    parts = []
    for name in sorted(models):
        suffix, value = models[name]
        parts.append("%s:%d%s" % (name, value, suffix))
    return "%s|%s" % (make, ",".join(parts))


def run_text(run):
    suffix, value, first, last = run
    text = "%d%s@%d" % (value, suffix, first)
    if last != first:
        text += "-%d" % last
    return text


def pack_make_years(make, models):
    parts = []
    for name in sorted(models):
        newest_first = " ".join(run_text(r) for r in reversed(models[name]))
        parts.append("%s:%s" % (name, newest_first))
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


def header(as_of, since, years_since, digest):
    lines = [
        "/*",
        " * CAR_DATA: vehicles for the car-mileage picker, one packed string per make",
        " *   (\"Make|Model:value,Model:value*\"; no suffix = regular, * premium,",
        " *   d diesel, e electric with value = mi/kWh x 10). BUILD.md §6, D-023.",
    ]
    if years_since is not None:
        lines += [
            " * CAR_YEARS: the same figures per model year, one string per make (D-037):",
            " *   \"Make|Model:runs\"; a run is value+suffix@first[-last], runs space-separated, newest first.",
        ]
    lines += [
        " * Source:  %s %s" % (SOURCE_NAME, SOURCE_URL),
        " * As of:   %s" % as_of,
    ]
    method = "generated by tools/build-cars.py --since %d" % since
    if years_since is not None:
        method += " --years-since %d" % years_since
    lines.append(" * Method:  %s (input sha256 %s)" % (method, digest))
    nulls = "none (models without a usable value in the latest model year are left out"
    if years_since is not None:
        nulls += "; a model year without a usable value has no run"
    lines.append(" * Nulls:   %s)" % nulls)
    lines.append(" * Est:     none")
    lines.append(" */")
    return "\n".join(lines) + "\n"


def render(makes, models, years, as_of, since, years_since, digest):
    lines = [header(as_of, since, years_since, digest).rstrip("\n")]
    lines.append('(function (root) { "use strict"; root.POD.data.CAR_DATA = [')
    for i, make in enumerate(makes):
        comma = "," if i < len(makes) - 1 else ""
        lines.append("  " + js_string(pack_make(make, models[make])) + comma)
    if years is None:
        lines.append("]; })(typeof window !== \"undefined\" ? window : this);")
    else:
        year_makes = sorted(m for m in years if years[m])
        lines.append("]; root.POD.data.CAR_YEARS = [")
        for i, make in enumerate(year_makes):
            comma = "," if i < len(year_makes) - 1 else ""
            lines.append("  " + js_string(pack_make_years(make, years[make])) + comma)
        lines.append("]; })(typeof window !== \"undefined\" ? window : this);")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since", type=int, required=True, help="earliest model year kept for CAR_DATA, e.g. 2025")
    ap.add_argument("--years-since", type=int, default=None,
                    help="earliest model year kept for CAR_YEARS, e.g. 2000; omit to write CAR_DATA only")
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD for the provenance header")
    ap.add_argument("--cache", required=True, help="scratch directory for the download")
    ap.add_argument("--out", required=True, help="output path, e.g. src/data/cars.js")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.as_of):
        sys.exit("error: --as-of must be YYYY-MM-DD")

    zip_path = fetch(args.cache)
    rows = read_rows(zip_path)
    print("records read: %d" % len(rows))

    makes, models, years, dropped, tie_notes, runs_count = build(rows, args.since, args.years_since)
    text = render(makes, models, years, args.as_of, args.since, args.years_since, sha256_file(zip_path))

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
    print("CAR_DATA makes: %d" % len(makes))
    print("CAR_DATA models: %d" % n_models)
    for s in ("(none)", "*", "d", "e"):
        print("  suffix %-6s %d" % (s, suffix_counts.get(s, 0)))
    print("dropped: %s" % (dict(dropped) if dropped else "none"))
    print("fuel ties resolved by rank: %d" % len(tie_notes))
    for note in tie_notes[:20]:
        print("  " + note)
    if years is not None:
        year_makes = [m for m in years if years[m]]
        year_models = sum(len(years[m]) for m in year_makes)
        print("CAR_YEARS makes: %d" % len(year_makes))
        print("CAR_YEARS models: %d" % year_models)
        print("CAR_YEARS runs: %d" % runs_count)
    print("wrote %s (%d bytes)" % (args.out, len(text.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
