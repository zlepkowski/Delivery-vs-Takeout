#!/usr/bin/env bash
# build-site.sh OUT: builds the GitHub Pages folder (D-011, D-018, D-021).
#
# OUT receives ONLY index.html and src/. src/data/brands.js and the store
# tiles (src/data/stores/) are regenerated from an All The Places run into OUT.
# The repo's own src/ is never written to. Local stale tiles are not copied.
#
# Env:
#   ATP_RUN    run id or "latest" (default "latest")
#   ATP_CACHE  scratch cache dir (default: a fresh mktemp dir)
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
AS_OF="$(date -u +%F)"

echo "build-site: out=$OUT run=$ATP_RUN as-of=$AS_OF cache=$ATP_CACHE"

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

# Sanity checks. Any failure exits non-zero and fails the deploy.
echo "build-site: sanity checks"
node - "$OUT" "$ROOT" <<'JS'
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var out = process.argv[2];
var root = process.argv[3];
var MIN_BRANDS = 150;

function fail(msg) {
  console.error('build-site: FAIL ' + msg);
  process.exit(1);
}

function loadData(file) {
  var sandbox = { POD: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  } catch (err) {
    fail('cannot parse or run ' + file + ': ' + err.message);
  }
  return sandbox.POD;
}

var brandsFile = path.join(out, 'src', 'data', 'brands.js');
if (!fs.existsSync(brandsFile)) fail('brands.js was not written');
var POD = loadData(brandsFile);
var brands = POD.data && POD.data.BRANDS;
if (!brands || typeof brands !== 'object') fail('brands.js has no POD.data.BRANDS object');
var brandCount = Object.keys(brands).length;
if (brandCount < MIN_BRANDS) fail('only ' + brandCount + ' brands, need at least ' + MIN_BRANDS);
console.log('build-site: brands ' + brandCount + ' (min ' + MIN_BRANDS + ')');

var tilesDir = path.join(out, 'src', 'data', 'stores');
var tileFiles = fs.existsSync(tilesDir)
  ? fs.readdirSync(tilesDir).filter(function (f) { return /\.js$/.test(f); })
  : [];
if (tileFiles.length === 0) fail('no store tiles in ' + tilesDir);
console.log('build-site: tiles ' + tileFiles.length);

// Every profiled brand must exist in the new BRANDS (only if profiles.js is in the repo).
var profilesSrc = path.join(root, 'src', 'data', 'profiles.js');
if (fs.existsSync(profilesSrc)) {
  var profilesFile = path.join(out, 'src', 'data', 'profiles.js');
  var PODp = loadData(profilesFile);
  var profiles = (PODp.data && PODp.data.PROFILES) || {};
  var missing = Object.keys(profiles).filter(function (k) { return !brands.hasOwnProperty(k); });
  if (missing.length) fail('PROFILES keys not in BRANDS: ' + missing.join(', '));
  console.log('build-site: profiles ' + Object.keys(profiles).length + ' all in BRANDS');
} else {
  console.log('build-site: profiles check skipped (no src/data/profiles.js)');
}
JS

# es5-check resolves relative paths against the repo root, and path.resolve
# keeps an absolute OUT path as is. So pass the absolute path straight in.
node "$ROOT/tools/es5-check.js" "$OUT/src/data"

echo "build-site: OK -> $OUT"
find "$OUT" -maxdepth 2 -not -path "*/src/data/stores/*" | sort | head -40
