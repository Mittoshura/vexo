// Real Civitai / X / SubscribeStar adapters against simulated sites (page.route + a local HTTP server
// standing in for the storage buckets). Usage: npx tsx scripts/test-adapters.ts
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { civitai } from '../server/src/platforms/civitai.js';
import { x, markSensitive } from '../server/src/platforms/x.js';
import { subscribestar, listTiers, ssHtml } from '../server/src/platforms/subscribestar.js';

const dir = path.join(process.env.TMPDIR ?? '.', 'adapters-test');
fs.mkdirSync(dir, { recursive: true });
const files = [];
for (const [i, c] of ['#e5383b', '#3a86ff'].entries()) {
  const p = path.join(dir, `img${i}.png`);
  await sharp({ create: { width: 64, height: 48, channels: 3, background: c } }).png().toFile(p);
  files.push({ path: p, name: `img${i}.png`, mime: 'image/png', width: 64, height: 48, gen: { source: 'comfyui' as const, positive: 'kohaku (dr. stone), 1girl', negative: 'lowres', seed: 42, steps: 28, cfg: 5.5, sampler: 'euler_ancestral', scheduler: 'normal', model: 'waiIllustrious_v140.safetensors', loras: ['chars/kohaku_v2.safetensors'] } });
}
const meta = { title: 'Kohaku / Dr. Stone', description: 'Line one\nLine <two>', tags: ['kohaku', 'dr. stone'] };

// local "storage" server: records PUTs (Civitai) and multipart POSTs (S3)
const stored: { method: string; url: string; size: number; ctype: string; body: string }[] = [];
const store = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => {
    const b = Buffer.concat(chunks);
    stored.push({ method: req.method!, url: req.url!, size: b.length, ctype: req.headers['content-type'] ?? '', body: b.toString('latin1') });
    res.writeHead(req.method === 'POST' ? 204 : 200).end();
  });
});
await new Promise<void>((r) => store.listen(0, '127.0.0.1', () => r()));
const STORE = `http://127.0.0.1:${(store.address() as any).port}`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const json = (route: any, body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

// ---------------- Civitai ----------------
{
  const ctx = await browser.newContext();
  const calls: { url: string; body: string }[] = [];
  let n = 0;
  await ctx.route('https://civitai.red/**', async (route) => {
    const u = route.request().url();
    if (u.endsWith('/api/auth/session')) return json(route, { user: { id: 7, username: 'demo_artist' } });
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
    calls.push({ url: u, body: route.request().postData() ?? '' });
    if (u.endsWith('/api/v1/image-upload')) return json(route, { id: `uuid-${n}`, uploadURL: `${STORE}/put/${n++}` });
    if (u.includes('/api/trpc/post.createWithImages')) return json(route, { result: { data: { json: { id: 999 } } } });
    return route.fulfill({ status: 404, body: '{}' });
  });
  assert.deepEqual(await civitai.checkLogin(ctx), { connected: true, username: 'demo_artist' });
  const res = await civitai.post(ctx, { meta, nsfw: true, files, options: {} }, () => {});
  const puts = stored.filter((s) => s.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].size, fs.statSync(files[0].path).size, 'raw file bytes PUT');
  assert.equal(puts[0].ctype, 'image/png');
  const create = JSON.parse(calls.find((c) => c.url.includes('createWithImages'))!.body).json;
  assert.equal(create.title, 'Kohaku / Dr. Stone');
  assert.equal(create.publish, true);
  assert.deepEqual(create.tags, ['kohaku', 'dr. stone']);
  assert.ok(create.detail.includes('Line &lt;two&gt;'));
  assert.deepEqual(create.images.map((i: any) => [i.url, i.index, i.width, i.height]), [['uuid-0', 0, 64, 48], ['uuid-1', 1, 64, 48]]);
  const m = create.images[0].meta;
  assert.equal(m.prompt, 'kohaku (dr. stone), 1girl');
  assert.equal(m.seed, 42);
  assert.equal(m.cfgScale, 5.5);
  assert.equal(m.Model, 'waiIllustrious_v140');
  assert.deepEqual(m.resources, [{ type: 'model', name: 'waiIllustrious_v140' }, { type: 'lora', name: 'kohaku_v2' }]);
  assert.equal(res.url, 'https://civitai.red/posts/999');
  console.log('Civitai adapter: OK →', res.url);
  await ctx.close();
}

