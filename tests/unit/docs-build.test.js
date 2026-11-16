// docs-build.test.js: pins docs/BUILD.md (the v5 spec) to the repo. Paths, Markdown links,
// D- and ISS- ids, the §2 load order, the localStorage key, the contract table, the
// BUILD.md §N citations in the other files, and the numbers BUILD.md states about the data.
// Expected values come from disk, src/data (through loadData and loadApp), .gitignore,
// decisions.md and issues.md. BUILD.md is the text under test, never the source of an expected value.
// Failure messages read "BUILD.md says X, the repo has Y".

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { APP_ROOT, loadApp, scriptOrder } = require('../helpers/load');
const { loadData } = require('../helpers/data');

const DOCS = path.join(APP_ROOT, 'docs');
const BUILD_PATH = path.join(DOCS, 'BUILD.md');
const BUILD_TEXT = fs.readFileSync(BUILD_PATH, 'utf8');
const BUILD_LINES = BUILD_TEXT.split('\n');
const EM = '—';

// ---------- BUILD.md parsing ----------

// Fenced blocks (``` ... ```) as {start, lines}; prose() yields the other lines with their 1-based numbers.
function fencedBlocks() {
  const blocks = [];
  let cur = null;
  BUILD_LINES.forEach((line, i) => {
    if (/^```/.test(line)) {
      if (cur) {
        blocks.push(cur);
        cur = null;
      } else {
        cur = { start: i + 1, lines: [] };
      }
      return;
    }
    if (cur) cur.lines.push(line);
  });
  return blocks;
}
function prose() {
  const out = [];
  let fenced = false;
  BUILD_LINES.forEach((line, i) => {
    if (/^```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (!fenced) out.push({ n: i + 1, text: line });
  });
  return out;
}

// GitHub-style slug as specified: lowercase; drop characters other than letters, digits, spaces, hyphens; spaces to hyphens.
function slug(headingText) {
  return headingText
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}
function headingSlugs(text) {
  const set = new Set();
  for (const line of text.split('\n')) {
    const m = /^#{1,6} (.*)$/.exec(line);
    if (m) set.add(slug(m[1]));
  }
  return set;
}

// ---------- .gitignore: build outputs that a fresh clone doesn't have ----------

function gitignoreEntries() {
  return fs
    .readFileSync(path.join(APP_ROOT, '.gitignore'), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
    .map((s) => s.replace(/\/+$/, ''));
}
// The one generated output BUILD.md may name: src/data/stores/ (built at deploy time, D-011). Nothing else is exempt.
const GENERATED_DIR = 'src/data/stores/';
// A path that exists, or is the generated directory (or a path inside it) and .gitignore lists that directory.
function existsOrGenerated(rel) {
  if (fs.existsSync(path.join(APP_ROOT, rel))) return true;
  const inGenerated = rel === GENERATED_DIR || rel.startsWith(GENERATED_DIR);
  return inGenerated && gitignoreEntries().includes(GENERATED_DIR.replace(/\/+$/, ''));
}

// ---------- data (through the helpers, never regex on the data files) ----------

let cachedData = null;
function data() {
  if (!cachedData) {
    cachedData = loadData([
      'src/data/cards.js',
      'src/data/brands.js',
      'src/data/profiles.js',
      'src/data/categories.js',
      'src/data/cars.js',
      'src/data/states.js',
    ]);
  }
  return cachedData;
}

// ---------- helpers ----------

function firstMatch(re, what) {
  const m = BUILD_TEXT.match(re);
  assert.ok(m, `BUILD.md has no ${what}: pattern ${re} not found (the sentence was reworded or removed)`);
  return m;
}
function num(s) {
  return Number(String(s).replace(/,/g, ''));
}
function sorted(list) {
  return Array.from(list).slice().sort();
}
function report(label, problems) {
  assert.deepEqual(problems, [], `${label}:\n  ${problems.join('\n  ')}`);
}
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
function isText(buf) {
  return buf.subarray(0, 8000).indexOf(0) === -1;
}

// ---------- 1. paths ----------

const PATH_PREFIXES = ['index.html', 'src/', 'tools/', 'tests/', 'docs/', 'worker/', '.github/'];

// The directory part of a path token: a placeholder ( < { * | ) checks only what precedes it.
function pathToCheck(token) {
  const m = token.search(/[<{*|]/);
  if (m < 0) return token;
  return token.slice(0, m).slice(0, token.slice(0, m).lastIndexOf('/') + 1);
}
function inlinePathSpans() {
  const out = [];
  for (const { n, text } of prose()) {
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      const token = m[1].trim().split(/\s+/)[0].replace(/[.,;:!?)]+$/, '');
      if (!PATH_PREFIXES.some((p) => token.startsWith(p))) continue;
      out.push({ n, span: m[1], rel: pathToCheck(token) });
    }
  }
  return out;
}

test('paths: every backticked repo path in BUILD.md exists on disk (placeholders check their directory)', () => {
  const spans = inlinePathSpans();
  assert.ok(spans.length > 40, `the path scan found ${spans.length} paths; expected more than 40`);
  const problems = [];
  for (const { n, span, rel } of spans) {
    if (!existsOrGenerated(rel)) problems.push(`BUILD.md:${n} \`${span}\`: BUILD.md names ${rel}, the repo has no such path`);
  }
  report('BUILD.md names paths the repo does not have', problems);
});

test('paths: every backticked test file and receipt id in BUILD.md exists', () => {
  const problems = [];
  let checked = 0;
  for (const { n, text } of prose()) {
    for (const m of text.matchAll(/`([^`\s]+)`/g)) {
      const s = m[1];
      let rel = null;
      if (/^[\w.-]+\.test\.js$/.test(s)) rel = path.posix.join('tests/unit', s);
      else if (/^[\w.-]+\.e2e\.js$/.test(s)) rel = path.posix.join('tests/e2e', s);
      else if (/^r\d\d-[a-z0-9-]+$/.test(s)) rel = path.posix.join('tests/fixtures/receipts', s + '.json');
      if (!rel) continue;
      checked++;
      if (!fs.existsSync(path.join(APP_ROOT, rel))) problems.push(`BUILD.md:${n} \`${s}\`: BUILD.md names ${rel}, the repo has no such file`);
    }
  }
  assert.ok(checked > 5, `the test and receipt scan found ${checked} names; expected more than 5`);
  report('BUILD.md names test files or receipts the repo does not have', problems);
});

