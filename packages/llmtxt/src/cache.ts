/**
 * Generic LRU cache with TTL support and hit/miss statistics.
 *
 * Provider-agnostic — no framework dependencies.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Snapshot of cache performance statistics.
 *
 * @remarks
 * Returned by {@link LRUCache.getStats}. The `hitRate` is calculated as
 * `(hits / (hits + misses)) * 100` and rounded to two decimal places.
 */
export interface CacheStats {
  /** Total number of cache hits since last reset. */
  hits: number;
  /** Total number of cache misses since last reset. */
  misses: number;
  /** Current number of live (non-expired) entries in the cache. */
  size: number;
  /** Maximum number of entries the cache can hold. */
  maxSize: number;
  /** Hit rate as a percentage (0-100), rounded to two decimal places. */
  hitRate: number;
}

/**
 * Configuration options for constructing an {@link LRUCache} instance.
 *
 * @remarks
 * All fields are optional and have sensible defaults: 1000 entries max
 * and a 24-hour TTL.
 */
export interface LRUCacheOptions {
  /** Maximum number of entries before the least-recently-used entry is evicted (default: 1000). */
  maxSize?: number;
  /** Default time-to-live in milliseconds for new entries (default: 24 hours). */
  ttl?: number;
}

/**
 * Generic least-recently-used (LRU) cache with time-to-live support.
 *
 * @remarks
 * Backed by a `Map` whose insertion order doubles as the LRU eviction
 * order. Expired entries are lazily evicted on access. The cache tracks
 * hit/miss statistics for observability.
 *
 * @typeParam T - The type of cached values.
 *
 * @example
 * ```ts
 * const cache = new LRUCache<string>({ maxSize: 100, ttl: 60_000 });
 * cache.set('key', 'value');
 * cache.get('key'); // "value"
 * ```
 */
export class LRUCache<T> {
  /** Internal map storing cache entries in insertion (LRU) order. */
  private cache: Map<string, CacheEntry<T>>;
  /** Maximum number of entries before eviction. */
  private maxSize: number;
  /** Default time-to-live in milliseconds for new entries. */
  private defaultTtl: number;
  /** Running hit/miss counters for observability. */
  private stats: { hits: number; misses: number };

  /**
   * Create a new LRU cache.
   *
   * @remarks
   * When no options are provided the cache defaults to 1000 entries max
   * and a 24-hour TTL.
   *
   * @param options - Optional configuration for max size and TTL.
   */
  constructor(options: LRUCacheOptions = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.ttl ?? 24 * 60 * 60 * 1000;
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Retrieve a cached value by key.
   *
   * @remarks
   * Returns `undefined` and increments the miss counter when the key is
   * absent or its entry has expired. On a hit the entry is promoted to
   * most-recently-used position.
   *
   * @param key - The cache key to look up.
   * @returns The cached value, or `undefined` on miss or expiration.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Insert or update a cache entry.
   *
   * @remarks
   * If the cache is at capacity, the least-recently-used entry is evicted
   * before the new entry is inserted. An existing entry with the same key
   * is replaced (and its TTL is reset).
   *
   * @param key - The cache key.
   * @param value - The value to cache.
   * @param ttl - Optional per-entry TTL in milliseconds (overrides default).
   */
  set(key: string, value: T, ttl?: number): void {
    const effectiveTtl = ttl ?? this.defaultTtl;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + effectiveTtl,
    };

    this.cache.delete(key);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }

  /**
   * Remove a single entry from the cache by key.
   *
   * @remarks
   * No-op if the key does not exist. Does not affect hit/miss statistics.
   *
   * @param key - The cache key to remove.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Remove all entries from the cache and reset hit/miss statistics.
   *
   * @remarks
   * After calling `clear()`, both the entry map and the hit/miss counters
   * are zeroed, returning the cache to its initial state.
   */
  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  /**
   * Return the number of live (non-expired) entries in the cache.
   *
   * @remarks
   * Performs a lazy sweep to remove expired entries before counting.
   *
   * @returns The current number of live entries.
   */
  size(): number {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }

  /**
   * Check whether a non-expired entry exists for the given key.
   *
   * @remarks
   * Expired entries are lazily evicted during this check. This method does
   * not promote the entry to most-recently-used position.
   *
   * @param key - The cache key to check.
   * @returns `true` if a live entry exists, `false` otherwise.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Retrieve a snapshot of cache performance statistics.
   *
   * @remarks
   * Triggers a lazy sweep of expired entries (via {@link LRUCache.size})
   * so that the reported `size` reflects only live entries.
   *
   * @returns A {@link CacheStats} object with hits, misses, size, and hit rate.
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.size(),
      maxSize: this.maxSize,
      hitRate: total > 0 ? parseFloat(((this.stats.hits / total) * 100).toFixed(2)) : 0,
    };
  }

  /**
   * Reset the hit/miss counters to zero without clearing cached entries.
   *
   * @remarks
   * Useful for measuring hit rate over a specific time window without
   * evicting any cached data.
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}
