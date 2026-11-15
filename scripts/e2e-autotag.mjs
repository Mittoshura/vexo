// E2E auto-tag. Server: ARTPOST_DATA=<empty dir> PORT=3299 npm run start   (real Danbooru, no Pixiv)
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

// ---- PNGs with generation metadata ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const addText = (png, key, text) => Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])), png.subarray(33)]);
const graph = (prompt, lora) => JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'waiIllustrious_v140.safetensors' } },
  2: { class_type: 'LoraLoader', inputs: { lora_name: lora, model: ['1', 0], clip: ['1', 1] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'lowres', clip: ['2', 1] } },
  5: { class_type: 'KSampler', inputs: { seed: 1, steps: 28, cfg: 5, sampler_name: 'euler', scheduler: 'normal', positive: ['3', 0], negative: ['4', 0], model: ['2', 0] } },
});
const specs = [
  ['ComfyUI_00101_.png', '#e5383b', 'prompt', graph('masterpiece, 1girl, (kohaku \\(dr. stone\\):1.2), bikini, beach', 'detail_tweaker.safetensors')],
  ['ComfyUI_00102_.png', '#3a86ff', 'prompt', graph('1girl, elf, white hair, smile', 'chars/Frieren_SousouNoFrieren-v2.safetensors')],
  ['ComfyUI_00103_.png', '#06d6a0', 'parameters', '<lora:hatsune_miku_v3:0.8>, 1girl, twintails\nNegative prompt: ugly\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Model: sdxl'],
  ['ComfyUI_00104_.png', '#8338ec', 'prompt', graph('landscape, mountains, no humans', 'detail_tweaker.safetensors')],
];
const fd = new FormData();
for (const [name, color, key, text] of specs) {
  const png = await sharp({ create: { width: 640, height: 900, channels: 3, background: color } }).png().toBuffer();
  fd.append('files', new Blob([addText(png, key, text)], { type: 'image/png' }), name);
}

// ---- 1. characters: two via API (real Danbooru lookup) ----
for (const tag of ['kohaku_(dr._stone)', 'frieren']) {
  const draft = await j(`/api/characters/lookup?tag=${encodeURIComponent(tag)}`);
  await j('/api/characters', send('POST', draft));
}
await j('/api/settings', send('PATCH', { 'autotag.lang': 'en' }));

// ---- 2. third character through the UI search ----
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(API + '/');
await page.getByRole('button', { name: /Characters/ }).click();
await page.getByPlaceholder(/Add from Danbooru/).fill('hatsune mi');
await page.locator('li button', { hasText: /^hatsune_miku/ }).first().click();
await page.waitForSelector('text=New character');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/at-1-new-character.png` });
await page.locator('button', { hasText: 'Add to list' }).click();
await page.waitForSelector('td >> text=Hatsune Miku');
const chars = await j('/api/characters');
console.log('characters:', chars.map((c) => `${c.nameEn} | ${c.pixivTag || c.nameJa} | ${c.seriesEn} / ${c.seriesJa} | lora:${c.loraTriggers}`).join('\n  '));
assert.equal(chars.length, 3);

// ---- 3. import → auto-tag on import (EN) ----
const up = await j('/api/images', { method: 'POST', body: fd });
const byName = (imgs) => Object.fromEntries(imgs.map((i) => [i.original_name, i]));
let imgs = byName(up.added);
for (const [n, i] of Object.entries(imgs)) console.log('EN', n, '→', JSON.stringify(i.title), i.tags);
assert.deepEqual(imgs['ComfyUI_00101_.png'].tags, ['Kohaku', 'Dr. Stone']);
assert.equal(imgs['ComfyUI_00101_.png'].title, 'Kohaku / Dr. Stone');
assert.ok(imgs['ComfyUI_00102_.png'].tags.includes('Frieren'));
assert.ok(imgs['ComfyUI_00103_.png'].tags.includes('Hatsune Miku'));
assert.deepEqual(imgs['ComfyUI_00104_.png'].tags, []);
assert.equal(imgs['ComfyUI_00104_.png'].title, 'ComfyUI_00104_');

// ---- 4. switch to Japanese in Settings UI, re-run with the Library button ----
await page.reload();
await page.getByRole('button', { name: /Settings/ }).click();
await page.locator('label', { hasText: 'Tag language' }).locator('select').selectOption('ja');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/at-2-settings.png`, fullPage: true });
await page.getByRole('button', { name: /Library/ }).click();
await page.waitForSelector('section .grid > div');
await page.keyboard.press('Control+a');
await page.locator('button', { hasText: /^Auto-tag$/ }).click();
await page.waitForSelector('text=/Auto-tag: \\d+ images? updated/');
imgs = byName(await j('/api/images'));
for (const [n, i] of Object.entries(imgs)) console.log('JA', n, '→', JSON.stringify(i.title), i.tags);
assert.deepEqual(imgs['ComfyUI_00101_.png'].tags, ['コハク(Dr.STONE)', 'Dr.STONE']);
assert.equal(imgs['ComfyUI_00101_.png'].title, 'コハク / Dr.STONE', 'generated title follows the language');

// ---- 5. inspector chips, ✗ removes tags ----
const cards = page.locator('section .grid > div');
const n = await cards.count();
for (let i = 0; i < n; i++) {
  await cards.nth(i).click();
  if (await page.locator('aside >> text=Kohaku').count()) break;
}
await page.waitForSelector('text=Detected characters');
await page.screenshot({ path: `${out}/at-3-inspector.png` });
await page.getByRole('button', { name: 'Remove Kohaku tags' }).click();
await page.waitForTimeout(500);
imgs = byName(await j('/api/images'));
assert.deepEqual(imgs['ComfyUI_00101_.png'].tags, []);
console.log('chip ✗ → tags:', imgs['ComfyUI_00101_.png'].tags);

await page.getByRole('button', { name: /Characters/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/at-4-characters.png` });
console.log('browser errors:', errors.length ? errors : 'none');
await browser.close();
console.log('E2E auto-tag: OK');
