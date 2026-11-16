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
#   ATP_RUN    run id, or "latest" (default). A run id is built exactly, with no fallback.
#              "latest" tries up to 3 candidates (latest.json's run, then history.json's
#              newest) and deploys the first that passes every gate (D-039 amendment).
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

# Gas and tax: states.js with GAS_WEEK (D-039). It doesn't depend on the ATP run,
# so it is built once, before the store candidates. EIA_CACHE is a fresh dir each run.
echo "build-site: states (EIA gas, tax from tools/data/state-tax.csv)"
python3 -I "$ROOT/tools/build-states.py" \
  --as-of "$AS_OF" \
  --cache "$EIA_CACHE" \
  --tax "$ROOT/tools/data/state-tax.csv" \
  --out "$OUT/src/data/states.js"

# Which ATP runs to try (D-039 amendment). A set ATP_RUN is built exactly, with no
# fallback. "latest" (or unset) tries up to 3 candidates, newest first.
if [ "$ATP_RUN" = "latest" ]; then
  if ! CANDIDATES="$(python3 -I "$ROOT/tools/build-stores.py" --candidates 3)"; then
    echo "build-site: FAIL could not list candidate ATP runs" >&2
    exit 1
  fi
else
  CANDIDATES="$ATP_RUN"
fi
echo "build-site: candidate runs: $(echo "$CANDIDATES" | paste -sd ' ' -)"

# For each candidate: rebuild brands.js and the tiles into OUT, then run every gate.
# The first candidate that passes all of them is deployed. A failure is caught here,
# logged with its reason, and the next candidate is tried.
LOGDIR="$(mktemp -d)"
PASSED=""
REASONS=""
while IFS= read -r run; do
  [ -n "$run" ] || continue
  rm -rf "$OUT/src/data/stores" "$OUT/src/data/brands.js"
  blog="$LOGDIR/$run.build.log"
  clog="$LOGDIR/$run.check.log"
  # -u: unbuffered, so the failure line (stderr) and the progress lines stay in order in the log.
  if ! python3 -I -u "$ROOT/tools/build-stores.py" \
      --run "$run" \
      --as-of "$AS_OF" \
      --cache "$ATP_CACHE" \
      --brands-out "$OUT/src/data/brands.js" \
      --tiles-out "$OUT/src/data/stores" > "$blog" 2>&1; then
    reason="$(tail -n 1 "$blog")"
    echo "build-site: stores run $run: skipped ($reason)"
    REASONS="$REASONS  $run: $reason"$'\n'
    continue
  fi
  cat "$blog"
  if ! node "$ROOT/tools/check-site.js" "$OUT" "$ROOT" --as-of "$AS_OF" > "$clog" 2>&1; then
    reason="check-site: $(grep 'check-site: FAIL' "$clog" | sed 's/^check-site: //' | tr '\n' ';' || true)"
    cat "$clog"
    echo "build-site: stores run $run: skipped ($reason)"
    REASONS="$REASONS  $run: $reason"$'\n'
    continue
  fi
  cat "$clog"
  echo "build-site: stores run $run: OK"
  PASSED="$run"
  break
done <<< "$CANDIDATES"

if [ -z "$PASSED" ]; then
  echo "build-site: FAIL no candidate ATP run passed every gate:" >&2
  printf '%s' "$REASONS" >&2
  exit 1
fi

# es5-check resolves relative paths against the repo root, and path.resolve
# keeps an absolute OUT path as is. So pass the absolute path straight in.
# (check-site's es5 gate covers all of OUT/src; this line is kept as it was.)
node "$ROOT/tools/es5-check.js" "$OUT/src/data"

echo "build-site: OK -> $OUT"
find "$OUT" -maxdepth 2 -not -path "*/src/data/stores/*" | sort | head -40
