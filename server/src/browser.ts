import { chromium, type BrowserContext } from 'playwright';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');

let ctx: BrowserContext | null = null;
let ctxHidden = false;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Always windowed: Pixiv (Cloudflare) blocks headless Edge ("Just a moment…").
 * `hidden` moves the window off-screen instead of truly hiding it.
 */
async function open(hidden: boolean): Promise<BrowserContext> {
  if (ctx && ctxHidden === hidden) return ctx;
  await close();
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled', ...(hidden ? ['--window-position=-32000,-32000', '--window-size=1280,900'] : [])],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  ctx.on('close', () => {
    ctx = null;
  });
  ctxHidden = hidden;
  return ctx;
}

export async function close() {
  if (ctx) {
    const c = ctx;
    ctx = null;
    await c.close().catch(() => {});
  }
}

/**
 * Runs `fn` with the browser context (persistent profile = sessions kept).
 * Serialized: never two operations in parallel on the same profile.
 */
export function withBrowser<T>(hidden: boolean, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const run = chain.then(
    async () => {
      const c = await open(hidden);
      return fn(c);
    },
    async () => {
      const c = await open(hidden);
      return fn(c);
    },
  );
  chain = run.catch(() => {});
  return run;
}

/** Deletes a domain's cookies (logout). */
export async function clearCookies(domainPart: string) {
  await withBrowser(true, async (c) => {
    // (off-screen: just a cookie cleanup)
    const cookies = await c.cookies();
    await c.clearCookies();
    await c.addCookies(cookies.filter((k) => !k.domain.includes(domainPart)));
  });
}
