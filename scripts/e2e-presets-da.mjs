// E2E: Pixiv short auto-title, tag presets (chips + page), DeviantArt publish (mock).
// Server: ARTPOST_MOCK=1 ARTPOST_DATA=<empty dir> PORT=3299 npm run start
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const API = process.env.API ?? 'http://127.0.0.1:3299';
const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
fs.mkdirSync(out, { recursive: true });
const j = async (url, init) => {
  const r = await fetch(API + url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json();
};
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---- setup: 3 characters, DA delay 0, mock logins ----
const ch = (danbooru, nameEn, nameJa) => ({ danbooru, nameEn, nameJa, pixivTag: '', seriesEn: 'Dr. Stone', seriesJa: 'Dr.STONE', promptTriggers: [danbooru.replace(/_/g, ' ')], loraTriggers: [], extraTags: [], enabled: true });
for (const c of [ch('ishigami_senkuu', 'Ishigami Senkuu', '石神千空'), ch('kohaku_(dr._stone)', 'Kohaku', 'コハク'), ch('chrome_(dr._stone)', 'Chrome', 'クロム')]) await j('/api/characters', send('POST', c));
await j('/api/settings', send('PATCH', { 'autotag.lang': 'en', 'delay.deviantart': '0', 'delay.pixiv': '0' }));
for (const p of ['pixiv', 'deviantart']) await j(`/api/accounts/${p}/check`, { method: 'POST' });

// ---- images: #1 has all three characters (long title) ----
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const addText = (png, key, text) => Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])), png.subarray(33)]);
const fd = new FormData();
for (const [i, color] of ['#e5383b', '#3a86ff', '#06d6a0'].entries()) {
  let png = await sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).png().toBuffer();
  if (i === 0) png = addText(png, 'parameters', 'ishigami senkuu, kohaku (dr. stone), chrome (dr. stone), 3people\nNegative prompt: ugly\nSteps: 20, Seed: 1');
  fd.append('files', new Blob([png], { type: 'image/png' }), `ComfyUI_0020${i}_.png`);
}
const up = await j('/api/images', { method: 'POST', body: fd });
const group = up.added.find((i) => i.original_name === 'ComfyUI_00200_.png');
console.log('common title:', JSON.stringify(group.title), `(${group.title.length})`, '· overrides:', JSON.stringify(group.overrides));
assert.equal(group.title, 'Ishigami Senkuu & Kohaku & Chrome / Dr. Stone');
assert.equal(group.overrides.pixiv?.title, 'Ishigami Senkuu +2');
assert.equal(group.overrides.deviantart, undefined, 'fits in 50: no DA override');

// switch to JP: generated titles follow, Pixiv override too (fits → removed)
await j('/api/settings', send('PATCH', { 'autotag.lang': 'ja' }));
let at = await j('/api/images/autotag', send('POST', { ids: [group.id] }));
console.log('JP title:', JSON.stringify(at.images[0].title), '· overrides:', JSON.stringify(at.images[0].overrides));
assert.equal(at.images[0].title, '石神千空 & コハク & クロム / Dr.STONE');
assert.equal(at.images[0].overrides.pixiv, undefined, 'JP title fits in 32: Pixiv override removed');
await j('/api/settings', send('PATCH', { 'autotag.lang': 'en' }));
at = await j('/api/images/autotag', send('POST', { ids: [group.id] }));
assert.equal(at.images[0].overrides.pixiv?.title, 'Ishigami Senkuu +2');
// a title typed by the user is never touched
await j('/api/images', send('PATCH', { ids: [group.id], platform: 'pixiv', title: 'My own title' }));
at = await j('/api/images/autotag', send('POST', { ids: [group.id] }));
assert.equal(at.images[0].overrides.pixiv.title, 'My own title');
await j('/api/images', send('PATCH', { ids: [group.id], platform: 'pixiv', clearOverride: true }));
await j('/api/images/autotag', send('POST', { ids: [group.id] }));
console.log('short title: OK');

// ---- browser ----
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(API + '/');

// Presets page: create "Beach"
await page.getByRole('button', { name: /Presets/ }).click();
await page.locator('button', { hasText: 'New preset' }).click();
await page.getByPlaceholder('e.g. Beach set').fill('Beach');
const tagInput = page.locator('aside').getByPlaceholder('tag, tag, tag…');
await tagInput.fill('beach, bikini, summer');
await tagInput.press('Enter');
await page.locator('button', { hasText: 'Create preset' }).click();
await page.waitForSelector('li >> text=Beach');
await page.screenshot({ path: `${out}/p-1-presets.png` });
assert.deepEqual((await j('/api/presets'))[0].tags, ['beach', 'bikini', 'summer']);

// Library: select all, chip adds tags in bulk, again removes
await page.getByRole('button', { name: /Library/ }).click();
await page.waitForSelector('section .grid > div');
await page.keyboard.press('Control+a');
await page.getByRole('button', { name: 'Tag set Beach' }).click();
await page.waitForTimeout(600);
let imgs = await j('/api/images');
assert.ok(imgs.every((i) => ['beach', 'bikini', 'summer'].every((t) => i.tags.includes(t))), 'chip adds to all');
await page.screenshot({ path: `${out}/p-2-chips.png` });
await page.getByRole('button', { name: 'Tag set Beach' }).click();
await page.waitForTimeout(600);
imgs = await j('/api/images');
assert.ok(imgs.every((i) => !i.tags.includes('beach')), 'second click removes from all');
console.log('tag sets: OK');

// DeviantArt: 3 images, 1 deviation, folder "Characters", one image R-18
await j('/api/images', send('PATCH', { ids: [imgs[1].id], nsfw: true }));
await page.reload();
await page.waitForSelector('section .grid > div');
await page.keyboard.press('Control+a');
await page.locator('button', { hasText: /^Publish/ }).first().click();
const dlg = page.locator('div.fixed.inset-0');
await dlg.locator('button', { hasText: /^DeviantArt$/ }).click();
await page.getByText('1 multi-image post').click();
await page.waitForSelector('option >> text=Characters', { state: 'attached' });
await dlg.locator('select').first().selectOption({ label: '\u00a0\u00a0└ Characters' });
await page.screenshot({ path: `${out}/p-3-publish-da.png` });
await page.locator('button', { hasText: /^Queue ·/ }).click();
let jobs;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  jobs = (await j('/api/jobs')).jobs.filter((x) => x.platform === 'deviantart');
  if (jobs.length && jobs.every((x) => x.status === 'done' || x.status === 'failed')) break;
}
console.log('DA jobs:', jobs.map((x) => `${x.status} ${x.image_ids.length} img · ${x.log.join(' | ')}`));
assert.equal(jobs.length, 1);
assert.equal(jobs[0].status, 'done');
assert.equal(jobs[0].image_ids.length, 3);
assert.ok(jobs[0].log.some((l) => l.includes('"folderId":"3"') && l.includes('nsfw true') && l.includes('"noai":"1"')));
await page.screenshot({ path: `${out}/p-4-queue.png` });
console.log('browser errors:', errors.length ? errors : 'none');
await browser.close();
console.log('E2E presets + DeviantArt: OK');
