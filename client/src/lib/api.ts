import type { Account, BulkPatch, Character, CreateJobs, Image, Job, JobsResponse, PlatformId, Preset, TagRuleRow } from './types';

export type CharacterDraft = Omit<Character, 'id'>;
export type DanbooruHit = { tag: string; label: string; count: number };

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listImages: () => fetch('/api/images').then((r) => j<Image[]>(r)),

  upload: (files: File[], onProgress?: (pct: number) => void) =>
    new Promise<{ added: Image[]; skipped: { name: string; reason: string }[] }>((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/images');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () =>
        xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText));
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send(fd);
    }),

  patchImages: (p: BulkPatch) => fetch('/api/images', json('PATCH', p)).then((r) => j<Image[]>(r)),
  deleteImages: (ids: string[]) => fetch('/api/images', json('DELETE', { ids })).then((r) => j<{ ok: true }>(r)),

  listCharacters: () => fetch('/api/characters').then((r) => j<Character[]>(r)),
  searchDanbooru: (q: string) => fetch(`/api/characters/search?q=${encodeURIComponent(q)}`).then((r) => j<DanbooruHit[]>(r)),
  lookupCharacter: (tag: string) => fetch(`/api/characters/lookup?tag=${encodeURIComponent(tag)}`).then((r) => j<CharacterDraft>(r)),
  createCharacter: (c: CharacterDraft) => fetch('/api/characters', json('POST', c)).then((r) => j<Character>(r)),
  updateCharacter: (id: string, c: CharacterDraft) => fetch(`/api/characters/${id}`, json('PUT', c)).then((r) => j<Character>(r)),
  recheckAge: (id: string | 'all') => fetch(`/api/characters/${id}/age`, { method: 'POST' }).then((r) => j<Character[]>(r)),
  deleteCharacter: (id: string) => fetch(`/api/characters/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: true }>(r)),
  autotag: (ids: string[]) => fetch('/api/images/autotag', json('POST', { ids })).then((r) => j<{ changed: number; images: Image[] }>(r)),

  listRules: () => fetch('/api/tag-rules').then((r) => j<TagRuleRow[]>(r)),
  createRule: (r: Omit<TagRuleRow, 'id'>) => fetch('/api/tag-rules', json('POST', r)).then((x) => j<TagRuleRow>(x)),
  deleteRule: (id: string) => fetch(`/api/tag-rules/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: true }>(r)),

  accounts: () => fetch('/api/accounts').then((r) => j<Account[]>(r)),
  login: (p: PlatformId) => fetch(`/api/accounts/${p}/login`, { method: 'POST' }).then((r) => j<Account[]>(r)),
  checkAccount: (p: PlatformId) => fetch(`/api/accounts/${p}/check`, { method: 'POST' }).then((r) => j<Account[]>(r)),
  logout: (p: PlatformId) => fetch(`/api/accounts/${p}/logout`, { method: 'POST' }).then((r) => j<Account[]>(r)),

  daFolders: (refresh = false) => fetch(`/api/accounts/deviantart/folders${refresh ? '?refresh=1' : ''}`).then((r) => j<{ id: string; name: string; parentId: string | null }[]>(r)),
  ssTiers: (refresh = false) => fetch(`/api/accounts/subscribestar/tiers${refresh ? '?refresh=1' : ''}`).then((r) => j<{ id: string; name: string }[]>(r)),
  jobs: () => fetch('/api/jobs').then((r) => j<JobsResponse>(r)),
  createJobs: async (c: CreateJobs) => {
    const res = await fetch('/api/jobs', json('POST', c));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error ?? `${res.status}`), { details: body.details as string[] | undefined });
    }
    return res.json() as Promise<Job[]>;
  },
  cancelJob: (id: string) => fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).then((r) => j<{ ok: true }>(r)),
  retryJob: (id: string) => fetch(`/api/jobs/${id}/retry`, { method: 'POST' }).then((r) => j<{ ok: true }>(r)),
  deleteJob: (id: string) => fetch(`/api/jobs/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: true }>(r)),

  settings: () => fetch('/api/settings').then((r) => j<Record<string, string>>(r)),
  patchSettings: (s: Record<string, string>) => fetch('/api/settings', json('PATCH', s)).then((r) => j<Record<string, string>>(r)),

  listPresets: () => fetch('/api/presets').then((r) => j<Preset[]>(r)),
  createPreset: (p: Omit<Preset, 'id'>) => fetch('/api/presets', json('POST', p)).then((r) => j<Preset>(r)),
  updatePreset: (id: string, p: Omit<Preset, 'id'>) => fetch(`/api/presets/${id}`, json('PUT', p)).then((r) => j<Preset>(r)),
  deletePreset: (id: string) => fetch(`/api/presets/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: true }>(r)),
};
