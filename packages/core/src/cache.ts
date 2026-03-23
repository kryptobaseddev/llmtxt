/**
 * Generic LRU cache with TTL support and hit/miss statistics.
 *
 * Provider-agnostic — no framework dependencies.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

export interface LRUCacheOptions {
  /** Maximum number of entries (default: 1000). */
  maxSize?: number;
  /** Default TTL in milliseconds (default: 24 hours). */
  ttl?: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTtl: number;
  private stats: { hits: number; misses: number };

  constructor(options: LRUCacheOptions = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.ttl ?? 24 * 60 * 60 * 1000;
    this.stats = { hits: 0, misses: 0 };
  }

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

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  size(): number {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

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

  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}
