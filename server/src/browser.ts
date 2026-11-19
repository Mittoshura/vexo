import { chromium, type BrowserContext } from 'playwright';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');

/**
 * Browser used by Playwright. `VEXO_BROWSER=msedge|chrome|chromium` forces one.
 * Otherwise the first one installed wins: Edge (default on Windows), then Google Chrome,
 * then Playwright's bundled Chromium (`npx playwright install chromium`), so it also runs on Linux/macOS.
 */
const CHANNELS = process.env.VEXO_BROWSER ? [process.env.VEXO_BROWSER] : ['msedge', 'chrome', 'chromium'];
let channel: string | null = null; // the one that worked

let ctx: BrowserContext | null = null;
let ctxHidden = false;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Always windowed: Pixiv (Cloudflare) blocks headless browsers ("Just a moment…").
 * `hidden` moves the window off-screen instead of truly hiding it.
 * (Wayland ignores window positions: there the window stays visible.)
 */
async function open(hidden: boolean): Promise<BrowserContext> {
  if (ctx && ctxHidden === hidden) return ctx;
  await close();
  const options = {
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled', ...(hidden ? ['--window-position=-32000,-32000', '--window-size=1280,900'] : [])],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  let lastErr: unknown;
  for (const ch of channel ? [channel] : CHANNELS) {
    try {
      // 'chromium' = Playwright's bundled build (no channel)
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...options, channel: ch === 'chromium' ? undefined : ch });
      channel = ch;
      break;
    } catch (e) {
      lastErr = e;
      // only a missing browser moves on to the next one; any other error is real
      if (!/is not found|Executable doesn't exist|not installed/i.test(String(e))) throw e;
    }
  }
  if (!ctx) {
    throw new Error(
      `No browser found (tried ${CHANNELS.join(', ')}). Install Microsoft Edge or Google Chrome, ` +
        `or run "npx playwright install chromium". Details: ${String(lastErr)}`,
    );
  }
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