test('§2 layout block: the first word of every line exists in the repo', () => {
  const block = fencedBlocks().find((b) => b.lines[0] && b.lines[0].startsWith('index.html'));
  assert.ok(block, 'BUILD.md has no §2 layout block starting with index.html');
  const problems = [];
  for (const line of block.lines) {
    if (!line.trim()) continue;
    const word = line.trim().split(/\s+/)[0];
    if (!existsOrGenerated(word)) problems.push(`BUILD.md §2 layout names ${word}, the repo has no such path`);
  }
  report('the §2 layout block names paths the repo does not have', problems);
});

// ---------- 2. links ----------

test('links: every relative Markdown link in BUILD.md resolves from docs/', () => {
  const problems = [];
  let checked = 0;
  for (const { n, text } of prose()) {
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^https?:/.test(target) || target.startsWith('#')) continue;
      checked++;
      const [file, frag] = target.split('#');
      const abs = path.join(DOCS, file);
      if (!fs.existsSync(abs)) {
        problems.push(`BUILD.md:${n} (${target}): BUILD.md links ${file}, docs/${file} does not exist`);
        continue;
      }
      if (frag !== undefined && file.endsWith('.md') && !headingSlugs(fs.readFileSync(abs, 'utf8')).has(frag)) {
        problems.push(`BUILD.md:${n} (${target}): BUILD.md links #${frag}, ${file} has no such heading`);
      }
    }
  }
  assert.ok(checked > 10, `the link scan found ${checked} relative links; expected more than 10`);
  report('BUILD.md has relative links that do not resolve', problems);
});

