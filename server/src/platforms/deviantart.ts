import fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import type { Adapter, LoginStatus, PostInput, PostResult } from './types.js';

// Internal DeviantArt web API, called from the logged-in session (same flow as PostyBirb's deviant-art.website.ts).
const BASE = 'https://www.deviantart.com';
const DA_VERSION = 20230710;

export type DaFolder = { id: string; name: string; parentId: string | null };

/** `userinfo` cookie → username (null when logged out). */
async function statusFromCookies(ctx: BrowserContext): Promise<LoginStatus> {
  const c = (await ctx.cookies(BASE)).find((k) => k.name === 'userinfo');
  if (!c) return { connected: false, username: null };
  try {
    const info = JSON.parse(decodeURIComponent(c.value).split(';')[1]);
    if (info?.username) return { connected: true, username: info.username };
  } catch {
    /* malformed */
  }
  return { connected: false, username: null };
}

async function openHome(ctx: BrowserContext): Promise<{ page: Page; csrf: string }> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const csrf = await page.evaluate(() => (window as any).__CSRF_TOKEN__ as string | undefined);
  if (!csrf) {
    await page.close().catch(() => {});
    throw new Error('DeviantArt CSRF token not found: session expired? Log in again in Platforms.');
  }
  return { page, csrf };
}

/** fetch() inside the page (genuine cookies/UA). `files` are sent as multipart Blobs. */
async function call(
  page: Page,
  url: string,
  opts: { json?: Record<string, unknown>; form?: [string, string][]; file?: { field: string; name: string; mime: string; b64: string } },
): Promise<any> {
  const res = await page.evaluate(
    async ({ url, opts }) => {
      let body: BodyInit | undefined;
      const headers: Record<string, string> = { accept: 'application/json' };
      if (opts.json) {
        body = JSON.stringify(opts.json);
        headers['content-type'] = 'application/json';
      } else if (opts.form) {
        const fd = new FormData();
        for (const [k, v] of opts.form) fd.append(k, v);
        if (opts.file) {
          const bin = atob(opts.file.b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          fd.append(opts.file.field, new Blob([arr], { type: opts.file.mime }), opts.file.name);
        }
        body = fd;
      }
      const r = await fetch(url, { method: body ? 'POST' : 'GET', body, headers, credentials: 'include' });
      return { status: r.status, text: await r.text() };
    },
    { url, opts },
  );
  let json: any = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    /* non-JSON */
  }
  if (res.status >= 400 || !json) {
    const msg = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(`DeviantArt refused: ${msg}`), { raw: json ?? res.text.slice(0, 500) });
  }
  return json;
}

/** Plain text → DeviantArt editor document (TipTap JSON, one paragraph per line). */
export function daDocument(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const content = lines.map((l) => (l.trim() ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }));
  return JSON.stringify({ version: 1, document: { type: 'doc', content } });
}

export async function listFolders(ctx: BrowserContext): Promise<DaFolder[]> {
  const st = await statusFromCookies(ctx);
  if (!st.connected || !st.username) throw new Error('Not logged in to DeviantArt.');
  const { page, csrf } = await openHome(ctx);
  try {
    const q = new URLSearchParams({
      offset: '0',
      limit: '250',
      type: 'gallery',
      with_all_folder: 'true',
      with_permissions: 'true',
      username: st.username,
      da_minor_version: String(DA_VERSION),
      csrf_token: csrf,
    });
    const r = await call(page, `${BASE}/_puppy/dashared/gallection/folders?${q}`, {});
    return ((r.results ?? []) as any[]).map((f) => ({ id: String(f.folderId), name: String(f.name), parentId: f.parentId ? String(f.parentId) : null }));
  } finally {
    await page.close().catch(() => {});
  }
}

export const deviantart: Adapter = {
  id: 'deviantart',
  loginUrl: `${BASE}/users/login`,
  cookieDomain: 'deviantart.com',
  homePrefix: BASE,
  statusOnPage: (page) => statusFromCookies(page.context()),

  async checkLogin(ctx) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return await statusFromCookies(ctx);
    } finally {
      await page.close().catch(() => {});
    }
  },

  async post(ctx, input: PostInput, log): Promise<PostResult> {
    log('Opening DeviantArt…');
    const { page, csrf } = await openHome(ctx);
    try {
      const files = [];
      for (const f of input.files) files.push({ name: f.name, mime: f.mime, b64: (await fs.readFile(f.path)).toString('base64') });

      log(`Uploading image 1/${files.length}…`);
      const up = await call(page, `${BASE}/_puppy/dashared/deviation/submit/upload/deviation`, {
        form: [
          ['da_minor_version', String(DA_VERSION)],
          ['csrf_token', csrf],
          ['use_defaults', 'true'],
          ['folder_name', 'Saved Submissions'],
        ],
        file: { field: 'upload_file', ...files[0] },
      });
      if (up.status !== 'success' || !up.deviationId) throw Object.assign(new Error('DeviantArt: upload failed.'), { raw: up });
      const deviationId = up.deviationId;

      for (let i = 1; i < files.length; i++) {
        log(`Uploading image ${i + 1}/${files.length}…`);
        await call(page, `${BASE}/_puppy/dashared/deviation/attachments/add`, {
          form: [
            ['da_minor_version', String(DA_VERSION)],
            ['type', 'additional_media'],
            ['position', String(i)],
            ['csrf_token', csrf],
            ['deviationid', String(deviationId)],
          ],
          file: { field: 'attachment_file', ...files[i] },
        });
      }

      const { meta, nsfw, options } = input;
      // DeviantArt only watermarks a resized display copy: 0 (original size) ignores add_watermark.
      const watermark = options.watermark === '1';
      log(`Setting details${nsfw ? ' (Mature)' : ''}${watermark ? ' (watermark)' : ''}…`);
      const details: Record<string, unknown> = {
        allow_comments: true,
        allow_free_download: false,
        deviationid: deviationId,
        da_minor_version: DA_VERSION,
        display_resolution: watermark ? Number(options.displayResolution) || 3 : 0,
        editorRaw: daDocument(meta.description),
        editor_v3: '',
        galleryids: options.folderId ? [options.folderId] : [],
        is_ai_generated: options.aiGenerated !== '0',
        is_scrap: options.scraps === '1',
        license_options: { creative_commons: false, commercial: false, modify: 'no' },
        location_tag: null,
        noai: options.noai !== '0',
        subject_tag_types: '_empty',
        subject_tags: '_empty',
        tags: meta.tags,
        tierids: '_empty',
        title: meta.title.slice(0, 50),
        csrf_token: csrf,
      };
      if (nsfw) details.is_mature = true;
      if (watermark) details.add_watermark = true; // "Add watermark" box on DeviantArt's submit page
      const upd = await call(page, `${BASE}/_napi/shared_api/deviation/update`, { json: details });
      if (upd.status !== 'success') throw Object.assign(new Error('DeviantArt: could not save the details.'), { raw: upd });

      log('Publishing…');
      const pub = await call(page, `${BASE}/_puppy/dashared/deviation/publish`, {
        json: { da_minor_version: DA_VERSION, csrf_token: csrf, stashid: upd.deviationId ?? deviationId },
      });
      if (pub.status !== 'success') throw Object.assign(new Error('DeviantArt: publish failed.'), { raw: pub });
      const url: string | null = pub.url ?? null;
      log(url ? `Posted: ${url}` : 'Posted (no link returned).');
      return { url, remoteId: pub.deviationId ? String(pub.deviationId) : String(deviationId), raw: pub };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