// ---------------- X ----------------
{
  assert.equal(JSON.parse(markSensitive(JSON.stringify({ variables: { tweet_text: 'a', media: { media_entities: [{ media_id: '1' }], possibly_sensitive: false } } }))).variables.media.possibly_sensitive, true);
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: 'auth_token', value: 'x', domain: '.x.com', path: '/' },
    { name: 'twid', value: 'u%3D1', domain: '.x.com', path: '/' },
  ]);
  // Minimal stand-in for X's compose page: same data-testids, sends CreateTweet like the real one.
  const page = `<html><body>
    <a data-testid="AppTabBar_Profile_Link" href="/demo_artist">me</a>
    <div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div>
    <input type="file" data-testid="fileInput" multiple>
    <div data-testid="attachments"></div>
    <button data-testid="tweetButton" aria-disabled="true">Post</button>
    <script>
      const input = document.querySelector('[data-testid=fileInput]'), att = document.querySelector('[data-testid=attachments]'), btn = document.querySelector('[data-testid=tweetButton]');
      input.addEventListener('change', () => { for (const f of input.files) { const i = document.createElement('img'); i.src = URL.createObjectURL(f); att.appendChild(i); } setTimeout(() => btn.setAttribute('aria-disabled', 'false'), 300); });
      btn.addEventListener('click', () => fetch('/i/api/graphql/abc/CreateTweet', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variables: { tweet_text: document.querySelector('[data-testid=tweetTextarea_0]').innerText, media: { media_entities: [...att.children].map((_, i) => ({ media_id: String(i) })), possibly_sensitive: false } } }) }));
    </script></body></html>`;
  let tweet: any = null;
  await ctx.route('https://x.com/**', async (route) => {
    const u = route.request().url();
    if (u.includes('/CreateTweet')) {
      tweet = JSON.parse(route.request().postData()!);
      return json(route, { data: { create_tweet: { tweet_results: { result: { rest_id: '1888' } } } } });
    }
    return route.fulfill({ contentType: 'text/html', body: page });
  });
  assert.deepEqual(await x.checkLogin(ctx), { connected: true, username: 'demo_artist' });
  const res = await x.post(ctx, { meta: { title: 'Kohaku', description: '', tags: ['kohaku', 'drstone'] }, nsfw: true, files, options: {} }, () => {});
  assert.equal(tweet.variables.media.media_entities.length, 2, '2 images attached');
  assert.equal(tweet.variables.media.possibly_sensitive, true, 'R-18 → sensitive');
  // the stand-in editor's innerText adds extra breaks around <div>s: compare the non-empty lines
  assert.deepEqual(tweet.variables.tweet_text.split('\n').filter(Boolean), ['Kohaku', '#kohaku #drstone']);
  assert.equal(res.url, 'https://x.com/demo_artist/status/1888');
  console.log('X adapter: OK →', res.url);
  await ctx.close();
}