test('links: every (#anchor) in BUILD.md matches a BUILD.md heading slug', () => {
  const slugs = headingSlugs(BUILD_TEXT);
  const problems = [];
  let checked = 0;
  for (const { n, text } of prose()) {
    for (const m of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
      checked++;
      if (!slugs.has(m[1])) problems.push(`BUILD.md:${n} (#${m[1]}): BUILD.md links to #${m[1]}, no BUILD.md heading has that slug`);
    }
  }
  assert.ok(checked > 3, `the anchor scan found ${checked} anchors; expected more than 3`);
  report('BUILD.md has anchors that match no heading', problems);
});

// ---------- 3. ids ----------

test('IDs: every D-nnn in BUILD.md is a decision heading in docs/decisions.md', () => {
  const dec = fs.readFileSync(path.join(DOCS, 'decisions.md'), 'utf8');
  const ids = [...new Set(BUILD_TEXT.match(/\bD-\d{3}\b/g) || [])];
  assert.ok(ids.length > 10, `BUILD.md names ${ids.length} decisions; expected more than 10`);
  const problems = ids.filter((id) => !dec.includes(`**${id} ${EM}`)).map((id) => `BUILD.md says ${id}, docs/decisions.md has no **${id} ${EM} heading`);
  report('BUILD.md names decisions decisions.md does not have', problems);
});

test('IDs: every ISS-nnn in BUILD.md is an issue heading in docs/issues.md', () => {
  const iss = fs.readFileSync(path.join(DOCS, 'issues.md'), 'utf8');
  const ids = [...new Set(BUILD_TEXT.match(/\bISS-\d{3}\b/g) || [])];
  assert.ok(ids.length > 3, `BUILD.md names ${ids.length} issues; expected more than 3`);
  const problems = ids.filter((id) => !iss.includes(`### ${id} ${EM}`)).map((id) => `BUILD.md says ${id}, docs/issues.md has no ### ${id} ${EM} heading`);
  report('BUILD.md names issues issues.md does not have', problems);
});

// ---------- 4. load order ----------

test('§2 load order: the fenced block lists index.html script order exactly', () => {
  const block = fencedBlocks().find((b) => b.lines[0] && b.lines[0].startsWith('src/js/pod.js'));
  assert.ok(block, 'BUILD.md has no load-order block starting with src/js/pod.js');
  const listed = block.lines.filter((l) => l.trim()).map((l) => l.trim().split(/\s+/)[0]);
  const order = scriptOrder();
  const problems = [];
  const len = Math.max(listed.length, order.length);
  for (let i = 0; i < len; i++) {
    if (listed[i] !== order[i]) {
      problems.push(`position ${i + 1}: BUILD.md says ${listed[i]}, index.html has ${order[i]}`);
    }
  }
  assert.ok(order.length > 10, `index.html lists ${order.length} scripts; expected more than 10`);
  report('the BUILD.md load-order block differs from index.html', problems);
});

// ---------- 5. storage key ----------

test('appendix: the localStorage key in BUILD.md equals POD.STORAGE_KEY', () => {
  const says = firstMatch(/\*\*localStorage key:\*\* `([^`]+)`/, 'localStorage key line')[1];
  const { POD } = loadApp({ only: ['pod.js'] });
  assert.equal(POD.STORAGE_KEY, says, `BUILD.md says ${says}, the repo has ${POD.STORAGE_KEY}`);
});

// ---------- 6. contracts ----------

test('contract table: the contract links are exactly the docs/*-contract.md files on disk', () => {
  const lines = BUILD_LINES;
  const head = lines.findIndex((l) => l.startsWith('| Contract | Defines'));
  assert.ok(head >= 0, 'BUILD.md has no contract table');
  const linked = new Set();
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    for (const m of lines[i].matchAll(/\]\(([^)\s]+-contract\.md)\)/g)) linked.add(m[1]);
  }
  const onDisk = fs.readdirSync(DOCS).filter((f) => /-contract\.md$/.test(f));
  assert.ok(onDisk.length > 4, `docs/ has ${onDisk.length} contracts; expected more than 4`);
  const problems = [];
  for (const f of onDisk) if (!linked.has(f)) problems.push(`docs/${f} exists, BUILD.md's contract table does not link it`);
  for (const f of linked) if (!onDisk.includes(f)) problems.push(`BUILD.md's contract table links ${f}, docs/${f} does not exist`);
  report('the BUILD.md contract table differs from docs/*-contract.md', problems);
});

