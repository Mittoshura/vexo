// E2E « 1 post multi-images » (serveur ARTPOST_MOCK=1, PORT=3299, ARTPOST_DATA=copie).
import { chromium } from 'playwright';
import path from 'node:path';

const API = process.env.API ?? 'http://127.0.0.1:3299';
const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
const j = async (url, init) => (await fetch(API + url, init)).json();

await fetch(API + '/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 'delay.pixiv': '0' }) });
await j('/api/accounts/pixiv/check', { method: 'POST' });
const before = new Set((await j('/api/jobs')).jobs.map((x) => x.id));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(API + '/');
await page.waitForSelector('section .grid > div');
const cards = page.locator('section .grid > div');
const n = await cards.count();
await cards.nth(0).click();
await cards.nth(n - 1).click({ modifiers: ['Shift'] });
await page.locator('button', { hasText: 'Publish' }).first().click();
await page.waitForSelector('text=Grouping');
await page.getByText('1 multi-image post').click();
await page.getByText('Private', { exact: true }).click();
await page.screenshot({ path: `${out}/grouped-dialog.png` });
await page.locator('button', { hasText: /^Queue ·/ }).click();

let mine = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  mine = (await j('/api/jobs')).jobs.filter((x) => !before.has(x.id));
  if (mine.length && mine.every((x) => ['done', 'failed'].includes(x.status))) break;
}
console.log(`images sélectionnées: ${n} · jobs créés: ${mine.length}`);
for (const x of mine) console.log(x.status, `${x.image_ids.length} image(s)`, x.log.join(' | '));
await browser.close();
