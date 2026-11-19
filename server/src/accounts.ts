import type { FastifyInstance } from 'fastify';
import { PLATFORMS, type PlatformId } from '../../shared/platforms.js';
import { ADAPTERS, isImplemented } from './platforms/index.js';
import { withBrowser, close as closeBrowser, clearCookies } from './browser.js';
import { getSetting, setSetting } from './settings.js';
import { listFolders, type DaFolder } from './platforms/deviantart.js';
import { listTiers, type SsTier } from './platforms/subscribestar.js';

const MOCK_FOLDERS: DaFolder[] = [
  { id: '1', name: 'Featured', parentId: null },
  { id: '2', name: 'AI Art', parentId: null },
  { id: '3', name: 'Characters', parentId: '2' },
];

const MOCK_TIERS: SsTier[] = [
  { id: '11', name: 'Supporter ($3)' },
  { id: '12', name: 'Fan ($10)' },
];

/** SubscribeStar tiers, cached in settings (refresh = fetch from the account). */
export async function ssTiers(refresh: boolean): Promise<SsTier[]> {
  if (!refresh) {
    const cached = getSetting('subscribestar.tiers');
    if (cached) return JSON.parse(cached);
  }
  const tiers = process.env.ARTPOST_MOCK === '1' ? MOCK_TIERS : await withBrowser(getSetting('hideBrowser') === '1', (ctx) => listTiers(ctx));
  setSetting('subscribestar.tiers', JSON.stringify(tiers));
  return tiers;
}

/** DeviantArt gallery folders, cached in settings (refresh = fetch from the account). */
export async function daFolders(refresh: boolean): Promise<DaFolder[]> {
  if (!refresh) {
    const cached = getSetting('deviantart.folders');
    if (cached) return JSON.parse(cached);
  }
  const folders = process.env.ARTPOST_MOCK === '1' ? MOCK_FOLDERS : await withBrowser(getSetting('hideBrowser') === '1', (ctx) => listFolders(ctx));
  setSetting('deviantart.folders', JSON.stringify(folders));
  return folders;
}

type AccountState = {
  connected: boolean;
  username: string | null;
  checkedAt: string | null;
  loginInProgress: boolean;
  error: string | null;
};

const state = new Map<PlatformId, AccountState>();
for (const p of PLATFORMS) {
  state.set(p, {
    connected: getSetting(`acct.${p}.connected`) === '1',
    username: getSetting(`acct.${p}.username`) || null,
    checkedAt: getSetting(`acct.${p}.checkedAt`) || null,
    loginInProgress: false,
    error: null,
  });
}

function persist(p: PlatformId) {
  const s = state.get(p)!;
  setSetting(`acct.${p}.connected`, s.connected ? '1' : '0');
  setSetting(`acct.${p}.username`, s.username ?? '');
  setSetting(`acct.${p}.checkedAt`, s.checkedAt ?? '');
}

export function accountSnapshot() {
  return PLATFORMS.map((p) => ({ id: p, implemented: isImplemented(p), ...state.get(p)! }));
}

export function isConnected(p: PlatformId) {
  return state.get(p)?.connected ?? false;
}

export async function check(p: PlatformId) {
  const a = ADAPTERS[p];
  const s = state.get(p)!;
  if (!a) return s;
  try {
    const r = await withBrowser(getSetting('hideBrowser') === '1', (ctx) => a.checkLogin(ctx));
    s.connected = r.connected;
    s.username = r.username;
    s.error = null;
    if (p === 'deviantart' && r.connected) await daFolders(true).catch(() => {});
    if (p === 'subscribestar' && r.connected) await ssTiers(true).catch(() => {});
  } catch (e) {
    s.error = (e as Error).message;
  }
  s.checkedAt = new Date().toISOString();
  persist(p);
  await closeBrowser();
  return s;
}

/** Opens a browser window on the login page and waits for the user to log in (10 min max). */
export function startLogin(p: PlatformId) {
  const a = ADAPTERS[p];
  const s = state.get(p)!;
  if (!a || s.loginInProgress) return;
  s.loginInProgress = true;
  s.error = null;
  void withBrowser(false, async (ctx) => {
    const page = await ctx.newPage();
    try {
      await page.goto(a.loginUrl, { waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2500);
        if (page.isClosed()) throw new Error('Window closed before login.');
        const url = page.url();
        if (!url.startsWith(a.homePrefix)) continue;
        const st = await a.statusOnPage(page).catch(() => null);
        if (st?.connected) {
          s.connected = true;
          s.username = st.username;
          s.checkedAt = new Date().toISOString();
          persist(p);
          if (p === 'deviantart') await listFolders(ctx).then((f) => setSetting('deviantart.folders', JSON.stringify(f))).catch(() => {});
          if (p === 'subscribestar') await listTiers(ctx).then((t) => setSetting('subscribestar.tiers', JSON.stringify(t))).catch(() => {});
          return;
        }
      }
      throw new Error('Timed out (10 min).');
    } finally {
      await page.close().catch(() => {});
    }
  })
    .catch((e) => {
      s.error = (e as Error).message;
    })
    .finally(async () => {
      s.loginInProgress = false;
      // Close the visible window; the profile keeps the cookies.
      await closeBrowser();
    });
}

export async function logout(p: PlatformId) {
  const a = ADAPTERS[p];
  const s = state.get(p)!;
  if (a) await clearCookies(a.cookieDomain);
  s.connected = false;
  s.username = null;
  s.checkedAt = new Date().toISOString();
  persist(p);
  await closeBrowser();
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => accountSnapshot());

  app.post('/api/accounts/:id/login', async (req, reply) => {
    const id = (req.params as any).id as PlatformId;
    if (!isImplemented(id)) return reply.code(400).send({ error: 'platform not implemented' });
    startLogin(id);
    return accountSnapshot();
  });

  app.post('/api/accounts/:id/check', async (req, reply) => {
    const id = (req.params as any).id as PlatformId;
    if (!isImplemented(id)) return reply.code(400).send({ error: 'platform not implemented' });
    await check(id);
    return accountSnapshot();
  });

  app.get('/api/accounts/deviantart/folders', async (req, reply) => {
    if (!isConnected('deviantart')) return reply.code(400).send({ error: 'Not logged in to DeviantArt.' });
    try {
      return await daFolders((req.query as any).refresh === '1');
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    } finally {
      if ((req.query as any).refresh === '1') await closeBrowser();
    }
  });

  app.get('/api/accounts/subscribestar/tiers', async (req, reply) => {
    if (!isConnected('subscribestar')) return reply.code(400).send({ error: 'Not logged in to SubscribeStar.' });
    try {
      return await ssTiers((req.query as any).refresh === '1');
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    } finally {
      if ((req.query as any).refresh === '1') await closeBrowser();
    }
  });

  app.post('/api/accounts/:id/logout', async (req) => {
    await logout((req.params as any).id as PlatformId);
    return accountSnapshot();
  });
}
