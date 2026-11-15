import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { Adapter, LoginStatus, PostInput, PostResult } from './types.js';
import { escHtml, fail, pageFetch } from './http.js';

// subscribestar.adult (subscribestar.art redirects here). Flow from PostyBirb's base-subscribe-star.website.ts:
// profile page form template → presigned S3 POST → process_s3_attachments → reorder → /posts.json.
export const SS_BASE = 'https://subscribestar.adult';

export type SsTier = { id: string; name: string };

type Settings = { status: LoginStatus; tiers: SsTier[]; profileUrl: string | null };

/** Reads login state, tiers and the creator page URL from /profile/settings. */
async function readSettings(page: Page): Promise<Settings> {
  await page.goto(`${SS_BASE}/profile/settings`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page.evaluate((base) => {
    const top = document.querySelector('.top_bar-user_info');
    if (!top) return { status: { connected: false, username: null }, tiers: [], profileUrl: null };
    const username = document.querySelector('.top_bar-user_name')?.textContent?.trim() || null;
    const tiers = [...document.querySelectorAll('.for-tier_settings .tiers-settings_item')]
      .map((el) => {
        const id = el.getAttribute('data-id');
        const title = el.querySelector('.tiers-settings_item-title')?.textContent?.trim();
        const cost = el.querySelector('.tiers-settings_item-cost')?.textContent?.trim();
        return id && title ? { id, name: cost ? `${title} (${cost})` : title } : null;
      })
      .filter(Boolean) as { id: string; name: string }[];
    let href = document.querySelector('a.user_menu-item.for-star')?.getAttribute('href') ?? null;
    if (!href)
      for (const t of document.querySelectorAll('[data-safe-html]')) {
        try {
          const html = JSON.parse(t.getAttribute('data-safe-html') ?? '');
          const d = new DOMParser().parseFromString(String(html), 'text/html');
          href = d.querySelector('a.user_menu-item.for-star')?.getAttribute('href') ?? null;
          if (href) break;
        } catch {
          /* ignore */
        }
      }
    return { status: { connected: true, username }, tiers, profileUrl: href ? new URL(href, base).href : null };
  }, SS_BASE);
}

export async function listTiers(ctx: BrowserContext): Promise<SsTier[]> {
  const page = await ctx.newPage();
  try {
    const s = await readSettings(page);
    if (!s.status.connected) fail('Not logged in to SubscribeStar.');
    return s.tiers;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Post body: title in bold on the first line, then the description (one <div> per line). */
export function ssHtml(title: string, description: string): string {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
  const body = lines.map((l) => `<div>${l.trim() ? escHtml(l) : '<br>'}</div>`).join('');
  return `${title.trim() ? `<div><strong>${escHtml(title.trim())}</strong></div>` : ''}${description.trim() ? body : ''}`;
}

export const subscribestar: Adapter = {
  id: 'subscribestar',
  loginUrl: `${SS_BASE}/login`,
  cookieDomain: 'subscribestar',
  homePrefix: SS_BASE,
  async statusOnPage(page) {
    // While the user logs in: the top bar appears on any page once logged in.
    const ok = await page.locator('.top_bar-user_info').count().catch(() => 0);
    if (!ok) return { connected: false, username: null };
    const name = (await page.locator('.top_bar-user_name').first().textContent().catch(() => null))?.trim() || null;
    return { connected: true, username: name };
  },

  async checkLogin(ctx) {
    const page = await ctx.newPage();
    try {
      return (await readSettings(page)).status;
    } finally {
      await page.close().catch(() => {});
    }
  },

  async post(ctx, input: PostInput, log): Promise<PostResult> {
    const page = await ctx.newPage();
    try {
      log('Opening SubscribeStar…');
      const s = await readSettings(page);
      if (!s.status.connected) fail('Not logged in to SubscribeStar. Log in again in Platforms.');
      if (!s.profileUrl) fail('SubscribeStar creator page not found (is this a creator account?).');
      await page.goto(s.profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      const tokens = await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
          try {
            const raw = document.querySelector('.new_post .new_post-inner')?.getAttribute('data-form-template');
            if (raw) {
              const html = JSON.parse(raw);
              const doc = new DOMParser().parseFromString(String(html), 'text/html');
              const x = doc.querySelector('.post_xodal');
              const auth = [...doc.querySelectorAll('form input')].find((el) => el.getAttribute('name') === 'authenticity_token')?.getAttribute('value');
              const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
              if (x && auth && csrf) return { s3UploadPath: x.getAttribute('data-s3-upload-path')!, s3Url: x.getAttribute('data-s3-url')!, authenticityToken: auth, csrfToken: csrf };
            }
          } catch {
            /* retry */
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        return null;
      });
      if (!tokens?.s3Url || !tokens.s3UploadPath) fail('SubscribeStar: could not read the new-post form (upload tokens).');
      const bucket = tokens.s3Url.split('//')[1].split('.')[0];
      const csrf = { 'x-csrf-token': tokens.csrfToken };

      const uploadIds: string[] = [];
      for (const [i, f] of input.files.entries()) {
        log(`Uploading image ${i + 1}/${input.files.length}…`);
        const key = `${tokens.s3UploadPath}/${crypto.randomUUID()}${path.extname(f.name)}`;
        const q = new URLSearchParams({ _: String(Date.now()), key, file_name: f.name, content_type: f.mime, bucket });
        const pre = await pageFetch(page, `${SS_BASE}/presigned_url/upload?${q}`);
        if (!pre.json?.url || !pre.json?.fields) fail(`SubscribeStar presign failed: HTTP ${pre.status}`, pre.text.slice(0, 300));

        // S3 presigned POST from Node (no cookies needed).
        const fd = new FormData();
        for (const [k, v] of Object.entries(pre.json.fields as Record<string, string>)) fd.append(k, v);
        fd.append('file', new Blob([await fs.readFile(f.path)], { type: f.mime }), f.name);
        const s3 = await fetch(pre.json.url, { method: 'POST', body: fd });
        if (s3.status !== 204 && s3.status !== 200 && s3.status !== 201) fail(`SubscribeStar storage refused the file: HTTP ${s3.status}`, (await s3.text()).slice(0, 300));

        const record: [string, string][] = [
          ['path', key],
          ['url', `${pre.json.url}/${pre.json.fields.key}`],
          ['original_filename', pre.json.fields['x-amz-meta-original-filename'] ?? f.name],
          ['content_type', pre.json.fields['Content-Type'] ?? f.mime],
          ['bucket', bucket],
          ['authenticity_token', tokens.csrfToken],
          ...(f.width && f.height ? ([['width', String(f.width)], ['height', String(f.height)]] as [string, string][]) : []),
        ];
        const proc = await pageFetch(page, `${SS_BASE}/post_uploads/process_s3_attachments.json`, { form: record, headers: csrf });
        if (proc.status >= 400 || !proc.json) fail(`SubscribeStar could not process the file: HTTP ${proc.status}`, proc.text.slice(0, 300));
        const all = [...(proc.json.imgs_and_videos ?? []), ...(proc.json.audios ?? []), ...(proc.json.docs ?? [])];
        const item = all.find((u: any) => u.original_filename === f.name) ?? all[all.length - 1];
        if (!item?.id) fail('SubscribeStar: uploaded file not found after processing.', proc.json);
        uploadIds.push(String(item.id));
      }

      if (uploadIds.length > 1) await pageFetch(page, `${SS_BASE}/post_uploads/reorder`, { form: uploadIds.map((id) => ['upload_ids[]', id] as [string, string]), headers: csrf });

      const tiers = (input.options.tiers ?? '').split(',').filter((t) => t && t !== 'free');
      log(`Publishing (${tiers.length ? `${tiers.length} tier(s)` : 'public'})…`);
      const form: [string, string][] = [
        ['authenticity_token', tokens.authenticityToken],
        ['html_content', ssHtml(input.meta.title, input.meta.description)],
        ['pinned_uploads', '[]'],
        ['new_editor', 'true'],
        ['is_draft', ''],
        ...input.meta.tags.map((t) => ['tags[]', t] as [string, string]),
        ['has_poll', 'false'],
        ['finish_date', ''],
        ['finish_time', ''],
        ...tiers.map((t) => ['tier_ids[]', t] as [string, string]),
        ['posting_option', 'Publish Now'],
      ];
      const post = await pageFetch(page, `${SS_BASE}/posts.json`, { form, headers: csrf });
      if (post.status >= 400 || !post.json || post.json.error) fail(`SubscribeStar refused: ${post.json?.error ?? `HTTP ${post.status}`}`, post.json ?? post.text.slice(0, 500));
      const id = /class="[^"]*\bpost\b[^"]*"[^>]*data-id="(\d+)"|data-id="(\d+)"[^>]*class="[^"]*\bpost\b/.exec(String(post.json.html ?? ''));
      const postId = id?.[1] ?? id?.[2] ?? null;
      const url = postId ? `${SS_BASE}/posts/${postId}` : null;
      log(url ? `Posted: ${url}` : 'Posted (no id returned).');
      return { url, remoteId: postId, raw: { postId } };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
