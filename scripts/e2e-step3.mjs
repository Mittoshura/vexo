// E2E étape 3 (serveur lancé avec ARTPOST_MOCK=1) : connexion simulée, dialogue Publier, file, historique.
import { chromium } from 'playwright';
import path from 'node:path';

const API = 'http://127.0.0.1:3210';
const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
const j = async (url, init) => (await fetch(API + url, init)).json();

// délai court pour le test
await fetch(API + '/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 'delay.pixiv': '3' }) });
// "connexion" mock
let acc = await j('/api/accounts/pixiv/check', { method: 'POST' });
console.log('pixiv:', acc[0].connected, acc[0].username);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(API + '/');
await page.waitForSelector('section .grid > div');
const cards = page.locator('section .grid > div');

// sélection de 3 images (dont #1 avec tags), ouverture du dialogue
await cards.nth(3).click();
await cards.nth(5).click({ modifiers: ['Shift'] });
await page.locator('button', { hasText: 'Publish' }).first().click();
await page.waitForSelector('text=Grouping');
await page.screenshot({ path: `${out}/9-publish.png` });

// 1 post par image, privé, mettre en file
await page.getByText('1 post per image').click();
await page.getByText('Private', { exact: true }).click();
await page.locator('button', { hasText: /^Queue ·/ }).click();
await page.waitForSelector('text=Queued', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/10-queue.png` });

// attendre que tout passe (3 jobs × (1.5 s + délai 3 s))
let jobs;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  jobs = await j('/api/jobs');
  if (jobs.jobs.every((x) => x.status === 'done' || x.status === 'failed')) break;
}
console.log('statuts:', jobs.jobs.map((x) => `${x.status}${x.result?.url ? ' ' + x.result.url : ''}`).join(' | '));
const t = jobs.jobs.map((x) => Date.parse(x.finished_at)).sort();
console.log('écarts entre fins (s):', t.slice(1).map((v, i) => ((v - t[i]) / 1000).toFixed(1)).join(', '));

await page.getByRole('button', { name: /History/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/11-history.png` });

// retour bibliothèque : badges "publié"
await page.getByRole('button', { name: /Library/ }).click();
await page.waitForTimeout(600);
const imgs = await j('/api/images');
console.log('images avec posts:', imgs.filter((i) => i.posts.length).length);

// plateformes
await page.getByRole('button', { name: /Platforms/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/12-platforms.png` });

// test échec : titre FAIL
const target = imgs[0];
await fetch(API + '/api/images', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [target.id], title: 'FAIL test' }) });
await j('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'pixiv', imageIds: [target.id], mode: 'single' }) });
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  jobs = await j('/api/jobs');
  const f = jobs.jobs.find((x) => x.images[0]?.title === 'FAIL test');
  if (f && f.status !== 'queued' && f.status !== 'running') {
    console.log('job FAIL →', f.status, '|', f.error);
    break;
  }
}
await page.getByRole('button', { name: /History/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/13-history-fail.png` });

console.log('ERRORS:', errors);
await browser.close();
