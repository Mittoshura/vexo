import type { Override, PlatformId } from '@shared/platforms';
export type { Override, PlatformId, TagRule } from '@shared/platforms';
export type { Character, Detection, AutotagOptions, TagLang } from '@shared/autotag';

export type ComfyMeta = {
  positive?: string;
  negative?: string;
  model?: string;
  loras?: string[];
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  source: 'comfyui' | 'a1111';
};

export type Image = {
  id: string;
  original_name: string;
  ext: string;
  hash: string;
  width: number;
  height: number;
  size: number;
  title: string;
  description: string;
  tags: string[];
  nsfw: boolean;
  comfy: ComfyMeta | null;
  overrides: Partial<Record<PlatformId, Override>>;
  posts: { platform: PlatformId; url: string | null; posted_at: string }[];
  created_at: string;
  url: string;
  thumb: string;
};

export type Preset = {
  id: string;
  name: string;
  title: string;
  description: string;
  tags: string[];
};

export type BulkPatch = {
  ids: string[];
  title?: string;
  description?: string;
  tags?: string[];
  tagsMode?: 'replace' | 'add' | 'remove';
  nsfw?: boolean;
  platform?: PlatformId;
  clearOverride?: boolean;
};

export type Account = {
  id: PlatformId;
  implemented: boolean;
  connected: boolean;
  username: string | null;
  checkedAt: string | null;
  loginInProgress: boolean;
  error: string | null;
};

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type Job = {
  id: string;
  platform: PlatformId;
  image_ids: string[];
  images: { id: string; title: string; thumb: string; nsfw: boolean }[];
  status: JobStatus;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  options: Record<string, string>;
  result: { url: string | null; remoteId: string | null; raw?: unknown } | null;
  error: string | null;
  log: string[];
  created_at: string;
};
export type JobsResponse = { jobs: Job[]; running: string | null; nextSlot: Record<PlatformId, string | null> };

export type CreateJobs = {
  platform: PlatformId;
  imageIds: string[];
  mode: 'single' | 'grouped';
  scheduledAt?: string | null;
  options?: Record<string, string>;
};

export type TagRuleRow = { id: string; platform: PlatformId; src: string; dst: string };
