// The Worker's router (docs/api-contract.md §0–§5, D-040). handle() is pure apart from the injected
// deps.fetch; the default export wires it to the real fetch.
// Order of checks per request: method/path, USER_AGENT (503), parameters (400), KV cache (§5), provider.
import { cacheGet, cachePut, sha256Hex } from "./cache.js";
import { coordinate, corsHeaders, distMi, errorResponse, jsonResponse, oneParam } from "./util.js";
import * as osrm from "./providers/osrm.js";
import * as nominatim from "./providers/nominatim.js";
import * as overpass from "./providers/overpass.js";

const DEFAULTS = {
  OSRM_URL: "https://router.project-osrm.org",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org",
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
};

const DRIVE_MAX_MI = 100;
const RADII = new Set(["2", "5", "10"]);
const TTL = {
  drive: { ok: 604800, miss: 86400 },
  geocode: { ok: 2592000, miss: 86400 },
  nearby: { ok: 604800 },
};

// The provider's base URL with trailing slashes removed (§0).
function baseOf(env, name) {
  return String(env[name] || DEFAULTS[name]).replace(/\/+$/, "");
}

function isConfigured(userAgent) {
  return typeof userAgent === "string" && userAgent.trim() !== "";
}

// A "LAT,LON" pair as numbers, or null (§2).
function pairOf(s) {
  if (typeof s !== "string") return null;
  const parts = s.split(",");
  if (parts.length !== 2) return null;
  const lat = coordinate(parts[0], 90);
  const lon = coordinate(parts[1], 180);
  return lat === null || lon === null ? null : { lat, lon };
}

// geoQuery's server twin (§3): trimmed, whitespace runs collapsed, 3–200 characters, no control characters.
function normalizeQuery(raw) {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/\s+/g, " ");
  if (q.length < 3 || q.length > 200) return null;
  if (/[\u0000-\u001f]/.test(q)) return null;
  return q;
}

// Serves one cached-or-fetched answer (§5). `run` resolves {ok}, {miss} or {error}.
async function serve(spec) {
  const { kv, key, ttl, misses, run, origin, env } = spec;
  const cached = await cacheGet(kv, key);
  if (cached !== null && Object.prototype.hasOwnProperty.call(cached, "ok")) {
    return jsonResponse(200, cached.ok, origin, env);
  }
  if (cached !== null && misses.includes(cached.miss)) {
    return errorResponse(cached.miss, 404, origin, env);
  }
  const result = await run();
  if (Object.prototype.hasOwnProperty.call(result, "ok")) {
    await cachePut(kv, key, { ok: result.ok }, ttl.ok);
    return jsonResponse(200, result.ok, origin, env);
  }
  if (typeof result.miss === "string") {
    await cachePut(kv, key, { miss: result.miss }, ttl.miss);
    return errorResponse(result.miss, 404, origin, env);
  }
  return errorResponse("upstream", 502, origin, env);
}

async function drive(ctx) {
  const { params, origin, env, kv, fetchFn } = ctx;
  const from = pairOf(oneParam(params, "from"));
  const to = pairOf(oneParam(params, "to"));
  if (from === null || to === null) return errorResponse("bad_param", 400, origin, env);
  const straight = distMi(from.lat, from.lon, to.lat, to.lon);
  if (straight === null || straight > DRIVE_MAX_MI) return errorResponse("too_far", 400, origin, env);
  return serve({
    kv,
    key: `v1:drive:${from.lat},${from.lon};${to.lat},${to.lon}`,
    ttl: TTL.drive,
    misses: ["no_route"],
    origin,
    env,
    run: () => osrm.route(fetchFn, baseOf(env, "OSRM_URL"), env.USER_AGENT, from, to),
  });
}

async function geocode(ctx) {
  const { params, origin, env, kv, fetchFn } = ctx;
  const q = normalizeQuery(oneParam(params, "q"));
  if (q === null) return errorResponse("bad_param", 400, origin, env);
  return serve({
    kv,
    key: "v1:geocode:" + (await sha256Hex(q.toLowerCase())),
    ttl: TTL.geocode,
    misses: ["not_found"],
    origin,
    env,
    run: () => nominatim.geocode(fetchFn, baseOf(env, "NOMINATIM_URL"), env.USER_AGENT, q),
  });
}

async function nearby(ctx) {
  const { params, origin, env, kv, fetchFn } = ctx;
  const lat = coordinate(oneParam(params, "lat"), 90);
  const lon = coordinate(oneParam(params, "lon"), 180);
  const rs = oneParam(params, "radius");
  if (lat === null || lon === null || rs === null || !RADII.has(rs)) {
    return errorResponse("bad_param", 400, origin, env);
  }
  const radius = Number(rs);
  return serve({
    kv,
    key: `v1:nearby:${lat},${lon}/${radius}`,
    ttl: TTL.nearby,
    misses: [],
    origin,
    env,
    run: () => overpass.places(fetchFn, baseOf(env, "OVERPASS_URL"), env.USER_AGENT, lat, lon, radius),
  });
}

const ENDPOINTS = new Map([
  ["/drive", drive],
  ["/geocode", geocode],
  ["/nearby", nearby],
]);

export async function handle(request, env, deps) {
  const e = env || {};
  const fetchFn = (deps && deps.fetch) || globalThis.fetch;
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: Object.assign(corsHeaders(origin, e), {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age": "86400",
      }),
    });
  }
  if (request.method !== "GET") {
    return errorResponse("method", 405, origin, e, { Allow: "GET, OPTIONS" });
  }
  const endpoint = ENDPOINTS.get(url.pathname);
  if (endpoint === undefined) return errorResponse("no_endpoint", 404, origin, e);
  if (!isConfigured(e.USER_AGENT)) return errorResponse("not_configured", 503, origin, e);

  return endpoint({
    params: url.searchParams,
    origin,
    env: e,
    kv: e.POD_CACHE,
    fetchFn,
  });
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, { fetch: globalThis.fetch, now: Date.now });
  },
};
