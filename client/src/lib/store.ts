import { create } from 'zustand';
import { api, type CharacterDraft } from './api';
import type { Account, BulkPatch, Character, CreateJobs, Image, JobsResponse, PlatformId, Preset, TagRuleRow } from './types';

export type Page = 'library' | 'characters' | 'presets' | 'queue' | 'history' | 'platforms' | 'settings';
export type Filter = 'all' | 'sfw' | 'nsfw' | 'untagged';

type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info' };

type State = {
  page: Page;
  images: Image[];
  presets: Preset[];
  rules: TagRuleRow[];
  characters: Character[];
  accounts: Account[];
  jobs: JobsResponse;
  settings: Record<string, string>;
  publishOpen: boolean;
  selected: Set<string>;
  anchor: string | null;
  filter: Filter;
  search: string;
  loading: boolean;
  uploadPct: number | null;
  toasts: Toast[];

  setPage: (p: Page) => void;
  setFilter: (f: Filter) => void;
  setSearch: (s: string) => void;
  load: () => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  patch: (p: Omit<BulkPatch, 'ids'>) => Promise<void>;
  removeSelected: () => Promise<void>;

  visible: () => Image[];
  click: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;

  savePreset: (p: Omit<Preset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  updatePreset: (id: string, p: Omit<Preset, 'id'>) => Promise<void>;
  /** Adds or removes a preset's tags on the selected images (common tags). */
  applyPreset: (id: string, mode: 'add' | 'remove') => Promise<void>;
  addRule: (r: Omit<TagRuleRow, 'id'>) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  login: (p: PlatformId) => Promise<void>;
  checkAccount: (p: PlatformId) => Promise<void>;
  logout: (p: PlatformId) => Promise<void>;
  refreshJobs: () => Promise<void>;
  createJobs: (c: CreateJobs) => Promise<number>;
  jobAction: (id: string, action: 'cancel' | 'retry' | 'delete') => Promise<void>;
  saveSettings: (s: Record<string, string>) => Promise<void>;
  setPublishOpen: (v: boolean) => void;
  deleteRule: (id: string) => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;

  saveCharacter: (c: CharacterDraft, id?: string) => Promise<Character>;
  deleteCharacter: (id: string) => Promise<void>;
  recheckAge: (id: string | 'all') => Promise<void>;
  /** Runs auto-tag on the given images (default: selection). */
  autotag: (ids?: string[]) => Promise<void>;
  /** Removes the given tags from one image (detected-character chip ✗). */
  removeTags: (id: string, tags: string[]) => Promise<void>;
};

let toastId = 0;

const mergeImages = (images: Image[], updated: Image[]) => {
  const map = new Map(updated.map((i) => [i.id, i]));
  return images.map((i) => map.get(i.id) ?? i);
};

export const useStore = create<State>((set, get) => ({
  page: 'library',
  images: [],
  presets: [],
  rules: [],
  characters: [],
  accounts: [],
  jobs: { jobs: [], running: null, nextSlot: { pixiv: null, deviantart: null, civitai: null, x: null, subscribestar: null } },
  settings: {},
  publishOpen: false,
  selected: new Set(),
  anchor: null,
  filter: 'all',
  search: '',
  loading: false,
  uploadPct: null,
  toasts: [],

  setPage: (page) => set({ page }),
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),

  load: async () => {
    set({ loading: true });
    const r = await Promise.allSettled([api.listImages(), api.listPresets(), api.listRules(), api.accounts(), api.jobs(), api.settings(), api.listCharacters()]);
    const v = <T,>(i: number, fallback: T): T => (r[i].status === 'fulfilled' ? ((r[i] as PromiseFulfilledResult<T>).value) : fallback);
    const failed = r.filter((x) => x.status === 'rejected');
    set({
      images: v(0, []),
      presets: v(1, []),
      rules: v(2, []),
      accounts: v(3, []),
      jobs: v(4, get().jobs),
      settings: v(5, {}),
      characters: v(6, []),
      loading: false,
    });
    if (failed.length) get().toast(`Server error: ${(failed[0] as PromiseRejectedResult).reason?.message ?? '?'}`, 'err');
  },

  upload: async (files) => {
    if (!files.length) return;
    set({ uploadPct: 0 });
    try {
      const { added, skipped } = await api.upload(files, (uploadPct) => set({ uploadPct }));
      set((s) => ({ images: [...added, ...s.images], selected: new Set(added.map((i) => i.id)) }));
      const dups = skipped.filter((x) => x.reason === 'duplicate').length;
      const other = skipped.length - dups;
      let msg = `${added.length} image${added.length !== 1 ? 's' : ''} imported`;
      if (dups) msg += ` · ${dups} duplicate${dups !== 1 ? 's' : ''} skipped`;
      if (other) msg += ` · ${other} file${other !== 1 ? 's' : ''} rejected`;
      get().toast(msg, added.length ? 'ok' : 'info');
    } catch (e) {
      get().toast(`Import failed: ${(e as Error).message}`, 'err');
    } finally {
      set({ uploadPct: null });
    }
  },

  patch: async (p) => {
    const ids = [...get().selected];
    if (!ids.length) return;
    const updated = await api.patchImages({ ids, ...p });
    const map = new Map(updated.map((i) => [i.id, i]));
    set((s) => ({ images: s.images.map((i) => map.get(i.id) ?? i) }));
    get().toast(`${ids.length} image${ids.length !== 1 ? 's' : ''} updated`, 'ok');
  },

  removeSelected: async () => {
    const ids = [...get().selected];
    if (!ids.length) return;
    await api.deleteImages(ids);
    set((s) => ({ images: s.images.filter((i) => !s.selected.has(i.id)), selected: new Set(), anchor: null }));
    get().toast(`${ids.length} image${ids.length !== 1 ? 's' : ''} deleted`, 'info');
  },

  visible: () => {
    const { images, filter, search } = get();
    const q = search.trim().toLowerCase();
    return images.filter((i) => {
      if (filter === 'sfw' && i.nsfw) return false;
      if (filter === 'nsfw' && !i.nsfw) return false;
      if (filter === 'untagged' && i.tags.length) return false;
      if (q && !(i.title.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)))) return false;
      return true;
    });
  },

  click: (id, { ctrl, shift }) => {
    const { selected, anchor } = get();
    const vis = get().visible();
    const next = new Set(ctrl || shift ? selected : []);
    if (shift && anchor) {
      const a = vis.findIndex((i) => i.id === anchor);
      const b = vis.findIndex((i) => i.id === id);
      if (a >= 0 && b >= 0) {
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) next.add(vis[k].id);
        set({ selected: next });
        return;
      }
    }
    if (ctrl) {
      next.has(id) ? next.delete(id) : next.add(id);
    } else {
      if (selected.size === 1 && selected.has(id)) next.clear();
      else next.add(id);
    }
    set({ selected: next, anchor: id });
  },

  toggle: (id) => {
    const next = new Set(get().selected);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ selected: next, anchor: id });
  },

  selectAll: () => set({ selected: new Set(get().visible().map((i) => i.id)) }),
  clear: () => set({ selected: new Set(), anchor: null }),

  savePreset: async (p) => {
    const created = await api.createPreset(p);
    set((s) => ({ presets: [...s.presets, created].sort((a, b) => a.name.localeCompare(b.name)) }));
    get().toast(`Preset "${p.name}" saved`, 'ok');
  },
  updatePreset: async (id, p) => {
    const saved = await api.updatePreset(id, p);
    set((s) => ({ presets: s.presets.map((x) => (x.id === id ? saved : x)).sort((a, b) => a.name.localeCompare(b.name)) }));
  },
  applyPreset: async (id, mode) => {
    const p = get().presets.find((x) => x.id === id);
    const ids = [...get().selected];
    if (!p || !ids.length || !p.tags.length) return;
    try {
      const updated = await api.patchImages({ ids, tags: p.tags, tagsMode: mode });
      set((s) => ({ images: mergeImages(s.images, updated) }));
      get().toast(`${p.name}: tags ${mode === 'add' ? 'added to' : 'removed from'} ${ids.length} image${ids.length !== 1 ? 's' : ''}`, 'ok');
    } catch (e) {
      get().toast((e as Error).message, 'err');
    }
  },
  deletePreset: async (id) => {
    await api.deletePreset(id);
    set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
  },

  addRule: async (r) => {
    const created = await api.createRule(r);
    set((s) => ({ rules: [...s.rules, created] }));
  },
  deleteRule: async (id) => {
    await api.deleteRule(id);
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },

  refreshAccounts: async () => set({ accounts: await api.accounts() }),
  login: async (p) => set({ accounts: await api.login(p) }),
  checkAccount: async (p) => set({ accounts: await api.checkAccount(p) }),
  logout: async (p) => set({ accounts: await api.logout(p) }),

  refreshJobs: async () => {
    const jobs = await api.jobs();
    const prev = get().jobs.jobs;
    set({ jobs });
    // A job just finished → reload images ("posted" badges).
    const finishedNow = jobs.jobs.some((j) => (j.status === 'done' || j.status === 'failed') && prev.find((p) => p.id === j.id)?.status === 'running');
    if (finishedNow) {
      set({ images: await api.listImages() });
      for (const j of jobs.jobs) {
        const was = prev.find((p) => p.id === j.id);
        if (was?.status === 'running' && j.status === 'done') get().toast(`Posted to ${j.platform} ✓`, 'ok');
        if (was?.status === 'running' && j.status === 'failed') get().toast(`${j.platform} failed: ${j.error}`, 'err');
      }
    }
  },
  createJobs: async (c) => {
    const created = await api.createJobs(c);
    await get().refreshJobs();
    get().toast(`${created.length} post${created.length !== 1 ? 's' : ''} queued`, 'ok');
    return created.length;
  },
  jobAction: async (id, action) => {
    if (action === 'cancel') await api.cancelJob(id);
    else if (action === 'retry') await api.retryJob(id);
    else await api.deleteJob(id);
    await get().refreshJobs();
  },
  saveSettings: async (s) => set({ settings: await api.patchSettings(s) }),
  setPublishOpen: (publishOpen) => set({ publishOpen }),

  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },

  saveCharacter: async (c, id) => {
    const saved = id ? await api.updateCharacter(id, c) : await api.createCharacter(c);
    set((s) => ({ characters: id ? s.characters.map((x) => (x.id === id ? saved : x)) : [...s.characters, saved] }));
    return saved;
  },
  recheckAge: async (id) => {
    try {
      set({ characters: await api.recheckAge(id) });
      get().toast(id === 'all' ? 'Ages re-checked' : 'Age re-checked', 'ok');
    } catch (e) {
      get().toast(`Age check failed: ${(e as Error).message}`, 'err');
    }
  },
  deleteCharacter: async (id) => {
    await api.deleteCharacter(id);
    set((s) => ({ characters: s.characters.filter((c) => c.id !== id) }));
  },
  autotag: async (ids) => {
    const list = ids ?? [...get().selected];
    if (!list.length) return;
    try {
      const { changed, images } = await api.autotag(list);
      set((s) => ({ images: mergeImages(s.images, images) }));
      get().toast(changed ? `Auto-tag: ${changed} image${changed !== 1 ? 's' : ''} updated` : 'Auto-tag: no known character found', changed ? 'ok' : 'info');
    } catch (e) {
      get().toast(`Auto-tag failed: ${(e as Error).message}`, 'err');
    }
  },
  removeTags: async (id, tags) => {
    const updated = await api.patchImages({ ids: [id], tags, tagsMode: 'remove' });
    set((s) => ({ images: mergeImages(s.images, updated) }));
  },
}));