// ---------- 7. citations ----------

// Section map of BUILD.md: "## N." headings, "### N.M" headings, and numbered list items inside each section.
function buildMap() {
  const sections = new Set();
  const subs = new Set();
  const items = new Map();
  let cur = null;
  for (const { text } of prose()) {
    const h2 = /^## (\d+)\. /.exec(text);
    if (h2) {
      cur = h2[1];
      sections.add(cur);
      continue;
    }
    if (/^## /.test(text)) {
      cur = null;
      continue;
    }
    const h3 = /^### (\d+\.\d+) /.exec(text);
    if (h3) subs.add(h3[1]);
    const li = /^(\d+)\. /.exec(text);
    if (li && cur !== null) {
      if (!items.has(cur)) items.set(cur, new Set());
      items.get(cur).add(li[1]);
    }
  }
  return { sections, subs, items };
}

function citations() {
  const files = [];
  for (const f of fs.readdirSync(DOCS)) if (f.endsWith('.md') && f !== 'BUILD.md') files.push(path.join(DOCS, f));
  for (const d of ['src', 'tests', 'tools', 'worker', '.claude']) {
    const abs = path.join(APP_ROOT, d);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  files.push(path.join(APP_ROOT, 'CLAUDE.md'), path.join(APP_ROOT, 'README.md'));
  const found = [];
  for (const abs of files) {
    const buf = fs.readFileSync(abs);
    if (!isText(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/BUILD\.md(?:'s)?\s+(§\d+(?:\.\d+)?(?:\s*(?:\/|,|and|or)\s*§?\d+(?:\.\d+)?)*)/g)) {
        for (const ref of m[1].match(/\d+(?:\.\d+)?/g)) {
          found.push({ file: path.relative(APP_ROOT, abs), line: i + 1, ref });
        }
      }
    });
  }
  return found;
}

test('citations: every BUILD.md §N and §N.M cited elsewhere resolves to a BUILD.md section, subsection or list item', () => {
  const map = buildMap();
  const found = citations();
  assert.ok(found.length > 50, `the citation scan found ${found.length} citations; expected more than 50`);
  const problems = [];
  for (const { file, line, ref } of found) {
    let ok;
    if (ref.includes('.')) {
      const [N, M] = ref.split('.');
      ok = map.subs.has(ref) || (map.items.has(N) && map.items.get(N).has(M));
    } else {
      ok = map.sections.has(ref);
    }
    if (!ok) problems.push(`${file}:${line}: cites BUILD.md §${ref}, BUILD.md has no §${ref} heading or list item`);
  }
  report('citations of BUILD.md that do not resolve', problems);
});

// ---------- 8. data claims ----------

test('§6 CARDS: "22 cards (13 Amex, 7 Chase)" and "21 food-relevant credits" match CARDS', () => {
  const m = firstMatch(/array of (\d+) cards \((\d+) Amex, (\d+) Chase[^)]*\) with (\d+) food-relevant credits/, 'card and credit counts');
  const cards = data().CARDS;
  const credits = cards.reduce((n, c) => n + c.credits.length, 0);
  const amex = cards.filter((c) => c.issuer === 'American Express').length;
  const chase = cards.filter((c) => c.issuer === 'Chase').length;
  assert.equal(cards.length, num(m[1]), `BUILD.md says ${m[1]} cards, the repo has ${cards.length}`);
  assert.equal(amex, num(m[2]), `BUILD.md says ${m[2]} Amex cards, the repo has ${amex}`);
  assert.equal(chase, num(m[3]), `BUILD.md says ${m[3]} Chase cards, the repo has ${chase}`);
  assert.equal(credits, num(m[4]), `BUILD.md says ${m[4]} food-relevant credits, the repo has ${credits}`);
});

