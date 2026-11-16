// Shared helpers for the Worker (docs/api-contract.md §1–§4): JSON and error responses, CORS,
// parameters, coordinates, rounding, the great-circle distance and one upstream GET.
// ES2022 module, no dependencies.

export const R_MI = 3958.8;

// One fixed English sentence per error code (§1).
export const MESSAGES = {
  bad_param: "A parameter is missing, repeated, malformed or out of range.",
  too_far: "The two points are more than 100 miles apart in a straight line.",
  no_endpoint: "There is no such endpoint. The endpoints are /drive, /geocode and /nearby.",
  no_route: "The map server found no driving route between the two points.",
  not_found: "The map server found no address for that query.",
  method: "Only GET and OPTIONS requests are allowed.",
  upstream: "The map server failed or didn't answer in time. Try again later.",
  not_configured: "The Worker has no USER_AGENT yet, so it can't ask the map servers.",
};

export function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function finiteIn(v, limit) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
}

export function nonNegative(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

// CORS (§1): the origin is echoed only for "null" or an exact ALLOW_ORIGINS entry.
export function allowedOrigin(origin, env) {
  if (typeof origin !== "string") return null;
  if (origin === "null") return origin;
  const list = String(env.ALLOW_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return list.includes(origin) ? origin : null;
}

export function corsHeaders(origin, env) {
  const allow = allowedOrigin(origin, env);
  const headers = { Vary: "Origin" };
  if (allow !== null) headers["Access-Control-Allow-Origin"] = allow;
  return headers;
}

export function jsonResponse(status, body, origin, env, extra) {
  const headers = Object.assign(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    corsHeaders(origin, env),
    extra || {}
  );
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(code, status, origin, env, extra) {
  return jsonResponse(status, { error: { code, message: MESSAGES[code] } }, origin, env, extra);
}

// The one value of a named parameter, or null when it's missing or given twice (§1).
export function oneParam(params, name) {
  const all = params.getAll(name);
  return all.length === 1 ? all[0] : null;
}

const COORD_RE = /^-?[0-9]{1,3}(\.[0-9]{1,6})?$/;

// A coordinate's number (its canonical string is String(n)), or null. `limit` is 90 for a
// latitude and 180 for a longitude (§1).
export function coordinate(s, limit) {
  if (typeof s !== "string" || !COORD_RE.test(s)) return null;
  const n = Number(s);
  return finiteIn(n, limit) ? n : null;
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}

// Great-circle miles, exactly geography contract §2 (R_MI 3958.8).
export function distMi(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const a = s1 * s1 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * s2 * s2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

// One GET to a provider (§2–§4): every call carries the User-Agent and a timeout.
// Resolves {status, json, body} (json false when the body isn't JSON), or null when the
// fetch rejected or timed out.
export async function getUpstream(fetchFn, url, userAgent, timeoutMs) {
  try {
    const res = await fetchFn(url, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    try {
      return { status: res.status, json: true, body: JSON.parse(text) };
    } catch (e) {
      return { status: res.status, json: false, body: undefined };
    }
  } catch (e) {
    return null;
  }
}
