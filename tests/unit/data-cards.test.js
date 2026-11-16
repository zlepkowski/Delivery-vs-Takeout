// D-024 src/data/cards.js: which cards, which credits, and the shape. §9.1 tiers. §13 scenarios 2 and 3.
// Expected values come from D-024, BUILD.md §9.1 and §13, and the issuer facts in the task card.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadData } = require('../helpers/data');

const CARDS_REL = 'src/data/cards.js';
const ISSUER_DOMAIN = {
  'American Express': 'https://www.americanexpress.com/',
  Chase: 'https://creditcards.chase.com/',
  'Capital One': 'https://www.capitalone.com/',
};
const ISSUER_COUNTS = { 'American Express': 13, Chase: 7, 'Capital One': 2 };
const SLUG = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLATS = new Set(['direct', 'dd', 'ue', 'gh']);
const MEMBERSHIPS = new Set(['dd', 'ue', 'gh']);
const CADENCES = new Set(['monthly', 'quarterly', 'semiannual', 'annual']);
const CARD_KEYS = new Set(['id', 'issuer', 'name', 'url', 'asOf', 'membership', 'note', 'credits']);
const CREDIT_KEYS = new Set([
  'id', 'name', 'amount', 'cadence', 'plats', 'modes', 'goldPartner', 'restricted', 'locked', 'source', 'asOf', 'note',
]);

let cached = null;
function load() {
  if (!cached) cached = loadData([CARDS_REL]);
  return cached;
}
function cards() {
  const { CARDS } = load();
  assert.ok(Array.isArray(CARDS), 'POD.data.CARDS must be an array');
  return CARDS;
}
function allCredits() {
  return cards().flatMap((card) => (Array.isArray(card.credits) ? card.credits : []).map((credit) => ({ card, credit })));
}
function cardById(id) {
  const card = cards().find((c) => c.id === id);
  assert.ok(card, 'missing card ' + id);
  return card;
}
function creditOf(cardId, creditId) {
  const credit = cardById(cardId).credits.find((c) => c.id === creditId);
  assert.ok(credit, 'missing credit ' + cardId + '.' + creditId);
  return credit;
}
function creditsNamed(id) {
  return allCredits().filter(({ credit }) => credit.id === id);
}
function isDate(s) {
  return typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));
}
function isPositiveNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}
function nonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

// ---------------------------------------------------------------- shape (D-024)

test('D-024 CARDS is an array of 22 cards', () => {
  assert.equal(cards().length, 22);
});

test('D-024 card ids are unique and match the slug pattern', () => {
  const ids = cards().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate card id');
  const bad = ids.filter((id) => typeof id !== 'string' || !SLUG.test(id));
  assert.deepEqual(bad, [], 'card ids that do not match the slug pattern');
});

test('D-024 issuers are Amex, Chase and Capital One with 13, 7 and 2 cards', () => {
  const counts = {};
  for (const card of cards()) counts[card.issuer] = (counts[card.issuer] || 0) + 1;
  assert.deepEqual(counts, ISSUER_COUNTS);
});

test('D-024 card url starts with its issuer domain and asOf is a date', () => {
  const problems = [];
  for (const card of cards()) {
    const domain = ISSUER_DOMAIN[card.issuer];
    if (!domain) problems.push(card.id + ': unknown issuer ' + card.issuer);
    else if (typeof card.url !== 'string' || !card.url.startsWith(domain)) {
      problems.push(card.id + ': url ' + card.url + ' is not on ' + domain);
    }
    if (!isDate(card.asOf)) problems.push(card.id + ': asOf ' + card.asOf + ' is not YYYY-MM-DD');
  }
  assert.deepEqual(problems, []);
});

test('D-024 card membership, when present, is dd, ue or gh; credits is an array', () => {
  const problems = [];
  for (const card of cards()) {
    if ('membership' in card && !MEMBERSHIPS.has(card.membership)) {
      problems.push(card.id + ': membership ' + card.membership);
    }
    if (!Array.isArray(card.credits)) problems.push(card.id + ': credits is not an array');
  }
  assert.deepEqual(problems, []);
});