test('§6 PROFILES: the nine profiled ids named in BUILD.md equal Object.keys(PROFILES)', () => {
  const text = BUILD_TEXT;
  const start = text.indexOf('Nine chains are profiled');
  const end = text.indexOf('`taco_bell`', start);
  assert.ok(start >= 0 && end > start, 'BUILD.md has no "Nine chains are profiled" list ending at `taco_bell`');
  const named = [...text.slice(start, end).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  const have = Object.keys(data().PROFILES);
  assert.equal(have.length, 9, `the repo has ${have.length} profiles; BUILD.md says nine`);
  assert.deepEqual(sorted(named), sorted(have), `BUILD.md names ${sorted(named).join(', ')}, the repo has ${sorted(have).join(', ')}`);
});

test('§6 PROFILES: amexGoldDirect is true exactly for the two partners BUILD.md names', () => {
  const m = firstMatch(/amexGoldDirect,[^\n]*\/\/ ([a-z_, ]+?) \(five_guys is unprofiled\)/, 'amexGoldDirect comment');
  const named = m[1].split(/,\s*/).map((s) => s.trim());
  const P = data().PROFILES;
  const gold = Object.keys(P).filter((k) => P[k].amexGoldDirect === true);
  assert.equal(P.five_guys, undefined, 'five_guys must stay unprofiled (BUILD.md says so)');
  assert.deepEqual(sorted(gold), sorted(named), `BUILD.md says amexGoldDirect is true for ${named.join(', ')}, the repo has ${sorted(gold).join(', ')}`);
});

test('§6 PROFILES: only Wingstop has directDelivery, with the $2.99 directFee BUILD.md states', () => {
  const m = firstMatch(/only Wingstop has one, \$([\d.]+)\)/, 'Wingstop direct fee sentence');
  const P = data().PROFILES;
  const direct = Object.keys(P).filter((k) => P[k].directDelivery === true);
  const withFee = Object.keys(P).filter((k) => P[k].directFee !== undefined);
  assert.deepEqual(direct, ['wingstop'], `BUILD.md says only Wingstop has direct delivery, the repo has ${direct.join(', ')}`);
  assert.deepEqual(withFee, ['wingstop'], `BUILD.md says only Wingstop has a directFee, the repo has ${withFee.join(', ')}`);
  assert.equal(P.wingstop.directFee, parseFloat(m[1]), `BUILD.md says Wingstop's direct fee is $${m[1]}, the repo has ${P.wingstop.directFee}`);
});

