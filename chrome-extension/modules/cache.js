// In-memory cache with TTL expiration

import { CACHE_TTL_MS } from "./constants.js";

const store = new Map();

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache(key, data) {
  store.set(key, { data, ts: Date.now() });
}

export function clearCache() {
  store.clear();
}
