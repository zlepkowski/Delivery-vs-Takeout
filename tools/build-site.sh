#!/usr/bin/env bash
# build-site.sh OUT: builds the GitHub Pages folder (D-011, D-018, D-021).
#
# OUT receives ONLY index.html and src/. src/data/brands.js and the store
# tiles (src/data/stores/) are regenerated from an All The Places run into OUT,
# and src/data/states.js (EIA gas, GAS_WEEK) is regenerated too (D-039).
# tools/check-site.js then runs the gates on OUT and fails the build on any FAIL.
# The repo's own src/ is never written to. Local stale tiles are not copied.
#
# Env:
#   ATP_RUN    run id or "latest" (default "latest")
#   ATP_CACHE  scratch cache dir (default: a fresh mktemp dir)
#   EIA_CACHE  scratch cache dir for EIA downloads (default: a fresh mktemp dir;
#              never reuse an old one, or a stale gas week gets built)
#
# Usage: bash tools/build-site.sh OUT
# Needs: python3, node (es5 check uses acorn from npm ci).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ARG="${1:?usage: bash tools/build-site.sh OUT}"
# Normalize to an absolute path without requiring it to exist (resolves .. and relative parts).
OUT="$(python3 -I -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT_ARG")"
refuse() { echo "build-site: refusing to build into '$OUT': $1" >&2; exit 1; }
case "$OUT" in
  ""|"/") refuse "filesystem root" ;;
esac
[ "$OUT" = "$HOME" ] && refuse "home directory"
[ "$OUT" = "$ROOT" ] && refuse "repo root"
# OUT must not be the repo root or any ancestor of it (rm -rf would delete the repo).
case "$ROOT/" in "$OUT/"*) refuse "ancestor of the repo" ;; esac
# OUT must not be inside the repo's src/ (we copy src/ into OUT).
case "$OUT/" in "$ROOT/src/"*) refuse "inside the repo's src/" ;; esac

ATP_RUN="${ATP_RUN:-latest}"
ATP_CACHE="${ATP_CACHE:-$(mktemp -d)}"
EIA_CACHE="${EIA_CACHE:-$(mktemp -d)}"
AS_OF="$(date -u +%F)"

echo "build-site: out=$OUT run=$ATP_RUN as-of=$AS_OF cache=$ATP_CACHE eia-cache=$EIA_CACHE"

rm -rf "$OUT"
mkdir -p "$OUT/src"
cp "$ROOT/index.html" "$OUT/index.html"
cp -R "$ROOT/src/." "$OUT/src/"
rm -rf "$OUT/src/data/stores"

# Regenerate brands and tiles into OUT only.
python3 -I "$ROOT/tools/build-stores.py" \
  --run "$ATP_RUN" \
  --as-of "$AS_OF" \
  --cache "$ATP_CACHE" \
  --brands-out "$OUT/src/data/brands.js" \
  --tiles-out "$OUT/src/data/stores"

# Gas and tax: states.js with GAS_WEEK (D-039). EIA_CACHE is a fresh dir each run,
# so a stale EIA week is never reused.
echo "build-site: states (EIA gas, tax from tools/data/state-tax.csv)"
python3 -I "$ROOT/tools/build-states.py" \
  --as-of "$AS_OF" \
  --cache "$EIA_CACHE" \
  --tax "$ROOT/tools/data/state-tax.csv" \
  --out "$OUT/src/data/states.js"

# The D-039 gates (brands, drift, canary, states, es5). Any failure exits non-zero
# and fails the deploy, so Pages keeps serving the last good site.
echo "build-site: gates"
node "$ROOT/tools/check-site.js" "$OUT" "$ROOT" --as-of "$AS_OF"

# es5-check resolves relative paths against the repo root, and path.resolve
# keeps an absolute OUT path as is. So pass the absolute path straight in.
# (check-site's es5 gate covers all of OUT/src; this line is kept as it was.)
node "$ROOT/tools/es5-check.js" "$OUT/src/data"

echo "build-site: OK -> $OUT"
find "$OUT" -maxdepth 2 -not -path "*/src/data/stores/*" | sort | head -40