test('§6 BRANDS: 273 brands, 182,567 stores, 847 tiles and the committed run match the data', () => {
  const brands = firstMatch(/holds the (\d+) US food brands/, 'brand count');
  const scan = firstMatch(/from ([\d,]+) deduplicated stores in (\d+) one-degree tiles \(run `([\d-]+)` in the committed copy/, 'store, tile and run sentence');
  const D = data();
  const stores = Object.values(D.BRANDS).reduce((n, b) => n + b.stores, 0);
  const tiles = Object.keys(D.TILE_INDEX).length;
  assert.equal(D.BRAND_IDS.length, num(brands[1]), `BUILD.md says ${brands[1]} brands, the repo has ${D.BRAND_IDS.length} in BRAND_IDS`);
  assert.equal(Object.keys(D.BRANDS).length, num(brands[1]), `BUILD.md says ${brands[1]} brands, the repo has ${Object.keys(D.BRANDS).length} in BRANDS`);
  assert.equal(stores, num(scan[1]), `BUILD.md says ${scan[1]} stores, the repo's BRANDS sum to ${stores}`);
  assert.equal(tiles, num(scan[2]), `BUILD.md says ${scan[2]} tiles, the repo's TILE_INDEX has ${tiles}`);
  assert.equal(D.BRANDS_RUN, scan[3], `BUILD.md says run ${scan[3]}, the repo has ${D.BRANDS_RUN}`);
});

test('§6 CATEGORY_DEFAULTS: the ten categories BUILD.md lists equal Object.keys(CATEGORY_DEFAULTS)', () => {
  const m = firstMatch(/one of (\d+): ([a-z, ]+)\)/, 'category list');
  const named = m[2].split(/,\s*/).map((s) => s.trim());
  const have = Object.keys(data().CATEGORY_DEFAULTS);
  assert.equal(num(m[1]), named.length, `BUILD.md says ${m[1]} categories and lists ${named.length}`);
  assert.deepEqual(sorted(named), sorted(have), `BUILD.md lists ${sorted(named).join(', ')}, the repo has ${sorted(have).join(', ')}`);
});

test('§6 CAR_DATA and CAR_YEARS: 48 makes (D-023) and 86 makes (D-037) match the data', () => {
  const a = firstMatch(/\((\d+) makes, D-023\)/, 'CAR_DATA make count');
  const b = firstMatch(/\((\d+) makes, D-037\)/, 'CAR_YEARS make count');
  const D = data();
  assert.equal(D.CAR_DATA.length, num(a[1]), `BUILD.md says ${a[1]} makes in CAR_DATA, the repo has ${D.CAR_DATA.length}`);
  assert.equal(D.CAR_YEARS.length, num(b[1]), `BUILD.md says ${b[1]} makes in CAR_YEARS, the repo has ${D.CAR_YEARS.length}`);
});

test('§6 STATES: "50 states and DC" and "the same 51 codes" match the STATES rows', () => {
  const a = firstMatch(/(\d+) states and DC/, 'state count');
  const b = firstMatch(/the same (\d+) codes/, 'state code count');
  const rows = data().STATES.length;
  assert.equal(num(a[1]) + 1, rows, `BUILD.md says ${a[1]} states and DC (${num(a[1]) + 1} rows), the repo's STATES has ${rows}`);
  assert.equal(num(b[1]), rows, `BUILD.md says the same ${b[1]} codes, the repo's STATES has ${rows} rows`);
});

// ---------- 9. stated facts that have a source in the repo ----------

// tools/check-site.js exports only checkSite(), so its gate constants are read by a regex on the source:
// each line is `const NAME = value;` with a number or a quoted string. This is the one regex on code in this file.
function checkSiteConst(name) {
  const src = fs.readFileSync(path.join(APP_ROOT, 'tools', 'check-site.js'), 'utf8');
  const m = new RegExp('^const ' + name + ' = (.+);$', 'm').exec(src);
  assert.ok(m, `tools/check-site.js has no 'const ${name} = ...;' line`);
  return m[1];
}
function gateValue(name) {
  const raw = checkSiteConst(name);
  return /^'/.test(raw) ? raw.slice(1, -1) : Number(raw);
}

