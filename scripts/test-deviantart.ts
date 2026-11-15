// Real DeviantArt adapter, network simulated with page.route(). Usage: npx tsx scripts/test-deviantart.ts
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { deviantart, listFolders, daDocument } from '../server/src/platforms/deviantart.js';

const dir = path.join(process.env.TMPDIR ?? '.', 'da-test');
fs.mkdirSync(dir, { recursive: true });
const files = [];
for (const [i, c] of ['#e5383b', '#3a86ff', '#06d6a0'].entries()) {
  const p = path.join(dir, `img${i}.png`);
  await sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toFile(p);
  files.push({ path: p, name: `img${i}.png`, mime: 'image/png' });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext();
await ctx.addCookies([{ name: 'userinfo', value: encodeURIComponent('abc;{"username":"demo_artist","uniqueid":"x"}'), domain: '.deviantart.com', path: '/' }]);
const calls: { url: string; ctype: string; body: string }[] = [];
await ctx.route('https://www.deviantart.com/**', async (route) => {
  const req = route.request();
  const url = req.url();
  const ok = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  if (req.method() === 'GET' && url.includes('/gallection/folders')) {
    calls.push({ url, ctype: '', body: '' });
    return ok({ results: [{ folderId: 11, name: 'Featured', parentId: null }, { folderId: 12, name: 'AI', parentId: null }, { folderId: 13, name: 'Kohaku', parentId: '12' }] });
  }
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: `<html><script>window.__CSRF_TOKEN__ = 'TOK';</script></html>` });
  calls.push({ url, ctype: req.headers()['content-type'] ?? '', body: req.postDataBuffer()?.toString('latin1') ?? '' });
  if (url.endsWith('/submit/upload/deviation')) return ok({ status: 'success', deviationId: 777, stashId: 1 });
  if (url.endsWith('/attachments/add')) return ok({ deviationId: 777, fileId: calls.length });
  if (url.endsWith('/deviation/update')) return ok({ status: 'success', deviationId: 777, url: 'x' });
  if (url.endsWith('/deviation/publish')) return ok({ status: 'success', deviationId: 777, url: 'https://www.deviantart.com/demo_artist/art/Kohaku-777' });
  return route.fulfill({ status: 404, body: '{}' });
});

const login = await deviantart.statusOnPage(await ctx.newPage());
assert.deepEqual(login, { connected: true, username: 'demo_artist' });
const folders = await listFolders(ctx);
assert.deepEqual(folders.map((f) => f.name), ['Featured', 'AI', 'Kohaku']);
assert.ok(calls[0].url.includes('username=demo_artist') && calls[0].url.includes('csrf_token=TOK'));

const res = await deviantart.post(
  ctx,
  { meta: { title: 'Kohaku / Dr. Stone', description: 'Line one\n\nLine two', tags: ['kohaku', 'dr_stone'] }, nsfw: true, files, options: { folderId: '13', aiGenerated: '1', noai: '1' } },
  (m) => console.log('  log:', m),
);
await browser.close();

const post = calls.slice(1);
console.log('requests:', post.map((c) => c.url.replace('https://www.deviantart.com', '')).join(' → '));
assert.deepEqual(post.map((c) => c.url.split('/').slice(-2).join('/')), ['upload/deviation', 'attachments/add', 'attachments/add', 'deviation/update', 'deviation/publish']);
assert.ok(post[0].body.includes('name="upload_file"; filename="img0.png"') && post[0].body.includes('TOK'));
assert.ok(post[1].body.includes('name="attachment_file"; filename="img1.png"') && /name="position"\r\n\r\n1/.test(post[1].body) && /name="deviationid"\r\n\r\n777/.test(post[1].body));
assert.ok(post[2].body.includes('filename="img2.png"') && /name="position"\r\n\r\n2/.test(post[2].body));
const upd = JSON.parse(post[3].body);
assert.equal(post[3].ctype, 'application/json');
assert.equal(upd.title, 'Kohaku / Dr. Stone');
assert.deepEqual(upd.tags, ['kohaku', 'dr_stone']);
assert.deepEqual(upd.galleryids, ['13']);
assert.equal(upd.is_mature, true);
assert.equal(upd.is_ai_generated, true);
assert.equal(upd.noai, true);
assert.equal(upd.deviationid, 777);
assert.equal(upd.editorRaw, daDocument('Line one\n\nLine two'));
assert.equal(JSON.parse(upd.editorRaw).document.content.length, 3);
assert.deepEqual(JSON.parse(post[4].body), { da_minor_version: 20230710, csrf_token: 'TOK', stashid: 777 });
assert.equal(res.url, 'https://www.deviantart.com/demo_artist/art/Kohaku-777');
console.log('DeviantArt adapter: OK →', res.url);