// ---------------- SubscribeStar ----------------
{
  const ctx = await browser.newContext();
  const settingsHtml = `<html><head><meta name="csrf-token" content="CSRF1"></head><body>
    <div class="top_bar-user_info"><img data-user-id="5"><span class="top_bar-user_name"> demo_artist </span></div>
    <a class="user_menu-item for-star" href="/demo_artist">My page</a>
    <div class="for-tier_settings">
      <div class="tiers-settings_item" data-id="301"><span class="tiers-settings_item-title">Supporter</span><span class="tiers-settings_item-cost">$3</span></div>
      <div class="tiers-settings_item" data-id="302"><span class="tiers-settings_item-title">Fan</span><span class="tiers-settings_item-cost">$10</span></div>
    </div></body></html>`;
  const tpl = JSON.stringify('<div class="post_xodal" data-s3-upload-path="uploads/5" data-s3-url="https://ss-bucket.s3.amazonaws.com"></div><form><input name="authenticity_token" value="AUTH1"></form>');
  const profileHtml = `<html><head><meta name="csrf-token" content="CSRF1"></head><body><div class="new_post"><div class="new_post-inner" data-form-template='${tpl.replace(/'/g, '&#39;')}'></div></div></body></html>`;
  const calls: { url: string; body: string; csrf?: string }[] = [];
  let up = 0;
  await ctx.route('https://subscribestar.adult/**', async (route) => {
    const req = route.request();
    const u = req.url();
    if (u.endsWith('/profile/settings')) return route.fulfill({ contentType: 'text/html', body: settingsHtml });
    if (u.endsWith('/demo_artist')) return route.fulfill({ contentType: 'text/html', body: profileHtml });
    calls.push({ url: u, body: req.postDataBuffer()?.toString('latin1') ?? '', csrf: req.headers()['x-csrf-token'] });
    if (u.includes('/presigned_url/upload')) {
      const q = new URL(u).searchParams;
      return json(route, { url: `${STORE}/s3`, fields: { key: q.get('key'), 'Content-Type': q.get('content_type'), 'x-amz-meta-original-filename': q.get('file_name'), policy: 'POLICY' } });
    }
    if (u.endsWith('/process_s3_attachments.json')) {
      const name = /name="original_filename"\r\n\r\n([^\r]+)/.exec(req.postDataBuffer()!.toString('latin1'))![1];
      return json(route, { imgs_and_videos: [{ id: 700 + up++, original_filename: name }], audios: [], docs: [], processed: true });
    }
    if (u.endsWith('/post_uploads/reorder')) return json(route, {});
    if (u.endsWith('/posts.json')) return json(route, { html: '<div class="post wall-post" data-id="4242">ok</div>' });
    return route.fulfill({ status: 404, body: '{}' });
  });
  assert.deepEqual(await subscribestar.checkLogin(ctx), { connected: true, username: 'demo_artist' });
  assert.deepEqual(await listTiers(ctx), [{ id: '301', name: 'Supporter ($3)' }, { id: '302', name: 'Fan ($10)' }]);
  const before = stored.length;
  const res = await subscribestar.post(ctx, { meta, nsfw: true, files, options: { tiers: '302' } }, () => {});
  const s3 = stored.slice(before).filter((s) => s.url === '/s3');
  assert.equal(s3.length, 2);
  assert.ok(s3[0].body.includes('name="policy"') && s3[0].body.indexOf('name="policy"') < s3[0].body.indexOf('name="file"'), 'S3 fields before the file');
  assert.ok(/name="key"\r\n\r\nuploads\/5\/[0-9a-f-]+\.png/.test(s3[0].body));
  const proc = calls.filter((c) => c.url.endsWith('process_s3_attachments.json'));
  assert.equal(proc.length, 2);
  assert.equal(proc[0].csrf, 'CSRF1');
  assert.ok(/name="bucket"\r\n\r\nss-bucket/.test(proc[0].body) && /name="width"\r\n\r\n64/.test(proc[0].body));
  const reorder = calls.find((c) => c.url.endsWith('/reorder'))!;
  assert.ok(reorder.body.includes('700') && reorder.body.includes('701'));
  const post = calls.find((c) => c.url.endsWith('/posts.json'))!;
  assert.ok(/name="authenticity_token"\r\n\r\nAUTH1/.test(post.body));
  assert.ok(post.body.includes(ssHtml(meta.title, meta.description)));
  assert.ok(post.body.includes('<strong>Kohaku / Dr. Stone</strong>') && post.body.includes('Line &lt;two&gt;'));
  assert.ok(/name="tier_ids\[\]"\r\n\r\n302/.test(post.body));
  assert.equal((post.body.match(/name="tags\[\]"/g) ?? []).length, 2);
  assert.ok(post.body.includes('Publish Now'));
  assert.equal(res.url, 'https://subscribestar.adult/posts/4242');
  console.log('SubscribeStar adapter: OK →', res.url);
  await ctx.close();
}

await browser.close();
store.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('all adapters: OK');
