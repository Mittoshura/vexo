// E2E: Civitai / X / SubscribeStar in the UI (mock adapters). Server: ARTPOST_MOCK=1 ARTPOST_DATA=<empty> PORT=3299 npm run start
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

// a minor character (manual age, no network) + delays 0 + mock logins
await j('/api/characters', send('POST', { danbooru: 'kohaku_(dr._stone)', nameEn: 'Kohaku', nameJa: 'コハク', seriesEn: 'Dr. Stone', seriesJa: 'Dr.STONE', promptTriggers: ['kohaku (dr. stone)'], ageText: '16-23 (physically)', ageSource: 'manual', youngScore: 0.4 }));
const delays = Object.fromEntries(['pixiv', 'deviantart', 'civitai', 'x', 'subscribestar'].map((p) => [`delay.${p}`, '0']));
await j('/api/settings', send('PATCH', delays));
for (const p of ['civitai', 'x', 'subscribestar']) await j(`/api/accounts/${p}/check`, { method: 'POST' });
const accounts = await j('/api/accounts');
assert.deepEqual(accounts.filter((a) => a.connected).map((a) => a.id).sort(), ['civitai', 'subscribestar', 'x']);

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const addText = (png, key, text) => Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])), png.subarray(33)]);
const fd = new FormData();
for (const [i, color] of ['#e5383b', '#3a86ff'].entries()) {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).png().toBuffer();
  fd.append('files', new Blob([addText(png, 'parameters', `${i === 0 ? 'kohaku (dr. stone), ' : ''}1girl, beach\nNegative prompt: x\nSteps: 20, Seed: 1`)], { type: 'image/png' }), `img${i}.png`);
}
const imgs = (await j('/api/images', { method: 'POST', body: fd })).added;
const kohaku = imgs.find((i) => i.original_name === 'img0.png');
const other = imgs.find((i) => i.original_name === 'img1.png');
await j('/api/images', send('PATCH', { ids: [kohaku.id, other.id], description: 'Summer set', tags: ['beach'], tagsMode: 'add' }));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(API + '/');

await page.getByRole('button', { name: /Platforms/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/pl-1-platforms.png` });

const dlg = page.locator('div.fixed.inset-0');
const publish = async (platform, setup) => {
  await page.getByRole('button', { name: /Library/ }).click();
  await page.waitForSelector('section .grid > div');
  await page.keyboard.press('Control+a');
  await page.locator('button', { hasText: /^Publish/ }).first().click();
  await dlg.locator('button', { hasText: new RegExp(`^${platform === 'SubscribeStar' ? 'SubStar' : platform}$`) }).click();
  await page.waitForTimeout(300);
  if (setup) await setup();
  await dlg.locator('button', { hasText: /^Queue ·/ }).click();
};
const waitJobs = async (platform) => {
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    const js = (await j('/api/jobs')).jobs.filter((x) => x.platform === platform);
    if (js.length && js.every((x) => x.status === 'done' || x.status === 'failed')) return js;
  }
  throw new Error(`${platform}: jobs did not finish`);
};

// SubscribeStar: pick the "Fan" tier; SFW → no age warning
await publish('SubscribeStar', async () => {
  await page.waitForSelector('text=Fan ($10)');
  await dlg.locator('button', { hasText: 'Fan ($10)' }).click();
  assert.equal(await dlg.locator('text=Ban risk').count(), 0, 'SFW Kohaku on SubscribeStar: no warning');
  await page.screenshot({ path: `${out}/pl-2-subscribestar.png` });
});
let js = await waitJobs('subscribestar');
console.log('SubscribeStar:', js.map((x) => `${x.status} ${x.image_ids.length} img · ${x.log[0]}`));
assert.ok(js[0].log[0].includes('Fan ($10)') && js[0].log.some((l) => l.includes('"tiers":"12"')));

// X: Kohaku image R-18 → age warning + ack; log shows "sensitive"
await j('/api/images', send('PATCH', { ids: [kohaku.id], nsfw: true }));
await page.reload();
await publish('X', async () => {
  await page.waitForSelector('text=Ban risk on X');
  const btn = dlg.locator('button', { hasText: /^Queue ·/ });
  assert.equal(await btn.isDisabled(), true, 'X + R-18 minor → blocked until ack');
  await page.screenshot({ path: `${out}/pl-3-x-risk.png` });
  await dlg.getByText('I understand the risk, post anyway').click();
});
js = await waitJobs('x');
console.log('X:', js.map((x) => `${x.status} ${x.image_ids.length} img · ${x.log[0]}`));
assert.ok(js.some((x) => x.log[0].includes('sensitive')));

// Civitai: same warning; metadata travels with the files (mock logs the options only)
await publish('Civitai', async () => {
  await page.waitForSelector('text=Ban risk on Civitai');
  await dlg.getByText('I understand the risk, post anyway').click();
});
js = await waitJobs('civitai');
console.log('Civitai:', js.map((x) => `${x.status} ${x.image_ids.length} img · ${x.result?.url}`));
assert.ok(js.every((x) => x.status === 'done'));

// inspector: 6 tabs fit
await page.getByRole('button', { name: /Library/ }).click();
await page.waitForSelector('section .grid > div');
await page.locator('section .grid > div').first().click();
const tabs = await page.evaluate(() => {
  const t = [...document.querySelectorAll('aside button')].find((b) => b.textContent?.trim() === 'SubStar');
  const row = t?.parentElement;
  return row ? { scroll: row.scrollWidth, client: row.clientWidth } : null;
});
console.log('inspector tabs:', JSON.stringify(tabs));
assert.ok(tabs && tabs.scroll <= tabs.client, 'tabs do not overflow');
await page.screenshot({ path: `${out}/pl-4-inspector.png` });
console.log('browser errors:', errors.length ? errors : 'none');
await browser.close();
console.log('E2E platforms: OK');
