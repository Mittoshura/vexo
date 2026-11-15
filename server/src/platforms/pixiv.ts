import fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import type { Adapter, LoginStatus, PostInput, PostResult } from './types.js';

const BASE = 'https://www.pixiv.net';

/** Reads the current page's serialized Next.js state (null if missing). */
async function readState(page: Page): Promise<any | null> {
  return page.evaluate(() => {
    const el = document.querySelector('#__NEXT_DATA__');
    if (!el?.textContent) return null;
    try {
      const d = JSON.parse(el.textContent);
      const s = d?.props?.pageProps?.serverSerializedPreloadedState;
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });
}

export async function pixivStatusOnPage(page: Page): Promise<LoginStatus> {
  const state = await readState(page);
  const self = state?.userData?.self;
  if (self?.pixivId || self?.userId) return { connected: true, username: self.pixivId ?? String(self.userId) };
  // Fallback: the logged-in home page has no signup form.
  const hasSignup = await page.evaluate(() => !!document.querySelector('[class*="signup"], a[href*="/signup"]'));
  if (state && !hasSignup && state.userData) return { connected: true, username: null };
  return { connected: false, username: null };
}

export const pixiv: Adapter = {
  id: 'pixiv',
  loginUrl: 'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F',
  cookieDomain: 'pixiv.net',
  homePrefix: 'https://www.pixiv.net',
  statusOnPage: pixivStatusOnPage,

  async checkLogin(ctx: BrowserContext) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return await pixivStatusOnPage(page);
    } finally {
      await page.close().catch(() => {});
    }
  },

  async post(ctx: BrowserContext, input: PostInput, log): Promise<PostResult> {
    const page = await ctx.newPage();
    try {
      log('Opening the upload page…');
      await page.goto(`${BASE}/illustration/create`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const state = await readState(page);
      const token: string | undefined = state?.api?.token;
      if (!token) throw new Error('CSRF token not found: Pixiv session expired? Log in again under Platforms.');
      if (!state?.userData?.self) throw new Error('Not logged in to Pixiv.');

      const { meta, nsfw, options } = input;
      const fields: [string, string][] = [
        ['title', meta.title.slice(0, 32)],
        ['caption', meta.description],
        ...meta.tags.slice(0, 10).map((t): [string, string] => ['tags[]', t]),
        ['allowTagEdit', options.allowTagEdit === '0' ? 'false' : 'true'],
        ['xRestrict', nsfw ? 'r18' : 'general'],
        ['aiType', options.aiType === 'notAiGenerated' ? 'notAiGenerated' : 'aiGenerated'],
        ['restrict', options.restrict === 'private' ? 'private' : options.restrict === 'mypixiv' ? 'mypixiv' : 'public'],
        ['responseAutoAccept', 'false'],
        ['original', 'true'],
        ['ratings[violent]', 'false'],
        ['ratings[drug]', 'false'],
        ['ratings[thoughts]', 'false'],
        ['ratings[antisocial]', 'false'],
        ['ratings[religion]', 'false'],
        ['attributes[yuri]', 'false'],
        ['attributes[bl]', 'false'],
        ['attributes[furry]', 'false'],
        ['attributes[lo]', 'false'],
        ['allowComment', 'true'],
        ['titleTranslations[en]', ''],
        ['captionTranslations[en]', ''],
        ['allowCitationWork', '1'],
      ];
      if (!nsfw) fields.push(['sexual', 'false']);

      log(`Reading ${input.files.length} file(s)…`);
      const files = [];
      for (const f of input.files) files.push({ name: f.name, mime: f.mime, b64: (await fs.readFile(f.path)).toString('base64') });

      log('Sending to Pixiv…');
      const res = await page.evaluate(
        async ({ fields, files, token }) => {
          const fd = new FormData();
          for (const [k, v] of fields) fd.append(k, v);
          // Same order as PostyBirb: all files[] first, then all imageOrder.
          files.forEach((f) => {
            const bin = atob(f.b64);
            const arr = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
            fd.append('files[]', new Blob([arr], { type: f.mime }), f.name);
          });
          files.forEach((_, i) => {
            fd.append(`imageOrder[${i}][type]`, 'newFile');
            fd.append(`imageOrder[${i}][fileKey]`, String(i));
          });
          const r = await fetch('/ajax/work/create/illustration', {
            method: 'POST',
            body: fd,
            credentials: 'include',
            headers: { 'x-csrf-token': token, accept: 'application/json' },
          });
          return { status: r.status, text: await r.text() };
        },
        { fields, files, token },
      );

      let json: any = null;
      try {
        json = JSON.parse(res.text);
      } catch {
        /* non-JSON */
      }
      if (res.status >= 400 || !json || json.error) {
        const msg = json?.message || json?.body?.errors?.join?.(', ') || `HTTP ${res.status}`;
        throw Object.assign(new Error(`Pixiv rejected: ${msg}`), { raw: json ?? res.text.slice(0, 500) });
      }
      let id: string | null = json.body?.illustId ?? json.body?.id ?? null;
      const convertKey: string | undefined = json.body?.convertKey;
      // Pixiv processes the upload asynchronously: poll /progress like their own form does (1 s, 2 min max).
      if (!id && convertKey) {
        log('Pixiv is processing…');
        id = await waitForIllust(page, convertKey);
      }
      log(id ? `Posted: ${BASE}/artworks/${id}` : `Posted, but link not retrieved (convertKey ${convertKey ?? '?'}).`);
      return { url: id ? `${BASE}/artworks/${id}` : null, remoteId: id ? String(id) : null, raw: json };
    } finally {
      await page.close().catch(() => {});
    }
  },
};

/** Waits for Pixiv processing to finish and returns the artwork id (null on timeout). */
async function waitForIllust(page: Page, convertKey: string, timeoutMs = 120_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await page.evaluate(async (k) => {
      const res = await fetch(`/ajax/work/create/illustration/progress?convertKey=${encodeURIComponent(k)}`, { credentials: 'include', headers: { accept: 'application/json' } });
      return res.json().catch(() => null);
    }, convertKey);
    const status = r?.body?.status;
    if (status === 'COMPLETE' && r.body.illustId) return String(r.body.illustId);
    if (status === 'FAILURE') throw Object.assign(new Error('Pixiv: image processing failed.'), { raw: r });
    await page.waitForTimeout(1000);
  }
  return null;
}
