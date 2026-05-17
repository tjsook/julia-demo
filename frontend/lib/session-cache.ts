const TTL_MS = 3 * 60 * 1000;

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

export const CACHE_KEYS = {
  PIPELINE_SUMMARY: "pipeline:summary",
  PIPELINE_STUCK: "pipeline:stuck-deals:threshold=5",
  PIPELINE_MONITORING: "pipeline:monitoring",
  FUELING_SUMMARY: "fueling:summary",
  REP_PERFORMANCE: "rep-performance:summary",
  FUELING_ATTRIBUTION: "fueling-attribution:summary",
  PROGRAM_METRICS: "program:summary",
  PROGRAM_SAVINGS: "program:savings-summary",
} as const;
