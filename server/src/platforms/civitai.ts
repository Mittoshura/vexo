import fs from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import type { Adapter, LoginStatus, PostFile, PostInput, PostResult } from './types.js';
import { escHtml, fail, pageFetch } from './http.js';

// civitai.red: same account/database as civitai.com, but R-18 is visible there (civitai.com is SFW-only since 2026-04).
// Flow from Civitai's open-source front-end: /api/v1/image-upload → PUT file → tRPC post.createWithImages.
export const CIVITAI_BASE = 'https://civitai.red';

async function sessionUser(page: Page): Promise<LoginStatus> {
  const r = await pageFetch(page, `${CIVITAI_BASE}/api/auth/session`).catch(() => null);
  const u = r?.json?.user;
  return u?.id ? { connected: true, username: u.username ?? String(u.id) } : { connected: false, username: null };
}

/** ComfyUI/A1111 metadata → Civitai image meta (what their uploader extracts from the PNG). */
export function civitaiMeta(f: PostFile): Record<string, unknown> | undefined {
  const g = f.gen;
  if (!g) return undefined;
  const m: Record<string, unknown> = {};
  if (g.positive) m.prompt = g.positive;
  if (g.negative) m.negativePrompt = g.negative;
  if (g.cfg !== undefined) m.cfgScale = g.cfg;
  if (g.steps !== undefined) m.steps = g.steps;
  if (g.sampler) m.sampler = g.scheduler && g.scheduler !== 'normal' ? `${g.sampler} ${g.scheduler}` : g.sampler;
  if (g.seed !== undefined) m.seed = g.seed;
  if (g.model) m.Model = g.model.replace(/\.(safetensors|ckpt)$/i, '').split(/[\\/]/).pop();
  const loras = (g.loras ?? []).map((l) => ({ type: 'lora', name: l.replace(/\.(safetensors|ckpt)$/i, '').split(/[\\/]/).pop() }));
  const resources = [...(m.Model ? [{ type: 'model', name: m.Model as string }] : []), ...loras];
  if (resources.length) m.resources = resources;
  return Object.keys(m).length ? m : undefined;
}

async function trpc(page: Page, proc: string, input: unknown) {
  const r = await pageFetch(page, `${CIVITAI_BASE}/api/trpc/${proc}`, { json: { json: input } });
  if (r.status >= 400 || r.json?.error) {
    const e = r.json?.error?.json ?? r.json?.error;
    fail(`Civitai refused (${proc}): ${e?.message ?? `HTTP ${r.status}`}`, r.json ?? r.text.slice(0, 500));
  }
  return r.json?.result?.data?.json ?? r.json?.result?.data;
}

export const civitai: Adapter = {
  id: 'civitai',
  loginUrl: `${CIVITAI_BASE}/login`,
  cookieDomain: 'civitai',
  homePrefix: CIVITAI_BASE,
  statusOnPage: sessionUser,

  async checkLogin(ctx: BrowserContext) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${CIVITAI_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return await sessionUser(page);
    } finally {
      await page.close().catch(() => {});
    }
  },

  async post(ctx, input: PostInput, log): Promise<PostResult> {
    const page = await ctx.newPage();
    try {
      log('Opening Civitai…');
      await page.goto(`${CIVITAI_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!(await sessionUser(page)).connected) fail('Not logged in to Civitai. Log in again in Platforms.');

      const images = [];
      for (const [i, f] of input.files.entries()) {
        log(`Uploading image ${i + 1}/${input.files.length}…`);
        const up = await pageFetch(page, `${CIVITAI_BASE}/api/v1/image-upload`, { json: { filename: encodeURIComponent(f.name), metadata: {} } });
        if (!up.json?.id || !up.json?.uploadURL) fail(`Civitai upload refused: ${up.json?.error ?? `HTTP ${up.status}`}`, up.json ?? up.text.slice(0, 300));
        // Presigned PUT: no cookies needed, sent from Node (no browser CORS limits).
        const put = await fetch(up.json.uploadURL, { method: 'PUT', body: await fs.readFile(f.path), headers: { 'content-type': f.mime } });
        if (!put.ok) fail(`Civitai storage refused the file: HTTP ${put.status}`, (await put.text()).slice(0, 300));
        const meta = civitaiMeta(f);
        images.push({ url: up.json.id, name: f.name, width: f.width, height: f.height, mimeType: f.mime, type: 'image', index: i, ...(meta ? { meta } : {}) });
      }

      log('Creating the post…');
      const { meta } = input;
      const post = await trpc(page, 'post.createWithImages', {
        title: meta.title || null,
        detail: meta.description ? `<p>${escHtml(meta.description).replace(/\n/g, '<br>')}</p>` : null,
        tags: meta.tags,
        publish: true,
        images,
      });
      const id = post?.id ?? post?.post?.id;
      const url = id ? `${CIVITAI_BASE}/posts/${id}` : null;
      log(url ? `Posted: ${url}` : 'Posted (no id returned).');
      return { url, remoteId: id ? String(id) : null, raw: post };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
