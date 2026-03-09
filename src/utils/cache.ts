// LRU cache implementation

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private ttl: number;

  constructor(ttlSeconds: number = 3600) {
    this.cache = new Map();
    this.ttl = ttlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  set(key: string, value: T): void {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + this.ttl,
    };
    
    // Remove if exists to update position
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const cache = new LRUCache<string>(parseInt(process.env.CACHE_TTL || '3600', 10));
