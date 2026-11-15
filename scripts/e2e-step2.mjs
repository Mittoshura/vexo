// E2E étape 2 : overrides par plateforme + règles de tags
import { chromium } from 'playwright';
import path from 'node:path';

const out = path.join(process.env.TMPDIR ?? '.', 'artpost-shots');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://127.0.0.1:3210/');
await page.waitForSelector('section .grid > div', { timeout: 10000 });
const cards = page.locator('section .grid > div');
const aside = page.locator('aside:last-of-type');

// 1) commun : tags sur la dernière image (celle avec comfy)
await cards.nth(5).click();
await aside.locator('div.field input').fill('1girl, ai art, space bear, un tag beaucoup trop long pour pixiv vraiment');
await page.keyboard.press('Enter');
await aside.locator('button', { hasText: 'Apply' }).click();
await page.waitForTimeout(400);

// 2) onglet Pixiv : aperçu hérité avec règles (1girl -> 女の子)
await aside.getByRole('button', { name: 'Pixiv', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/5-pixiv-inherit.png` });
const inherit = await aside.innerText();
if (!inherit.includes('女の子')) throw new Error('règle pixiv non appliquée');
if (!inherit.includes('Titre : ')) console.log('note: titre OK <=32');

// 3) activer valeurs spécifiques, changer le titre, appliquer
await aside.getByRole('switch').click();
await aside.locator('input.field').first().fill('Ours spatial 宇宙クマ');
await aside.locator('button', { hasText: 'Apply' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/6-pixiv-override.png` });

// vérifier côté API
const img = (await (await fetch('http://127.0.0.1:3210/api/images')).json()).find((i) => i.overrides.pixiv);
console.log('override pixiv:', JSON.stringify(img?.overrides.pixiv));
if (!img) throw new Error('override non sauvegardé');

// 4) onglet X : aperçu texte + compteur
await aside.getByRole('button', { name: 'X', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/7-x.png` });
console.log((await aside.innerText()).split('APERÇU X')[1]?.slice(0, 200));

// 5) revenir au commun
await aside.getByRole('button', { name: 'Pixiv', exact: true }).click();
await aside.locator('button', { hasText: 'Revert to common' }).click();
await page.waitForTimeout(400);
const img2 = (await (await fetch('http://127.0.0.1:3210/api/images')).json()).find((i) => i.id === img.id);
console.log('après reset, override pixiv =', JSON.stringify(img2.overrides.pixiv));

// 6) réglages : ajouter une règle
await page.getByRole('button', { name: /Settings/ }).click();
await page.locator('input[placeholder="tag commun"]').fill('space bear');
await page.locator('input[placeholder="tag Pixiv"]').fill('宇宙クマ');
await page.locator('button', { hasText: 'Add' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/8-settings.png` });
const rules = await (await fetch('http://127.0.0.1:3210/api/tag-rules')).json();
console.log('règles:', rules.length, rules.some((r) => r.dst === '宇宙クマ') ? 'ajoutée OK' : 'MANQUANTE');

console.log('ERRORS:', errors);
await browser.close();
