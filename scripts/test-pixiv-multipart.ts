// Test du vrai adaptateur Pixiv sans réseau : page.route() simule pixiv.net et capture la requête multipart.
// Usage : npx tsx scripts/test-pixiv-multipart.ts
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pixiv } from '../server/src/platforms/pixiv.js';
import { ORIGINALS_DIR } from '../server/src/paths.js';

const files = fs.readdirSync(ORIGINALS_DIR).slice(0, 4).map((n) => ({ path: path.join(ORIGINALS_DIR, n), name: n, mime: n.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
const state = JSON.stringify({ api: { token: 'TEST' }, userData: { self: { pixivId: 'test' } } });
const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { serverSerializedPreloadedState: state } } })}</script></body></html>`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext();
let body: Buffer | null = null;
let ctype = '';
let polls = 0;
await ctx.route('https://www.pixiv.net/**', async (route) => {
  const req = route.request();
  if (req.url().includes('/progress?convertKey=')) {
    polls++;
    const body = polls < 3 ? { status: 'RUNNING' } : { status: 'COMPLETE', illustId: '999' };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: false, message: '', body }) });
  }
  if (req.method() === 'POST') {
    body = req.postDataBuffer();
    ctype = req.headers()['content-type'];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: false, message: '', body: { convertKey: 'x' } }) });
  }
  return route.fulfill({ contentType: 'text/html', body: html });
});

const result = await pixiv.post(ctx, { meta: { title: 'Test', description: 'd', tags: ['a', 'b'] }, nsfw: false, files, options: { restrict: 'private' } }, (m) => console.log('  log:', m));
await browser.close();
console.log(`url: ${result.url} · appels /progress: ${polls}`);

if (!body) throw new Error('aucune requête capturée');
const boundary = ctype.split('boundary=')[1];
const parts = (body as Buffer).toString('latin1').split(`--${boundary}`).slice(1, -1);
const summary = parts.map((p) => {
  const name = /name="([^"]+)"/.exec(p)?.[1];
  const fname = /filename="([^"]+)"/.exec(p)?.[1];
  const size = p.length;
  return fname ? `${name} = <${fname}, ${(size / 1024).toFixed(0)} Ko>` : `${name} = ${p.split('\r\n\r\n')[1]?.trim()}`;
});
const filesSent = summary.filter((s) => s.startsWith('files[]'));
console.log(`fichiers en entrée: ${files.length} · files[] envoyés: ${filesSent.length}`);
console.log(summary.filter((s) => s.startsWith('files[]') || s.startsWith('imageOrder')).join('\n'));
