// Screenshots for the Civitai page / README. Server: ARTPOST_MOCK=1 ARTPOST_DATA=<empty> PORT=3299 npm run start
// Usage: node scripts/shots-demo.mjs <demoImagesDir> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://127.0.0.1:3299';
const [demo, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const j = async (url, init) => {
  const r = await fetch(API + url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json();
};
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// characters (real Danbooru + AniList lookup)
for (const tag of ['frieren', 'fern_(sousou_no_frieren)', 'hatsune_miku']) await j('/api/characters', send('POST', await j(`/api/characters/lookup?tag=${encodeURIComponent(tag)}`)));
await j('/api/settings', send('PATCH', { 'autotag.lang': 'en', ...Object.fromEntries(['pixiv', 'deviantart', 'civitai', 'x', 'subscribestar'].map((p) => [`delay.${p}`, '0'])) }));
for (const p of ['pixiv', 'deviantart', 'civitai', 'x', 'subscribestar']) await j(`/api/accounts/${p}/check`, { method: 'POST' });

// presets
await j('/api/presets', send('POST', { name: 'Scenery', tags: ['scenery', 'landscape', 'wallpaper'] }));
await j('/api/presets', send('POST', { name: 'AI art', tags: ['ai art', 'ai generated', 'comfyui'] }));
await j('/api/presets', send('POST', { name: 'Night sky', tags: ['night', 'stars', 'night sky'] }));

// import (auto-tag runs on import)
const fd = new FormData();
for (const f of fs.readdirSync(demo).filter((x) => x.endsWith('.png') && !x.startsWith('_')).sort().reverse())
  fd.append('files', new Blob([fs.readFileSync(path.join(demo, f))], { type: 'image/png' }), f);
const imgs = (await j('/api/images', { method: 'POST', body: fd })).added;
const by = (k) => imgs.find((i) => i.original_name.includes(k));
const titles = { neon_city: 'Neon Rain', sakura: 'Shrine in Spring', space_planet: 'Ringed World', forest_lake: 'Morning by the Lake' };
for (const [k, t] of Object.entries(titles)) await j('/api/images', send('PATCH', { ids: [by(k).id], title: t }));
await j('/api/images', send('PATCH', { ids: imgs.map((i) => i.id), tags: ['scenery', 'ai art'], tagsMode: 'add', description: 'Made with ComfyUI.' }));

// some history: two posts already out
await j('/api/jobs', send('POST', { platform: 'pixiv', imageIds: [by('space_planet').id, by('neon_city').id], mode: 'grouped', options: { restrict: 'public' } }));
await j('/api/jobs', send('POST', { platform: 'deviantart', imageIds: [by('forest_lake').id], mode: 'single', options: { folderId: '2', folderName: 'AI Art' } }));
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if ((await j('/api/jobs')).jobs.every((x) => x.status === 'done')) break;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.25 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 400)));
await page.goto(API + '/');
await page.waitForSelector('section .grid > div');
await page.waitForTimeout(800);
const cards = page.locator('section .grid > div');
const idx = async (k) => {
  const all = await page.evaluate(() => [...document.querySelectorAll('section .grid > div img')].map((i) => i.getAttribute('src')));
  return all.findIndex((s) => s?.includes(by(k).id));
};
// 1. library: 3 selected, inspector on Frieren + Fern images
const a = await idx('sunset_sea'), b = await idx('aurora'), c = await idx('sakura');
await cards.nth(a).click();
await cards.nth(b).click({ modifiers: ['Control'] });
await cards.nth(c).click({ modifiers: ['Control'] });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/1-library.png` });
// single image with detected character (in-page click: see note below)
await cards.nth(a).locator('img').first().evaluate((el) => el.click());
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/2-inspector.png` });
// From here on, use in-page clicks: after the Ctrl+click steps, Playwright's real input events stop reaching
// this page in headless Edge at deviceScaleFactor 1.25 (DOM-dispatched events still work).
const domClick = (loc) => loc.first().evaluate((el) => el.click());
// 3. publish dialog, whole library selected
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })));
await page.waitForTimeout(300);
await domClick(page.locator('header button', { hasText: /^Publish/ }));
await page.waitForSelector('text=Grouping');
await domClick(page.locator('div.fixed.inset-0 button', { hasText: '1 multi-image post' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/3-publish.png` });
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
await page.waitForTimeout(300);
// 4. characters
await domClick(page.locator('aside nav button', { hasText: 'Characters' }));
await page.waitForSelector('td >> text=Hatsune Miku');
await domClick(page.locator('tr', { hasText: 'Hatsune Miku' }));
await page.waitForSelector('text=DeviantArt age check');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/4-characters.png` });
// 5. history
await domClick(page.locator('aside nav button', { hasText: 'History' }));
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/5-history.png` });
// 6. presets
await domClick(page.locator('aside nav button', { hasText: 'Presets' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/6-presets.png` });
await browser.close();
console.log('screenshots →', out);