test('§10 gates: every threshold BUILD.md states equals its constant in tools/check-site.js', () => {
  const sayings = [
    ['brands floor', /brands: at least (\d+);/, 'MIN_BRANDS', (m) => num(m[1])],
    ['total stores ratio', /total stores ≥ (\d+)%/, 'MIN_TOTAL_RATIO', (m) => num(m[1]) / 100],
    ['profiled brand ratio', /each profiled brand ≥ (\d+)%/, 'MIN_BRAND_RATIO', (m) => num(m[1]) / 100],
    ['canary ZIP', /ZIP (\d{5}) finds ≥ (\d+) brands within (\d+) mi/, 'CANARY_ZIP', (m) => m[1]],
    ['canary min', /ZIP (\d{5}) finds ≥ (\d+) brands within (\d+) mi/, 'CANARY_MIN_STORES', (m) => num(m[2])],
    ['canary radius', /ZIP (\d{5}) finds ≥ (\d+) brands within (\d+) mi/, 'CANARY_RADIUS', (m) => num(m[3])],
    ['gas floor', /gas in \[([\d.]+), ([\d.]+)\]/, 'GAS_MIN', (m) => num(m[1])],
    ['gas ceiling', /gas in \[([\d.]+), ([\d.]+)\]/, 'GAS_MAX', (m) => num(m[2])],
    ['grade spread floor', /grade spreads in \[([\d.]+), ([\d.]+)\]/, 'GRADE_MIN', (m) => num(m[1])],
    ['grade spread ceiling', /grade spreads in \[([\d.]+), ([\d.]+)\]/, 'GRADE_MAX', (m) => num(m[2])],
    ['gas age', /`GAS_WEEK` at most (\d+) days old/, 'MAX_GAS_AGE_DAYS', (m) => num(m[1])],
  ];
  const problems = [];
  for (const [label, re, constName, pick] of sayings) {
    const m = BUILD_TEXT.match(re);
    if (!m) {
      problems.push(`${label}: BUILD.md §10 has no line matching ${re}`);
      continue;
    }
    const says = pick(m);
    const has = gateValue(constName);
    if (says !== has) problems.push(`${label}: BUILD.md §10 says ${says}, tools/check-site.js ${constName} is ${has}`);
  }
  report('BUILD.md §10 states gate values that tools/check-site.js does not enforce', problems);
});

test('§2 ZIP counts: "42,354 ZIPs, 18,908 cities" match the ZIP_PACKED records and ZIP_CITIES in src/data/zips.js', () => {
  const m = firstMatch(/`midwire\/free_zipcode_data`: ([\d,]+) ZIPs, ([\d,]+) cities/, 'ZIP and city counts in the §2 table');
  const D = loadData(['src/data/zips.js']);
  const records = D.ZIP_PACKED.split(';').length;
  assert.equal(records, num(m[1]), `BUILD.md §2 says ${m[1]} ZIPs, src/data/zips.js ZIP_PACKED has ${records} records`);
  assert.equal(D.ZIP_CITIES.length, num(m[2]), `BUILD.md §2 says ${m[2]} cities, src/data/zips.js ZIP_CITIES has ${D.ZIP_CITIES.length}`);
});

test('§6 DEFAULTS: wear $0.1104/mi, electricity $0.1816/kWh, speed 27 mph and tips 15% / 0% match POD.data.DEFAULTS', () => {
  const wear = firstMatch(/Wear \$([\d.]+)\/mi/, 'wear default');
  const elec = firstMatch(/home electricity \$([\d.]+)\/kWh/, 'electricity default');
  const speed = firstMatch(/speed (\d+) mph/, 'speed default');
  const tips = firstMatch(/tips (\d+)% delivery \/ (\d+)% pickup/, 'tips default');
  const D = loadData(['src/data/defaults.js']).DEFAULTS;
  assert.equal(D.trip.wear, num(wear[1]), `BUILD.md §6 says wear $${wear[1]}/mi, DEFAULTS.trip.wear is ${D.trip.wear}`);
  assert.equal(D.trip.kwh, num(elec[1]), `BUILD.md §6 says electricity $${elec[1]}/kWh, DEFAULTS.trip.kwh is ${D.trip.kwh}`);
  assert.equal(D.trip.speed, num(speed[1]), `BUILD.md §6 says speed ${speed[1]} mph, DEFAULTS.trip.speed is ${D.trip.speed}`);
  assert.equal(D.tips.tipDel, num(tips[1]), `BUILD.md §6 says ${tips[1]}% delivery tip, DEFAULTS.tips.tipDel is ${D.tips.tipDel}`);
  assert.equal(D.tips.tipPick, num(tips[2]), `BUILD.md §6 says ${tips[2]}% pickup tip, DEFAULTS.tips.tipPick is ${D.tips.tipPick}`);
});

