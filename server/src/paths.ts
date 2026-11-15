import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// `ARTPOST_DATA=<dir>`: alternate data dir (test on a copy without touching the real data).
export const DATA_DIR = process.env.ARTPOST_DATA ? path.resolve(process.env.ARTPOST_DATA) : path.join(ROOT, 'data');
export const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
