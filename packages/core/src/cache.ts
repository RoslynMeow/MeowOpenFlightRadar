import { LRUCache } from 'lru-cache';

/** 简单的 TTL + LRU 缓存。 */
export class TTLCache<K extends {}, V extends {}> {
  private cache: LRUCache<K, V>;

  constructor(ttlMs: number, max = 500) {
    this.cache = new LRUCache<K, V>({ ttl: ttlMs, max });
  }

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  set(key: K, value: V): void {
    this.cache.set(key, value);
  }
}