test('opening note: "every decision from D-001 to D-nnn" names the highest decision heading in decisions.md', () => {
  const m = firstMatch(/every decision from D-001 to D-(\d{3})\b/, 'decision range in the opening note');
  const dec = fs.readFileSync(path.join(DOCS, 'decisions.md'), 'utf8');
  const ids = [...dec.matchAll(/^\*\*D-(\d{3}) —/gm)].map((x) => num(x[1]));
  assert.ok(ids.length > 10, `decisions.md has ${ids.length} decision headings; expected more than 10`);
  const top = Math.max(...ids);
  assert.equal(num(m[1]), top, `BUILD.md says every decision from D-001 to D-${m[1]}, decisions.md's highest heading is D-${String(top).padStart(3, '0')}`);
});

test('§13 npm commands: each `npm run` in the block is a package.json script, and npm test runs those four in order', () => {
  const block = fencedBlocks().find((b) => b.lines.some((l) => l.startsWith('npm run test:es5')));
  assert.ok(block, 'BUILD.md §13 has no fenced block with npm run test:es5');
  const named = block.lines.filter((l) => /^npm run /.test(l)).map((l) => l.split(/\s+/)[2]);
  assert.equal(named.length, 4, `BUILD.md §13 lists ${named.length} npm run commands, expected the four stages`);
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
  const problems = named
    .filter((n) => !Object.prototype.hasOwnProperty.call(pkg.scripts, n))
    .map((n) => `BUILD.md §13 says npm run ${n}, package.json has no such script`);
  const inTest = [...pkg.scripts.test.matchAll(/npm run (\S+)/g)].map((m) => m[1]);
  if (JSON.stringify(inTest) !== JSON.stringify(named)) {
    problems.push(`BUILD.md §13 lists ${named.join(', ')} for npm test, package.json's test script runs ${inTest.join(', ')}`);
  }
  report('BUILD.md §13 npm commands differ from package.json', problems);
});

// ---------- 10. profile markup: the §6 sentence "every value today is the category default" ----------

test('§6 PROFILES markup: each profile has a markup key per platform, equal to its category default (markupEst true)', () => {
  const D = data();
  const P = D.PROFILES;
  assert.deepEqual(P.buffalo_wild_wings.platforms, [], 'BUILD.md §6 says Buffalo Wild Wings has no platforms; the repo has ' + JSON.stringify(P.buffalo_wild_wings.platforms));
  assert.deepEqual(P.buffalo_wild_wings.markup, {}, 'BUILD.md §6 says Buffalo Wild Wings has markup {}; the repo has ' + JSON.stringify(P.buffalo_wild_wings.markup));
  const why = 'BUILD.md §6 says every profile markup value is the category default today (markupEst true, ISS-012); if a profile now has a sourced markup, change that sentence';
  const problems = [];
  for (const id of Object.keys(P)) {
    const p = P[id];
    const cat = D.BRANDS[id] && D.BRANDS[id].category;
    const def = cat && D.CATEGORY_DEFAULTS[cat];
    if (!def) {
      problems.push(`${id}: no category default for ${cat}`);
      continue;
    }
    const keys = Object.keys(p.markup).sort();
    const plats = Array.from(p.platforms).sort();
    if (JSON.stringify(keys) !== JSON.stringify(plats)) {
      problems.push(`${id}: markup keys ${keys.join(',') || '(none)'}, platforms ${plats.join(',') || '(none)'}`);
    }
    for (const k of keys) {
      if (p.markup[k] !== def.markup[k]) problems.push(`${id}.markup.${k} is ${p.markup[k]}, ${cat} default is ${def.markup[k]}`);
    }
    if (p.markupEst !== true) problems.push(`${id}.markupEst is ${p.markupEst}, BUILD.md §6 says true`);
  }
  report(why, problems);
});
