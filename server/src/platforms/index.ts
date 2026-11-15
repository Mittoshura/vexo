import type { PlatformId } from '../../../shared/platforms.js';
import type { Adapter } from './types.js';
import { pixiv } from './pixiv.js';
import { deviantart } from './deviantart.js';
import { civitai } from './civitai.js';
import { x } from './x.js';
import { subscribestar } from './subscribestar.js';

export const ADAPTERS: Partial<Record<PlatformId, Adapter>> = { pixiv, deviantart, civitai, x, subscribestar };
export const isImplemented = (p: PlatformId) => p in ADAPTERS;

// Test mode: `ARTPOST_MOCK=1` → simulated platforms (no network calls), for testing the queue.
if (process.env.ARTPOST_MOCK === '1') {
  for (const [id, real] of Object.entries(ADAPTERS) as [PlatformId, Adapter][]) {
    ADAPTERS[id] = {
      ...real,
      async checkLogin() {
        return { connected: true, username: 'mock_user' };
      },
      async post(_ctx, input, log) {
        log(`[MOCK] ${input.files.length} file(s), title "${input.meta.title}", tags ${input.meta.tags.join('/')}, nsfw ${input.nsfw}, options ${JSON.stringify(input.options)}`);
        await new Promise((r) => setTimeout(r, 1500));
        if (input.meta.title.includes('FAIL')) throw new Error('[MOCK] simulated failure');
        const url = {
          pixiv: 'https://www.pixiv.net/artworks/123456',
          deviantart: 'https://www.deviantart.com/mock_user/art/mock-123456',
          civitai: 'https://civitai.red/posts/123456',
          x: 'https://x.com/mock_user/status/123456',
          subscribestar: 'https://subscribestar.adult/posts/123456',
        }[id];
        return { url, remoteId: '123456', raw: { mock: true } };
      },
    };
  }
}
