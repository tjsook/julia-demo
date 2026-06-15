const TTL_MS = 3 * 60 * 1000;
const BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

type CacheEntry = { data: unknown; ts: number };
const store = new Map<string, CacheEntry>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function cacheSet(key: string, data: unknown): void {
  store.set(key, { data, ts: Date.now() });
}

export function cacheInvalidate(...keys: string[]): void {
  for (const key of keys) store.delete(key);
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export const CACHE_KEYS = {
  PIPELINE_SUMMARY: "/pipeline/summary?include_stuck_count=false",
  PIPELINE_STUCK: "/pipeline/stuck-deals?threshold_days=5",
  PIPELINE_MONITORING: "/pipeline/monitoring",
  FUELING_SUMMARY: "/fueling/summary",
  REP_PERFORMANCE: "/rep-performance/summary",
  FUELING_ATTRIBUTION: "/fueling-attribution/summary",
  PROGRAM_METRICS: "/program/summary",
  PROGRAM_SAVINGS: "/program/savings-summary",
  // Commission endpoints — Lane 3: use cacheGet(CACHE_KEYS.X) before fetch for warm-cache
  // short-circuit. For dynamic keys (per-month, per-rep) build inline, e.g.:
  //   const key = `/commission/reconciliations/${month}/summary`;
  //   const cached = cacheGet<CommissionMonthSummary>(key);
  // After any commission write, call cacheInvalidatePrefix("/commission/") to bust all entries.
  COMMISSION_RECONCILIATIONS: "/commission/reconciliations",
  COMMISSION_ROLLOFF: "/commission/program/rolloff-projection",
  COMMISSION_REPS_DIRECTORY: "/commission/reps-directory",
} as const;

export function installFetchCache(): void {
  const original = globalThis.fetch;

  globalThis.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (method !== "GET" || !url.startsWith(BASE_URL)) {
      return original(input, init);
    }

    const key = url.slice(BASE_URL.length);
    const cached = cacheGet<unknown>(key);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await original(input, init);
    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await res.clone().json();
        cacheSet(key, data);
      }
    }
    return res;
  };
}
