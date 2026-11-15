// Capture d'écran E2E avec Edge installé (pas de téléchargement de navigateur)
import { chromium } from 'playwright';
import path from 'node:path';

const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://127.0.0.1:3210/');
await page.waitForSelector('section .grid > div', { timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-library.png` });

const cards = page.locator('section .grid > div');
await cards.nth(0).click();
await cards.nth(2).click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/2-multi.png` });

// apply tags to 3 images
await page.locator('aside:last-of-type input[placeholder^="tag"]').fill('space, bear, ai art');
await page.keyboard.press('Enter');
await page.locator('aside:last-of-type').getByText('R-18', { exact: true }).click();
await page.locator('aside:last-of-type button', { hasText: 'Apply' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/3-applied.png` });

// single select with comfy
await cards.nth(5).click();
await page.waitForTimeout(300);
await page.locator('aside:last-of-type').getByText('Prompt', { exact: true }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/4-single.png` });

const inspector = await page.locator('aside:last-of-type').innerText();
console.log(inspector.slice(0, 600));
console.log('ERRORS:', errors);
await browser.close();
