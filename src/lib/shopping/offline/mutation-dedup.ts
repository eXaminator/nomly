const CAPACITY = 256;
const TTL_MS = 10 * 60 * 1000;

type Entry = { value: unknown; recordedAt: number };

const cache = new Map<string, Entry>();

export function recordMutation(
  mutationId: string,
  value: unknown,
  recordedAt: number = Date.now(),
): void {
  if (cache.has(mutationId)) cache.delete(mutationId);
  cache.set(mutationId, { value, recordedAt });
  while (cache.size > CAPACITY) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function recallMutation<T = unknown>(mutationId: string): T | null {
  const entry = cache.get(mutationId);
  if (!entry) return null;
  if (Date.now() - entry.recordedAt > TTL_MS) {
    cache.delete(mutationId);
    return null;
  }
  // Refresh insertion order so frequent reuses behave LRU-ish.
  cache.delete(mutationId);
  cache.set(mutationId, entry);
  return entry.value as T;
}

export function __resetMutationCacheForTests(): void {
  cache.clear();
}
