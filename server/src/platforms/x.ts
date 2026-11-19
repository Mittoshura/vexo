import type { BrowserContext, Page, Route } from 'playwright';
import type { Adapter, LoginStatus, PostInput, PostResult } from './types.js';
import { xText } from '../../../shared/platforms.js';
import { fail } from './http.js';

// X: drives the real compose form in the logged-in browser profile (no API keys).
// R-18: the CreateTweet request sent by X's own page is patched with `possibly_sensitive: true`.
const BASE = 'https://x.com';

async function cookieStatus(ctx: BrowserContext): Promise<boolean> {
  const c = await ctx.cookies(BASE);
  return c.some((k) => k.name === 'auth_token') && c.some((k) => k.name === 'twid');
}

async function usernameOnPage(page: Page): Promise<string | null> {
  const href = await page
    .locator('a[data-testid="AppTabBar_Profile_Link"]')
    .first()
    .getAttribute('href', { timeout: 15000 })
    .catch(() => null);
  return href ? href.replace(/^\//, '') : null;
}

async function status(page: Page): Promise<LoginStatus> {
  if (!(await cookieStatus(page.context()))) return { connected: false, username: null };
  return { connected: true, username: await usernameOnPage(page) };
}

/** Patches X's GraphQL CreateTweet body: marks the attached media as sensitive. */
export function markSensitive(body: string): string {
  const j = JSON.parse(body);
  j.variables ??= {};
  j.variables.media ??= { media_entities: [], possibly_sensitive: false };
  j.variables.media.possibly_sensitive = true;
  return JSON.stringify(j);
}

export const x: Adapter = {
  id: 'x',
  loginUrl: `${BASE}/i/flow/login`,
  cookieDomain: 'x.com',
  homePrefix: `${BASE}/home`,
  statusOnPage: status,

  async checkLogin(ctx) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return await status(page);
    } finally {
      await page.close().catch(() => {});
    }
  },

  async post(ctx, input: PostInput, log): Promise<PostResult> {
    const page = await ctx.newPage();
    try {
      log('Opening X…');
      await page.goto(`${BASE}/compose/post`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!(await cookieStatus(ctx))) fail('Not logged in to X. Log in again in Platforms.');
      const box = page.locator('[data-testid="tweetTextarea_0"]').first();
      await box.waitFor({ timeout: 30000 });

      if (input.nsfw) {
        log('R-18: media will be marked as sensitive.');
        await page.route('**/CreateTweet', async (route: Route) => {
          const body = route.request().postData();
          if (!body) return route.fallback();
          await route.fallback({ postData: markSensitive(body) });
        });
      }

      log(`Attaching ${input.files.length} image(s)…`);
      await page.locator('input[data-testid="fileInput"]').first().setInputFiles(input.files.map((f) => f.path));
      // Wait until every image is attached and the upload finished (Post button enabled).
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="attachments"] img').length >= n,
        input.files.length,
        { timeout: 120000 },
      );

      const text = xText(input.meta);
      if (text) {
        log('Writing the text…');
        await box.click();
        // Type like a user: one line at a time, Enter between lines (X's editor mangles pasted newlines).
        const lines = text.split('\n');
        for (const [i, line] of lines.entries()) {
          if (i) await page.keyboard.press('Enter');
          if (line) await page.keyboard.insertText(line);
        }
        await page.keyboard.press('Escape').catch(() => {}); // close a hashtag suggestion popup
      }

      const button = page.locator('[data-testid="tweetButton"]').first();
      await page.waitForFunction(
        () => {
          const b = document.querySelector('[data-testid="tweetButton"]');
          return !!b && b.getAttribute('aria-disabled') !== 'true';
        },
        undefined,
        { timeout: 180000 },
      );

      log('Posting…');
      const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/CreateTweet') && r.request().method() === 'POST', { timeout: 60000 }), button.click()]);
      const body = await res.json().catch(() => null);
      if (!res.ok() || body?.errors?.length) fail(`X refused: ${body?.errors?.[0]?.message ?? `HTTP ${res.status()}`}`, body);
      const id: string | undefined = body?.data?.create_tweet?.tweet_results?.result?.rest_id;
      const user = (await usernameOnPage(page)) ?? 'i';
      const url = id ? `${BASE}/${user}/status/${id}` : null;
      log(url ? `Posted: ${url}` : 'Posted (no id returned).');
      return { url, remoteId: id ?? null, raw: id ? { id } : body };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