test('D-024 card has no keys outside id, issuer, name, url, asOf, membership, note, credits', () => {
  const problems = [];
  for (const card of cards()) {
    for (const key of Object.keys(card)) {
      if (!CARD_KEYS.has(key)) problems.push(card.id + ': unexpected key ' + key);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-024 credit ids are unique within their card and match the slug pattern', () => {
  const problems = [];
  for (const card of cards()) {
    const ids = card.credits.map((c) => c.id);
    if (new Set(ids).size !== ids.length) problems.push(card.id + ': duplicate credit id');
    for (const id of ids) {
      if (typeof id !== 'string' || !SLUG.test(id)) problems.push(card.id + ': credit id ' + id);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-024 every credit has a non-empty name, a positive amount and a valid cadence', () => {
  const problems = [];
  for (const { card, credit } of allCredits()) {
    const where = card.id + '.' + credit.id;
    if (!nonEmptyString(credit.name)) problems.push(where + ': name');
    if (!isPositiveNumber(credit.amount)) problems.push(where + ': amount ' + credit.amount);
    if (!CADENCES.has(credit.cadence)) problems.push(where + ': cadence ' + credit.cadence);
  }
  assert.deepEqual(problems, []);
});

test('D-024 every credit has plats as an array of direct, dd, ue or gh', () => {
  const problems = [];
  for (const { card, credit } of allCredits()) {
    const where = card.id + '.' + credit.id;
    if (!Array.isArray(credit.plats)) problems.push(where + ': plats is not an array');
    else {
      for (const p of credit.plats) if (!PLATS.has(p)) problems.push(where + ': plat ' + p);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-024 credit modes, when present, is exactly ["d"] or ["p"]', () => {
  const problems = [];
  for (const { card, credit } of allCredits()) {
    if (!('modes' in credit)) continue;
    const m = credit.modes;
    const ok = (Array.isArray(m) && m.length === 1 && (m[0] === 'd' || m[0] === 'p'));
    if (!ok) problems.push(card.id + '.' + credit.id + ': modes ' + JSON.stringify(m));
  }
  assert.deepEqual(problems, []);
});

test('D-024 credit source is an https URL on its card issuer domain, and asOf is a date', () => {
  const problems = [];
  for (const { card, credit } of allCredits()) {
    const where = card.id + '.' + credit.id;
    const domain = ISSUER_DOMAIN[card.issuer];
    if (typeof credit.source !== 'string' || !domain || !credit.source.startsWith(domain)) {
      problems.push(where + ': source ' + credit.source + ' is not on ' + domain);
    }
    if (!isDate(credit.asOf)) problems.push(where + ': asOf ' + credit.asOf);
  }
  assert.deepEqual(problems, []);
});

test('D-024 every credit has a non-empty note', () => {
  const problems = allCredits()
    .filter(({ credit }) => !nonEmptyString(credit.note))
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(problems, []);
});

test('D-024 credit has no keys outside the allowed set, and flags are booleans', () => {
  const problems = [];
  for (const { card, credit } of allCredits()) {
    const where = card.id + '.' + credit.id;
    for (const key of Object.keys(credit)) {
      if (!CREDIT_KEYS.has(key)) problems.push(where + ': unexpected key ' + key);
    }
    for (const flag of ['goldPartner', 'restricted', 'locked']) {
      if (flag in credit && typeof credit[flag] !== 'boolean') problems.push(where + ': ' + flag + ' is not a boolean');
    }
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------- tiers (§9.1, D-024)

test('§9.1 no credit is both restricted and locked', () => {
  const bad = allCredits()
    .filter(({ credit }) => credit.restricted === true && credit.locked === true)
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(bad, []);
});

test('§9.1 a locked credit has plats deep-equal to []', () => {
  const bad = allCredits()
    .filter(({ credit }) => credit.locked === true && !(Array.isArray(credit.plats) && credit.plats.length === 0))
    .map(({ card, credit }) => card.id + '.' + credit.id + ' plats=' + JSON.stringify(credit.plats));
  assert.deepEqual(bad, []);
});

test('§9.1 a restricted credit has non-empty plats so opting in has somewhere to apply', () => {
  const bad = allCredits()
    .filter(({ credit }) => credit.restricted === true && !(Array.isArray(credit.plats) && credit.plats.length > 0))
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(bad, []);
});

test('D-024 goldPartner is only set on a credit whose plats include gh', () => {
  const bad = allCredits()
    .filter(({ credit }) => credit.goldPartner === true && !credit.plats.includes('gh'))
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- behavior facts

test('§13 scenario 2 / §9.1 every Resy credit is restricted, and there are at least 4', () => {
  const resy = allCredits().filter(({ credit }) => /resy/i.test(credit.name));
  assert.ok(resy.length >= 4, 'expected at least 4 Resy credits, found ' + resy.length);
  const notRestricted = resy
    .filter(({ credit }) => credit.restricted !== true)
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(notRestricted, []);
});

test('§9.1 every rideshare credit is locked', () => {
  const found = creditsNamed('rideshare');
  assert.ok(found.length > 0, 'no rideshare credits found');
  const unlocked = found.filter(({ credit }) => credit.locked !== true).map(({ card }) => card.id);
  assert.deepEqual(unlocked, []);
});

test('D-024 exactly four cards carry a rideshare credit, all locked', () => {
  const ids = creditsNamed('rideshare').map(({ card }) => card.id).sort();
  assert.deepEqual(ids, [
    'amex_delta_gold', 'amex_delta_platinum', 'amex_delta_reserve', 'chase_sapphire_reserve',
  ]);
});

// Issuer-page table, read 2026-11-12. [card, credit, amount, cadence]
const ISSUER_TABLE = [
  ['amex_platinum', 'uber_cash', 15, 'monthly'],
  ['amex_platinum', 'resy', 100, 'quarterly'],
  ['amex_gold', 'dining', 10, 'monthly'],
  ['amex_gold', 'uber_cash', 10, 'monthly'],
  ['amex_gold', 'resy', 50, 'semiannual'],
  ['amex_gold', 'dunkin', 7, 'monthly'],
  ['amex_delta_gold', 'rideshare', 10, 'monthly'],
  ['amex_delta_platinum', 'rideshare', 10, 'monthly'],
  ['amex_delta_platinum', 'resy', 10, 'monthly'],
  ['amex_delta_reserve', 'rideshare', 10, 'monthly'],
  ['amex_delta_reserve', 'resy', 20, 'monthly'],
  ['amex_marriott_brilliant', 'dining', 25, 'monthly'],
  ['chase_sapphire_reserve', 'doordash_promo', 15, 'monthly'],
  ['chase_sapphire_reserve', 'doordash_nonrestaurant', 20, 'monthly'],
  ['chase_sapphire_reserve', 'rideshare', 10, 'monthly'],
  ['chase_sapphire_reserve', 'exclusive_tables', 150, 'semiannual'],
  ['chase_sapphire_preferred', 'doordash_nonrestaurant', 10, 'monthly'],
  ['chase_freedom_unlimited', 'doordash_nonrestaurant', 10, 'quarterly'],
  ['chase_freedom_flex', 'doordash_nonrestaurant', 10, 'quarterly'],
  ['chase_freedom_rise', 'doordash_nonrestaurant', 10, 'quarterly'],
  ['chase_ink_business_preferred', 'doordash_nonrestaurant', 10, 'monthly'],
];

test('D-024 every credit matches the issuer page', () => {
  const problems = [];
  for (const [cardId, creditId, amount, cadence] of ISSUER_TABLE) {
    const found = cardById(cardId).credits.find((c) => c.id === creditId);
    if (!found) {
      problems.push(cardId + '.' + creditId + ': missing');
      continue;
    }
    if (found.amount !== amount || found.cadence !== cadence) {
      problems.push(cardId + '.' + creditId + ': got ' + found.amount + ' ' + found.cadence +
        ', want ' + amount + ' ' + cadence);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(allCredits().length, ISSUER_TABLE.length, 'total credit count');
});

test('§9.1 every doordash_nonrestaurant credit is locked', () => {
  const found = creditsNamed('doordash_nonrestaurant');
  assert.ok(found.length > 0, 'no doordash_nonrestaurant credits found');
  const unlocked = found.filter(({ credit }) => credit.locked !== true).map(({ card }) => card.id);
  assert.deepEqual(unlocked, []);
});

test('§13 scenario 3 amex_gold has a goldPartner gh credit of 10 monthly that is not restricted or locked', () => {
  const c = creditOf('amex_gold', 'dining');
  assert.equal(c.goldPartner, true);
  assert.deepEqual(c.plats, ['gh']);
  assert.equal(c.amount, 10);
  assert.equal(c.cadence, 'monthly');
  assert.notEqual(c.restricted, true);
  assert.notEqual(c.locked, true);
});

test('D-024 amex_gold and amex_platinum each have a universal Uber Cash credit on ue', () => {
  const gold = creditOf('amex_gold', 'uber_cash');
  assert.deepEqual([gold.amount, gold.cadence, gold.plats], [10, 'monthly', ['ue']]);
  assert.notEqual(gold.restricted, true);
  assert.notEqual(gold.locked, true);
  const plat = creditOf('amex_platinum', 'uber_cash');
  assert.deepEqual([plat.amount, plat.cadence, plat.plats], [15, 'monthly', ['ue']]);
  assert.notEqual(plat.restricted, true);
  assert.notEqual(plat.locked, true);
});

test('D-024 membership: amex_platinum has no membership key (its Uber One credit needs a purchased membership); the seven Chase DoorDash cards are dd', () => {
  assert.equal('membership' in cardById('amex_platinum'), false);
  const ddCards = [
    'chase_sapphire_reserve', 'chase_sapphire_preferred', 'chase_freedom_unlimited',
    'chase_freedom_flex', 'chase_freedom_rise', 'chase_doordash_rewards', 'chase_ink_business_preferred',
  ];
  const wrong = ddCards.filter((id) => cardById(id).membership !== 'dd');
  assert.deepEqual(wrong, []);
});

test('D-024 under-crediting: chase_sapphire_reserve doordash_promo is universal, dd, delivery only, 15 monthly', () => {
  const c = creditOf('chase_sapphire_reserve', 'doordash_promo');
  assert.deepEqual(c.plats, ['dd']);
  assert.deepEqual(c.modes, ['d']);
  assert.equal(c.amount, 15);
  assert.equal(c.cadence, 'monthly');
  assert.notEqual(c.restricted, true);
  assert.notEqual(c.locked, true);
});

test('D-024 capital_one_venture_x and capital_one_savor have no credits', () => {
  assert.deepEqual(cardById('capital_one_venture_x').credits, []);
  assert.deepEqual(cardById('capital_one_savor').credits, []);
});

test('§9.1 no universal credit applies direct except on amex_marriott_brilliant', () => {
  const universalDirect = allCredits().filter(({ credit }) =>
    credit.restricted !== true && credit.locked !== true && credit.plats.includes('direct'));
  const elsewhere = universalDirect
    .filter(({ card }) => card.id !== 'amex_marriott_brilliant')
    .map(({ card, credit }) => card.id + '.' + credit.id);
  assert.deepEqual(elsewhere, []);
  assert.ok(universalDirect.some(({ card }) => card.id === 'amex_marriott_brilliant'),
    'expected the Marriott Brilliant dining credit to be the universal direct credit');
});
