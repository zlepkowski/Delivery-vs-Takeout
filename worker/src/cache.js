// Workers KV helpers (docs/api-contract.md §5). A stored value is {ok: body} or {miss: code}.
// Each get and put is raced against its own 1,000 ms timer. A call that throws, rejects or hasn't
// settled by then is ignored: the request goes on as if uncached, and never hangs on the cache.

const KV_TIMEOUT_MS = 1000;
const GAVE_UP = {};

export async function sha256Hex(text) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Resolves the call's result, or GAVE_UP after `ms`. Synchronous throws become rejections.
// The timer is cleared as soon as the call settles first.
function raceKV(call, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(GAVE_UP), ms);
  });
  return Promise.race([Promise.resolve().then(call), timeout]).finally(() => clearTimeout(timer));
}

// The stored {ok} or {miss} object, or null (absent, unreadable, late, or a shape we don't write).
export async function cacheGet(kv, key) {
  if (!kv) return null;
  try {
    const v = await raceKV(() => kv.get(key, "json"), KV_TIMEOUT_MS);
    if (v === GAVE_UP || v === null || typeof v !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(v, "ok")) return v;
    if (typeof v.miss === "string") return v;
    return null;
  } catch (e) {
    return null;
  }
}

// Stores a value; a put that throws or is late is skipped, and the answer goes out either way.
export async function cachePut(kv, key, value, ttl) {
  if (!kv) return;
  try {
    await raceKV(() => kv.put(key, JSON.stringify(value), { expirationTtl: ttl }), KV_TIMEOUT_MS);
  } catch (e) {
    // ignored
  }
}
