import { describe, expect, it } from 'vitest';
import { createCore } from './app.js';

describe('/health', () => {
  it('reports upstream status and providers', async () => {
    const core = createCore({ provider: 'adsb' });
    try {
      const res = await core.app.request('/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        upstream: { provider: string };
        providers: { id: string }[];
      };
      expect(body.ok).toBe(true);
      expect(body.upstream.provider).toBeTruthy();
      expect(body.providers.some((p) => p.id === 'adsb')).toBe(true);
    } finally {
      await core.dispose();
    }
  });
});
