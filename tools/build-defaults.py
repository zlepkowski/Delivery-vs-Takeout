#!/usr/bin/env python3
"""Build src/data/defaults.js from the two hand-entered evidence files (D-032).

Inputs (hand-entered, with evidence; the orchestrator owns the decisions):
  tools/data/defaults-platforms.json   dd./ue./gh. fee keys, smallMin, smallFee, regFee
  tools/data/defaults-trip.json        wear, kwh, speed, tipDel, tipPick

Exactly 26 keys across the two files, each given once. Every entry needs
value (number or null), read (YYYY-MM-DD), est (true or false), and a https://
source or a D-nnn decision when the value is a number. est: true and null values
need a reason. Numbers are >= 0. Any failure names the key and the rule and exits 1.

Usage:
  python3 -I tools/build-defaults.py --as-of YYYY-MM-DD \
      [--platforms tools/data/defaults-platforms.json] \
      [--trip tools/data/defaults-trip.json] \
      [--out src/data/defaults.js]

Stdlib only. Output is deterministic (sorted keys, no timestamps beyond --as-of).
"""
import argparse
import datetime
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PLATFORMS_DEFAULT = os.path.join(HERE, "data", "defaults-platforms.json")
TRIP_DEFAULT = os.path.join(HERE, "data", "defaults-trip.json")
OUT_DEFAULT = os.path.join(ROOT, "src", "data", "defaults.js")

APPS = ("dd", "ue", "gh")
PLAT_FIELDS = ("delFee", "svc", "svcMin", "memberSvc", "memberMin", "pickDisc")
FEE_FIELDS = ("smallMin", "smallFee", "regFee")
TRIP_FIELDS = ("wear", "kwh", "speed")
TIP_FIELDS = ("tipDel", "tipPick")

# input key -> output path ("group.field"). 18 + 3 + 3 + 2 = 26.
TABLE = {}
for _a in APPS:
    for _f in PLAT_FIELDS:
        TABLE["%s.%s" % (_a, _f)] = "plats.%s.%s" % (_a, _f)
for _f in FEE_FIELDS:
    TABLE[_f] = "fees." + _f
for _f in TRIP_FIELDS:
    TABLE[_f] = "trip." + _f
for _f in TIP_FIELDS:
    TABLE[_f] = "tips." + _f
assert len(TABLE) == 26

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
URL_RE = re.compile(r"https://\S+\Z")
DEC_RE = re.compile(r"D-\d{3}\Z")


class Bad(Exception):
    pass


