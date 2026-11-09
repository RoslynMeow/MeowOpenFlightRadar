import { describe, expect, it } from 'vitest';
import { TTLCache } from './cache';

describe('TTLCache', () => {
  it('stores and returns values', () => {
    const cache = new TTLCache<string, number>(1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires values after the ttl', async () => {
    const cache = new TTLCache<string, number>(10);
    cache.set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cache.get('a')).toBeUndefined();
  });
});
