// Overpass adapter (docs/api-contract.md §4): independent restaurants near a point.
// places() resolves one of: {ok: {places, radius, source: "osm"}} | {error: "upstream"}
import { distMi, finiteIn, getUpstream, isObject, round2 } from "../util.js";

export const TIMEOUT_MS = 9000;
export const MAX_PLACES = 40;

const AMENITIES = ["restaurant", "fast_food", "cafe", "ice_cream"];

// D-021's cuisine rule: the first ;-token of tags.cuisine, trimmed and lowercased (§4 step 6).
const CUISINE = new Map([
  ["pizza", "pizza"],
  ["burger", "burger"],
  ["chicken", "chicken"],
  ["wings", "chicken"],
  ["fried_chicken", "chicken"],
  ["mexican", "mexican"],
  ["tex-mex", "mexican"],
  ["tacos", "mexican"],
  ["burrito", "mexican"],
  ["sandwich", "sandwich"],
  ["sub", "sandwich"],
  ["deli", "sandwich"],
  ["bagel", "sandwich"],
  ["chinese", "asian"],
  ["japanese", "asian"],
  ["asian", "asian"],
  ["sushi", "asian"],
  ["thai", "asian"],
  ["korean", "asian"],
  ["vietnamese", "asian"],
  ["indian", "asian"],
  ["ramen", "asian"],
  ["noodle", "asian"],
  ["coffee_shop", "coffee"],
  ["coffee", "coffee"],
  ["donut", "coffee"],
  ["tea", "coffee"],
  ["bubble_tea", "coffee"],
  ["ice_cream", "dessert"],
  ["frozen_yogurt", "dessert"],
  ["dessert", "dessert"],
  ["cake", "dessert"],
  ["cookies", "dessert"],
  ["juice", "dessert"],
  ["smoothie", "dessert"],
]);

const BY_AMENITY = new Map([
  ["restaurant", "casual"],
  ["cafe", "coffee"],
  ["ice_cream", "dessert"],
  ["fast_food", "other"],
]);

const TYPE_LETTER = new Map([
  ["node", "n"],
  ["way", "w"],
  ["relation", "r"],
]);

function nonEmptyString(v) {
  return typeof v === "string" && v !== "";
}

function categoryOf(tags) {
  const token = typeof tags.cuisine === "string" ? tags.cuisine.split(";")[0].trim().toLowerCase() : "";
  return CUISINE.get(token) || BY_AMENITY.get(tags.amenity);
}

// Steps 1–6 and 8 for one element: the place with its distance, or null to skip it.
function placeOf(el, qLat, qLon, radius) {
  if (!isObject(el) || !TYPE_LETTER.has(el.type)) return null;
  if (!Number.isSafeInteger(el.id) || el.id < 1 || !isObject(el.tags)) return null;
  const tags = el.tags;
  const pt = el.type === "node" ? el : el.center;
  if (!isObject(pt) || !finiteIn(pt.lat, 90) || !finiteIn(pt.lon, 180)) return null;
  const name = typeof tags.name === "string" ? tags.name.trim() : null;
  if (name === null) return null;
  if (name.length < 1 || name.length > 120) return null;
  if (nonEmptyString(tags.brand) || nonEmptyString(tags["brand:wikidata"])) return null;
  if (!AMENITIES.includes(tags.amenity)) return null;
  const d = distMi(qLat, qLon, pt.lat, pt.lon);
  if (d === null || d > radius) return null;
  return {
    id: "osm:" + TYPE_LETTER.get(el.type) + el.id,
    name,
    category: categoryOf(tags),
    lat: pt.lat,
    lon: pt.lon,
    d,
  };
}

export async function places(fetchFn, base, userAgent, lat, lon, radius) {
  const M = Math.round(radius * 1609.344);
  const Q =
    '[out:json][timeout:8];nwr["amenity"~"^(restaurant|fast_food|cafe|ice_cream)$"]' +
    `["name"](around:${M},${lat},${lon});out center tags;`;
  const params = new URLSearchParams([["data", Q]]);
  const r = await getUpstream(fetchFn, `${base}?${params.toString()}`, userAgent, TIMEOUT_MS);
  if (r === null || r.status !== 200 || !r.json || !isObject(r.body) || !Array.isArray(r.body.elements)) {
    return { error: "upstream" };
  }
  // A timed-out query comes back with partial results and a remark (status 200): a partial list is a failure.
  if (typeof r.body.remark === "string" && r.body.remark.includes("runtime error")) return { error: "upstream" };

  const kept = [];
  const seen = new Set();
  for (const el of r.body.elements) {
    const p = placeOf(el, lat, lon, radius);
    if (p === null || seen.has(p.id)) continue;
    seen.add(p.id);
    kept.push(p);
  }
  kept.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    ok: {
      places: kept.slice(0, MAX_PLACES).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        lat: p.lat,
        lon: p.lon,
        miles: round2(p.d),
      })),
      radius,
      source: "osm",
    },
  };
}