def is_date(s):
    if not isinstance(s, str) or not DATE_RE.match(s):
        return False
    try:
        datetime.datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _no_dupes(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise Bad("duplicate key %r in a JSON object" % k)
        out[k] = v
    return out


def load_values(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh, object_pairs_hook=_no_dupes)
    except (OSError, ValueError) as e:
        raise Bad("%s: cannot read %s: %s" % (label, path, e))
    if not isinstance(doc, dict) or not isinstance(doc.get("values"), dict):
        raise Bad('%s: top level must be an object with a "values" object' % label)
    return doc["values"]


def check_entry(key, where, e):
    """Validate one entry; return its normalised fields. Raises Bad naming key and rule."""

    def bad(rule):
        raise Bad("%s (%s): %s" % (key, where, rule))

    if not isinstance(e, dict):
        bad("entry must be an object")
    for f in ("value", "read", "est"):
        if f not in e:
            bad("missing field %r" % f)
    v = e["value"]
    if v is not None:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            bad("value must be a number or null")
        if v < 0:
            bad("value must be >= 0")
    if not is_date(e["read"]):
        bad("read must be YYYY-MM-DD")
    if not isinstance(e["est"], bool):
        bad("est must be true or false")
    src = e.get("source")
    dec = e.get("decision")
    if src is not None and not (isinstance(src, str) and URL_RE.match(src)):
        bad("source must start with https:// or be null")
    if dec is not None and not (isinstance(dec, str) and DEC_RE.match(dec)):
        bad("decision must match D-nnn or be null")
    reason = e.get("reason")
    has_reason = isinstance(reason, str) and reason.strip() != ""
    if e["est"] and not has_reason:
        bad("est: true needs a non-empty reason")
    if v is None and not has_reason:
        bad("a null value needs a non-empty reason")
    if v is not None and src is None and dec is None:
        bad("a number needs a source starting with https:// or a decision D-nnn")
    return {
        "value": v,
        "est": e["est"],
        "source": src,
        "decision": dec,
        "read": e["read"],
        "reason": " ".join(reason.split()) if has_reason else "",
    }


def build(platforms_path, trip_path):
    merged = {}  # input key -> (entry, file label)
    for path, label in ((platforms_path, "platforms"), (trip_path, "trip")):
        for key, entry in load_values(path, label).items():
            if key in merged:
                raise Bad("%s: key given in both input files" % key)
            merged[key] = (entry, label)

    for key in sorted(merged):
        if key not in TABLE:
            raise Bad("%s (%s): unknown key, not one of the 26 expected" % (key, merged[key][1]))
    for key in sorted(TABLE):
        if key not in merged:
            fname = "platforms" if key in FEE_FIELDS or key.split(".")[0] in APPS else "trip"
            raise Bad("missing key %s (expected in the %s file)" % (key, fname))

    defaults = {"plats": {a: {} for a in APPS}, "fees": {}, "trip": {}, "tips": {}}
    infos = []  # (output path, normalised entry), sorted by path
    for key in sorted(TABLE):
        path = TABLE[key]
        entry, where = merged[key]
        info = check_entry(key, where, entry)
        node = defaults
        parts = path.split(".")
        for p in parts[:-1]:
            node = node[p]
        node[parts[-1]] = info["value"]
        infos.append((path, info))
    infos.sort(key=lambda pi: pi[0])
    return defaults, infos


def js_json(obj):
    text = json.dumps(obj, sort_keys=True, indent=2, separators=(",", ": "), ensure_ascii=True)
    return text.replace("\n", "\n  ")


def header(as_of, infos):
    urls = sorted({i["source"] for _, i in infos if i["source"]})
    decs = sorted({i["decision"] for _, i in infos if i["decision"]})
    nulls = [p for p, i in infos if i["value"] is None]
    ests = [(p, i["reason"]) for p, i in infos if i["est"]]

    src_lines = []
    if urls:
        src_lines.append(" * Source:  " + urls[0])
        src_lines += [" *          " + u for u in urls[1:]]
    else:
        src_lines.append(" * Source:  none")
    src_lines[-1] += "; decisions: " + (", ".join(decs) if decs else "none")

    null_line = " * Nulls:   " + (
        ", ".join(nulls) + " (not published by the app, D-032)" if nulls else "none")

    if ests:
        est_lines = [" * Est:     %s: %s" % ests[0]]
        est_lines += [" *          %s: %s" % pr for pr in ests[1:]]
    else:
        est_lines = [" * Est:     none"]

    lines = ["/*",
             " * defaults: the values fresh() starts with (docs/state-contract.md §2, "
             "D-032: official numbers only; null = the user enters it)"]
    lines += src_lines
    lines += [" * As of:   " + as_of,
              " * Method:  generated by tools/build-defaults.py from "
              "tools/data/defaults-platforms.json and tools/data/defaults-trip.json",
              null_line]
    lines += est_lines
    if any("*/" in ln for ln in lines):
        raise Bad("header text contains the comment terminator")
    lines.append(" */")
    return "\n".join(lines) + "\n"


def render(as_of, defaults, infos):
    sources = {p: {"est": i["est"], "source": i["source"],
                   "decision": i["decision"], "read": i["read"]} for p, i in infos}
    return (header(as_of, infos)
            + "(function (root) {\n"
            + '  "use strict";\n'
            + "  var D = root.POD.data;\n"
            + "  D.DEFAULTS = " + js_json(defaults) + ";\n"
            + "  D.DEFAULT_SOURCES = " + js_json(sources) + ";\n"
            + "})(typeof window !== \"undefined\" ? window : this);\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build src/data/defaults.js (D-032).")
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD, written to the header")
    ap.add_argument("--platforms", default=PLATFORMS_DEFAULT)
    ap.add_argument("--trip", default=TRIP_DEFAULT)
    ap.add_argument("--out", default=OUT_DEFAULT)
    args = ap.parse_args(argv)
    try:
        if not is_date(args.as_of):
            raise Bad("--as-of must be YYYY-MM-DD")
        defaults, infos = build(args.platforms, args.trip)
        text = render(args.as_of, defaults, infos)
    except Bad as e:
        print("build-defaults: %s" % e, file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    numbers = sum(1 for _, i in infos if i["value"] is not None)
    nulls = sum(1 for _, i in infos if i["value"] is None)
    ests = sum(1 for _, i in infos if i["est"])
    urls = len({i["source"] for _, i in infos if i["source"]})
    print("build-defaults: %d paths (%d numbers, %d null, %d est), %d sources, %d distinct URLs -> %s"
          % (len(infos), numbers, nulls, ests, len(infos), urls, args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
