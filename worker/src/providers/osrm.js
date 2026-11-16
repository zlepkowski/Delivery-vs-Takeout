// OSRM adapter (docs/api-contract.md §2). route() resolves one of:
//   {ok: {miles, minutes, source: "osrm"}} | {miss: "no_route"} | {error: "upstream"}
import { getUpstream, isObject, nonNegative, round1, round2 } from "../util.js";

export const TIMEOUT_MS = 3500;

export async function route(fetchFn, base, userAgent, from, to) {
  const url =
    `${base}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
    "?overview=false&alternatives=false&steps=false";
  const r = await getUpstream(fetchFn, url, userAgent, TIMEOUT_MS);
  if (r === null || !r.json || !isObject(r.body)) return { error: "upstream" };
  if (r.body.code === "NoRoute") return { miss: "no_route" };
  if (r.status !== 200 || r.body.code !== "Ok") return { error: "upstream" };
  const first = Array.isArray(r.body.routes) ? r.body.routes[0] : undefined;
  if (!isObject(first) || !nonNegative(first.distance) || !nonNegative(first.duration)) {
    return { error: "upstream" };
  }
  return {
    ok: {
      miles: round2(first.distance / 1609.344),
      minutes: round1(first.duration / 60),
      source: "osrm",
    },
  };
}
