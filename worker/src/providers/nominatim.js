// Nominatim adapter (docs/api-contract.md §3). geocode() resolves one of:
//   {ok: {lat, lon, city, state, zip, label, source: "nominatim"}} | {miss: "not_found"} | {error: "upstream"}
import { getUpstream, isObject, finiteIn } from "../util.js";

export const TIMEOUT_MS = 3500;

// Nominatim's lat/lon (§3): a finite number, or a string matching ^-?[0-9]+(\.[0-9]+)?$,
// converted with Number and range-checked. Anything else is refused (so "", null, "0x28",
// " 40.7" and "Infinity" are rejected).
const NOMINATIM_COORD_RE = /^-?[0-9]+(\.[0-9]+)?$/;

function coordOf(v, limit) {
  let n;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && NOMINATIM_COORD_RE.test(v)) {
    n = Number(v);
  } else {
    return null;
  }
  return finiteIn(n, limit) ? n : null;
}

function cityOf(a) {
  for (const k of ["city", "town", "village", "hamlet"]) {
    if (typeof a[k] === "string" && a[k] !== "") return a[k];
  }
  return null;
}

function stateOf(a) {
  const v = a["ISO3166-2-lvl4"];
  const m = typeof v === "string" ? /^US-([A-Z]{2})$/.exec(v) : null;
  return m ? m[1] : null;
}

function zipOf(a) {
  const v = a.postcode;
  return typeof v === "string" && /^[0-9]{5}/.test(v) ? v.slice(0, 5) : null;
}

export async function geocode(fetchFn, base, userAgent, q) {
  const params = new URLSearchParams([
    ["q", q],
    ["format", "jsonv2"],
    ["addressdetails", "1"],
    ["limit", "1"],
    ["countrycodes", "us"],
  ]);
  const r = await getUpstream(fetchFn, `${base}/search?${params.toString()}`, userAgent, TIMEOUT_MS);
  if (r === null || r.status !== 200 || !r.json || !Array.isArray(r.body)) return { error: "upstream" };
  if (r.body.length === 0) return { miss: "not_found" };
  const hit = r.body[0];
  if (!isObject(hit) || !isObject(hit.address)) return { error: "upstream" };
  const lat = coordOf(hit.lat, 90);
  const lon = coordOf(hit.lon, 180);
  if (lat === null || lon === null) return { error: "upstream" };
  return {
    ok: {
      lat,
      lon,
      city: cityOf(hit.address),
      state: stateOf(hit.address),
      zip: zipOf(hit.address),
      label: typeof hit.display_name === "string" ? hit.display_name : null,
      source: "nominatim",
    },
  };
}
