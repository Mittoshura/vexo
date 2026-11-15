// E2E: DeviantArt age check. Server: ARTPOST_MOCK=1 ARTPOST_DATA=<empty dir> PORT=3299 npm run start (real AniList/Danbooru)
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const API = 'http://127.0.0.1:3299';
const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
fs.mkdirSync(out, { recursive: true });
const j = async (url, init) => {
  const r = await fetch(API + url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json();
};
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

for (const tag of ['kohaku_(dr._stone)', 'frieren', 'kanna_kamui']) await j('/api/characters', send('POST', await j(`/api/characters/lookup?tag=${encodeURIComponent(tag)}`)));
await j('/api/accounts/deviantart/check', { method: 'POST' });

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const addText = (png, key, text) => Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])), png.subarray(33)]);
const fd = new FormData();
for (const [name, color, prompt] of [['A_kohaku.png', '#e5383b', 'kohaku (dr. stone), 1girl, bikini'], ['B_frieren.png', '#3a86ff', 'frieren, 1girl, elf']]) {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).png().toBuffer();
  fd.append('files', new Blob([addText(png, 'parameters', `${prompt}\nNegative prompt: x\nSteps: 20, Seed: 1`)], { type: 'image/png' }), name);
}
const imgs = (await j('/api/images', { method: 'POST', body: fd })).added;
const kohakuImg = imgs.find((i) => i.original_name === 'A_kohaku.png');
const frierenImg = imgs.find((i) => i.original_name === 'B_frieren.png');
await j('/api/images', send('PATCH', { ids: [kohakuImg.id], nsfw: true }));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(API + '/');

// Characters page: triangles + editor box
await page.getByRole('button', { name: /Characters/ }).click();
await page.waitForSelector('text=risky on DeviantArt');
const badge = await page.locator('text=/\\d+ risky on DeviantArt/').innerText();
console.log('header:', badge);
assert.match(badge, /2 risky/); // Kohaku (16) + Kanna (drawn as a child)
await page.locator('td', { hasText: 'Kohaku' }).first().click();
await page.waitForSelector('text=DeviantArt age check');
await page.screenshot({ path: `${out}/age-1-characters.png` });

// Library: inspector chip triangle on the Kohaku image
await page.getByRole('button', { name: /Library/ }).click();
await page.waitForSelector('section .grid > div');
const cards = page.locator('section .grid > div');
for (let i = 0; i < (await cards.count()); i++) {
  await cards.nth(i).click();
  if (await page.locator('aside >> text=via prompt').count() && (await page.locator('aside span.chip', { hasText: 'Kohaku' }).count())) break;
}
assert.equal(await page.locator('aside span.chip', { hasText: 'Kohaku' }).getByRole('img', { name: /Minor/ }).count(), 1, 'triangle on chip');
await page.screenshot({ path: `${out}/age-2-inspector.png` });

// Publish to DeviantArt: warning + ack required
await page.keyboard.press('Control+a');
await page.locator('button', { hasText: /^Publish/ }).first().click();
const dlg = page.locator('div.fixed.inset-0');
await dlg.locator('button', { hasText: /^DeviantArt$/ }).click();
await page.waitForSelector('text=Ban risk on DeviantArt');
const queueBtn = dlg.locator('button', { hasText: /^Queue ·/ });
assert.equal(await queueBtn.isDisabled(), true, 'blocked until ack');
assert.equal(await dlg.locator('text=very likely to get the account banned').count(), 1, 'R-18 + minor → strong warning');
await page.screenshot({ path: `${out}/age-3-publish.png` });
await dlg.getByText('I understand the risk, post anyway').click();
assert.equal(await queueBtn.isDisabled(), false, 'enabled after ack');
// Pixiv: no age warning
await dlg.locator('button', { hasText: /^Pixiv$/ }).click().catch(() => {});
await page.keyboard.press('Escape');

// Frieren only → no warning
await page.keyboard.press('Escape');
for (let i = 0; i < (await cards.count()); i++) {
  await cards.nth(i).click();
  if (await page.locator('aside span.chip', { hasText: 'Frieren' }).count()) break;
}
await page.locator('button', { hasText: /^Publish/ }).first().click();
await dlg.locator('button', { hasText: /^DeviantArt$/ }).click();
await page.waitForTimeout(300);
assert.equal(await dlg.locator('text=Ban risk on DeviantArt').count(), 0, 'Frieren: no warning');
console.log('browser errors:', errors.length ? errors : 'none');
await browser.close();
console.log('E2E age check: OK');
