import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

export const DEFAULTS: Record<string, string> = {
  'delay.pixiv': '600', // seconds between two posts
  'delay.deviantart': '600',
  'delay.civitai': '300',
  'delay.x': '900',
  'delay.subscribestar': '600',
  hideBrowser: '0', // 1 = browser window off-screen while sending
  'pixiv.aiType': 'aiGenerated',
  'pixiv.restrict': 'public',
  'pixiv.allowTagEdit': '1',
  'deviantart.aiGenerated': '1', // "Created using AI tools"
  'deviantart.noai': '1', // forbid use in AI datasets
};

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function allSettings(): Record<string, string> {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) out[r.key] = r.value;
  return out;
}
