import type { BrowserContext, Page } from 'playwright';
import type { PlatformId, Meta } from '../../../shared/platforms.js';

import type { ComfyMeta } from '../db.js';

export type PostFile = { path: string; name: string; mime: string; width?: number; height?: number; gen?: ComfyMeta | null };

export type PostInput = {
  meta: Meta;
  nsfw: boolean;
  files: PostFile[];
  options: Record<string, string>; // job options (e.g. restrict) merged with settings
};

export type PostResult = { url: string | null; remoteId: string | null; raw?: unknown };

export type LoginStatus = { connected: boolean; username: string | null };

export interface Adapter {
  id: PlatformId;
  loginUrl: string;
  cookieDomain: string;
  /** Checks the session on an already open page (or opens one). */
  checkLogin(ctx: BrowserContext): Promise<LoginStatus>;
  /** URL prefix of the site once logged in (the login loop only checks pages under it). */
  homePrefix: string;
  /** Login status read from an already-open page (used while the user logs in). */
  statusOnPage(page: Page): Promise<LoginStatus>;
  post(ctx: BrowserContext, input: PostInput, log: (msg: string) => void): Promise<PostResult>;
}
