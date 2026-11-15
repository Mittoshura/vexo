import { useEffect, useMemo, useState } from 'react';
import { Trash2, Sparkles, Save, ChevronDown, Wand2, X, BookmarkPlus, AlertTriangle, RotateCcw, Users, Check, Plus } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Character, Image, PlatformId } from '@/lib/types';
import { PLATFORMS, SPEC, resolve, problems, xText } from '@shared/platforms';
import { TagInput } from './TagInput';
import { detect, variantTags } from '@shared/autotag';
import { RiskBadge } from './RiskBadge';

type TagsMode = 'add' | 'replace' | 'remove';
type Nsfw = 'keep' | 'sfw' | 'nsfw';
type Tab = 'common' | PlatformId;
type FieldKey = 'title' | 'desc' | 'tags' | 'nsfw';

const same = <T,>(arr: T[], pick: (x: T) => string) => {
  if (!arr.length) return null;
  const v = pick(arr[0]);
  return arr.every((x) => pick(x) === v) ? v : null;
};

const promptToTags = (p: string) =>
  p
    .replace(/\([^)]*?:\s*[\d.]+\)/g, (m) => m.replace(/^\(|:\s*[\d.]+\)$/g, ''))
    .replace(/[()[\]{}]/g, '')
    .replace(/<[^>]+>/g, '')
    .split(/,|\n/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && t.length < 40)
    .slice(0, 30);

/** Effective field value for an image + tab (override > common). */
const eff = (i: Image, p: Tab) => {
  if (p === 'common') return { title: i.title, description: i.description, tags: i.tags };
  const o = i.overrides[p] ?? {};
  return { title: o.title ?? i.title, description: o.description ?? i.description, tags: o.tags ?? i.tags };
};

export function Inspector() {
  const images = useStore((s) => s.images);
  const selectedSet = useStore((s) => s.selected);
  const clear = useStore((s) => s.clear);
  const patch = useStore((s) => s.patch);
  const removeSelected = useStore((s) => s.removeSelected);
  const presets = useStore((s) => s.presets);
  const rules = useStore((s) => s.rules);
  const savePreset = useStore((s) => s.savePreset);
  const deletePreset = useStore((s) => s.deletePreset);
  const characters = useStore((s) => s.characters);
  const autotag = useStore((s) => s.autotag);
  const removeTags = useStore((s) => s.removeTags);

  const sel = useMemo(() => images.filter((i) => selectedSet.has(i.id)), [images, selectedSet]);
  const n = sel.length;
  const single: Image | null = n === 1 ? sel[0] : null;

  const [tab, setTab] = useState<Tab>('common');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagsMode, setTagsMode] = useState<TagsMode>('add');
  const [nsfw, setNsfw] = useState<Nsfw>('keep');
  const [dirty, setDirty] = useState<Set<FieldKey>>(new Set());
  const [specific, setSpecific] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  const platform: PlatformId | null = tab === 'common' ? null : tab;
  const spec = platform ? SPEC[platform] : null;
  const mark = (k: FieldKey) => setDirty((d) => new Set(d).add(k));

  const overrideState: 'all' | 'none' | 'mixed' = useMemo(() => {
    if (!platform || !n) return 'none';
    const c = sel.filter((i) => i.overrides[platform]).length;
    return c === 0 ? 'none' : c === n ? 'all' : 'mixed';
  }, [sel, platform, n]);

  // Reset the form when the selection, tab, or the selected images' data changes (e.g. after auto-tag).
  const dataKey = useMemo(() => sel.map((i) => `${i.title}|${i.tags.join(',')}`).join(';'), [sel]);
  const selKey = useMemo(() => [...selectedSet].sort().join(','), [selectedSet]);
  useEffect(() => {
    const vals = sel.map((i) => eff(i, tab));
    setTitle(same(vals, (v) => v.title) ?? '');
    setDesc(same(vals, (v) => v.description) ?? '');
    setTagsMode(n === 1 ? 'replace' : 'add');
    setTags(n === 1 ? vals[0].tags : []);
    const nv = same(sel, (i) => String(i.nsfw));
    setNsfw(nv === 'true' ? 'nsfw' : nv === 'false' ? 'sfw' : 'keep');
    setSpecific(overrideState === 'all');
    setDirty(new Set());
    setShowPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, tab, dataKey]);

  useEffect(() => {
    if (n === 0) setTab('common');
  }, [n]);

  const canApply = dirty.size > 0 && n > 0 && !busy && (!platform || specific);

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    try {
      await patch({
        ...(platform ? { platform } : {}),
        ...(dirty.has('title') ? { title } : {}),
        ...(dirty.has('desc') ? { description: desc } : {}),
        ...(dirty.has('tags') ? { tags, tagsMode } : {}),
        ...(!platform && dirty.has('nsfw') && nsfw !== 'keep' ? { nsfw: nsfw === 'nsfw' } : {}),
      });
      setDirty(new Set());
      if (tagsMode !== 'replace') setTags([]);
    } finally {
      setBusy(false);
    }
  };

  const toggleSpecific = async (on: boolean) => {
    if (!platform) return;
    if (on) {
      // Prefill with common values and mark everything dirty: apply will create the full override.
      const vals = sel.map((i) => eff(i, 'common'));
      setTitle(same(vals, (v) => v.title) ?? '');
      setDesc(same(vals, (v) => v.description) ?? '');
      setTags(n === 1 ? vals[0].tags : []);
      setTagsMode(n === 1 ? 'replace' : 'add');
      setSpecific(true);
      setDirty(new Set<FieldKey>(['title', 'desc', 'tags']));
    } else {
      setBusy(true);
      try {
        await patch({ platform, clearOverride: true });
        setSpecific(false);
        setDirty(new Set());
      } finally {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void apply();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    if (p.title) (setTitle(p.title), mark('title'));
    if (p.description) (setDesc(p.description), mark('desc'));
    if (p.tags.length) (setTags(Array.from(new Set([...tags, ...p.tags]))), mark('tags'));
  };

  const saveAsPreset = async () => {
    const name = window.prompt('Preset name:');
    if (!name?.trim()) return;
    await savePreset({ name: name.trim(), title, description: desc, tags });
  };

  const del = async () => {
    if (!window.confirm(`Delete ${n} image${n > 1 ? 's' : ''} from the library?`)) return;
    await removeSelected();
  };

  // Resolved preview (1st image) for the platform tab: tag rules + limits.
  const preview = useMemo(() => {
    if (!platform || !sel.length) return null;
    const i = sel[0];
    const common = { title: i.title, description: i.description, tags: i.tags };
    const live = specific && n === 1 ? { title, description: desc, tags } : i.overrides[platform];
    const r = resolve(common, live, platform, rules);
    return { ...r, problems: problems(r, platform), x: platform === 'x' ? xText(r) : null };
  }, [platform, sel, rules, specific, n, title, desc, tags]);

  if (n === 0) {
    return (
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
        <div className="m-auto max-w-[220px] text-center text-sm leading-relaxed text-faint">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md border border-dashed border-line-strong">
            <Wand2 size={16} />
          </div>
          Select one or more images to edit title, tags and description.
        </div>
      </aside>
    );
  }

  const editable = !platform || specific;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      {/* header */}
      <div className="flex h-14 items-center justify-between border-b border-line px-5">
        <div className="text-sm font-bold">
          <span className="mr-2 inline-grid h-6 min-w-6 place-items-center rounded-sm bg-accent px-1.5 font-mono text-[12px] text-white">{n}</span>
          {n === 1 ? 'image' : 'images'} selected
        </div>
        <button onClick={clear} className="btn-quiet btn-icon" aria-label="Deselect">
          <X size={16} />
        </button>
      </div>

      {/* tabs */}
      <div className="flex border-b border-line px-2">
        <TabBtn active={tab === 'common'} onClick={() => setTab('common')}>
          Common
        </TabBtn>
        {PLATFORMS.map((p) => (
          <TabBtn key={p} active={tab === p} onClick={() => setTab(p)} color={SPEC[p].color} dot={sel.some((i) => i.overrides[p])}>
            {SPEC[p].short}
          </TabBtn>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* preview */}
        {tab === 'common' &&
          (single ? (
            <div className="mb-4 overflow-hidden rounded-md border border-line">
              <img src={single.thumb} alt="" className="max-h-[200px] w-full bg-surface-2 object-contain" />
              <div className="flex items-center justify-between px-3 py-2 font-mono text-[11px] text-muted">
                <span className="truncate" title={single.original_name}>
                  {single.original_name}
                </span>
                <span className="shrink-0 pl-2">
                  {single.width}×{single.height} · {single.size > 1024 * 1024 ? `${(single.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(single.size / 1024)} KB`}
                </span>
              </div>
            </div>
          ) : (
            <div className="mb-4 flex gap-1 overflow-hidden rounded-md">
              {sel.slice(0, 6).map((i) => (
                <img key={i.id} src={i.thumb} alt="" className="h-12 flex-1 rounded-sm object-cover" />
              ))}
              {n > 6 && <div className="grid h-12 w-12 shrink-0 place-items-center rounded-sm bg-surface-3 font-mono text-xs text-muted">+{n - 6}</div>}
            </div>
          ))}

        {/* platform switch */}
        {platform && spec && (
          <div className="mb-4 rounded-md border border-line bg-surface-2 p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[13px] font-bold">{spec.name}-specific values</span>
              <Switch checked={specific} onChange={toggleSpecific} />
            </label>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              {overrideState === 'mixed' && !specific
                ? 'Mixed selection: some images already have specific values. Enabling will overwrite them for all.'
                : specific
                  ? 'These fields override the common values for this platform only.'
                  : 'Inherits the common values. Enable to customize.'}
            </p>
            <p className="mt-1.5 text-[11px] text-faint">{spec.hint}</p>
          </div>
        )}

        {/* presets */}
        {presets.length > 0 && editable && (
          <div className="mb-4">
            <span className="label">Preset</span>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <select
                  onChange={(e) => {
                    loadPreset(e.target.value);
                    e.target.value = '';
                  }}
                  defaultValue=""
                  className="field appearance-none pr-8"
                >
                  <option value="" disabled>
                    Load a preset…
                  </option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
              </div>
              <PresetMenu presets={presets} onDelete={deletePreset} />
            </div>
          </div>
        )}

        <div className={editable ? '' : 'pointer-events-none opacity-40'}>
          {(!spec || spec.titleMax !== null) && (
            <Field label="Title" dirty={dirty.has('title')} right={spec?.titleMax ? <Counter n={title.length} max={spec.titleMax} /> : undefined}>
              <input
                value={title}
                onChange={(e) => (setTitle(e.target.value), mark('title'))}
                placeholder={n > 1 && same(sel, (i) => eff(i, tab).title) === null ? 'Mixed values' : 'Title'}
                className="field"
              />
            </Field>
          )}

          <Field
            label="Tags"
            dirty={dirty.has('tags')}
            right={
              <Segmented
                value={tagsMode}
                onChange={(m) => (setTagsMode(m), mark('tags'))}
                options={[
                  ['add', 'Add'],
                  ['replace', 'Replace'],
                  ['remove', 'Remove'],
                ]}
              />
            }
          >
            <TagInput value={tags} onChange={(t) => (setTags(t), mark('tags'))} placeholder="tag, tag, tag…" />
          </Field>

          {!platform && <TagSets sel={sel} />}

          <Field label="Description" dirty={dirty.has('desc')} right={spec ? <Counter n={desc.length} max={spec.descMax} /> : undefined}>
            <textarea
              value={desc}
              onChange={(e) => (setDesc(e.target.value), mark('desc'))}
              rows={4}
              placeholder={n > 1 && same(sel, (i) => eff(i, tab).description) === null ? 'Mixed values' : 'Description'}
              className="field resize-y leading-relaxed"
            />
          </Field>

          {!platform && (
            <Field label="Content" dirty={dirty.has('nsfw')}>
              <Segmented
                value={nsfw}
                onChange={(v) => (setNsfw(v), mark('nsfw'))}
                full
                options={[
                  ['keep', 'Unchanged'],
                  ['sfw', 'SFW'],
                  ['nsfw', 'R-18'],
                ]}
                accent="nsfw"
              />
            </Field>
          )}
        </div>

        {/* resolved preview */}
        {platform && spec && preview && (
          <div className="mt-2 rounded-md border border-line bg-surface-2">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              <span>{spec.name} preview</span>
              {n > 1 && <span className="font-mono normal-case tracking-normal text-faint">1st image</span>}
            </div>
            <div className="px-3 py-2.5">
              {preview.problems.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {preview.problems.map((p) => (
                    <li key={p} className="flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                      <AlertTriangle size={12} /> {p}
                    </li>
                  ))}
                </ul>
              )}
              {preview.x !== null ? (
                <>
                  <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-text">{preview.x || <span className="text-faint">Empty text</span>}</pre>
                  <div className="mt-2 text-right">
                    <Counter n={preview.x.length} max={spec.descMax} />
                  </div>
                </>
              ) : (
                <>
                  <div className="truncate text-[13px] font-bold" title={preview.title}>
                    {preview.title || <span className="text-faint">Untitled</span>}
                  </div>
                  {preview.description && <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted">{preview.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {preview.tags.map((t) => (
                      <span key={t} className="chip h-5 text-[11px]">
                        {t}
                      </span>
                    ))}
                    {!preview.tags.length && <span className="text-[12px] text-faint">No tags</span>}
                  </div>
                  {preview.tagsDropped.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-warn">
                      {preview.tagsDropped.length} tag{preview.tagsDropped.length > 1 ? 's' : ''} over the limit ({spec.tagsMax}): {preview.tagsDropped.join(', ')}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* detected characters */}
        {tab === 'common' && n > 0 && (
          <Detected sel={sel} characters={characters} onAutotag={() => autotag(sel.map((i) => i.id))} onRemove={removeTags} />
        )}

        {/* comfy */}
        {tab === 'common' && single?.comfy && (
          <div className="mt-5 rounded-md border border-line bg-surface-2">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              <Sparkles size={13} className="text-accent" />
              {single.comfy.source === 'comfyui' ? 'ComfyUI' : 'A1111'}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2.5 font-mono text-[11.5px]">
              {single.comfy.model && <Row k="model" v={single.comfy.model.replace(/\.[^.]+$/, '')} />}
              {single.comfy.loras?.map((l) => <Row key={l} k="lora" v={l.replace(/\.[^.]+$/, '')} />)}
              {single.comfy.seed !== undefined && <Row k="seed" v={String(single.comfy.seed)} />}
              {single.comfy.steps !== undefined && (
                <Row k="sampling" v={`${single.comfy.steps} steps · cfg ${single.comfy.cfg ?? '?'} · ${single.comfy.sampler ?? ''} ${single.comfy.scheduler ?? ''}`} />
              )}
            </dl>
            {single.comfy.positive && (
              <div className="border-t border-line px-3 py-2.5">
                <button onClick={() => setShowPrompt((v) => !v)} className="flex w-full items-center justify-between text-[12px] font-semibold text-muted hover:text-text">
                  Prompt
                  <ChevronDown size={14} className={`transition-transform ${showPrompt ? 'rotate-180' : ''}`} />
                </button>
                {showPrompt && <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">{single.comfy.positive}</p>}
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => (setTags(Array.from(new Set([...tags, ...promptToTags(single.comfy!.positive!)]))), mark('tags'))} className="btn-ghost h-7 px-2.5 text-[12px]">
                    → tags
                  </button>
                  <button onClick={() => (setDesc(single.comfy!.positive!), mark('desc'))} className="btn-ghost h-7 px-2.5 text-[12px]">
                    → description
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-line p-4">
        <button onClick={apply} disabled={!canApply} className="btn-primary h-10 w-full">
          <Save size={15} strokeWidth={2.5} />
          Apply {n > 1 ? `to ${n} images` : ''}
          {spec ? ` · ${spec.name}` : ''}
          <span className="ml-1 font-mono text-[11px] font-normal opacity-70">Ctrl+↵</span>
        </button>
        <div className="mt-2 flex gap-1.5">
          {platform ? (
            <button onClick={() => toggleSpecific(false)} disabled={overrideState === 'none'} className="btn-quiet h-8 flex-1 text-[12.5px]">
              <RotateCcw size={14} /> Revert to common
            </button>
          ) : (
            <button onClick={saveAsPreset} className="btn-quiet h-8 flex-1 text-[12.5px]">
              <BookmarkPlus size={14} /> Save as preset
            </button>
          )}
          <button onClick={del} className="btn-quiet h-8 text-[12.5px] hover:text-accent">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, color, dot, children }: { active: boolean; onClick: () => void; color?: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-[11.5px] font-bold transition-colors ${
        active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
      {dot && <span className="absolute right-0.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
    </button>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line-strong'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  const over = n > max;
  return <span className={`font-mono text-[11px] ${over ? 'font-bold text-accent' : n > max * 0.9 ? 'text-warn' : 'text-faint'}`}>{n}/{max}</span>;
}

function Field({ label, dirty, right, children }: { label: string; dirty: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0 flex items-center gap-1.5">
          {label}
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="truncate text-text" title={v}>
        {v}
      </dd>
    </>
  );
}

function Segmented<T extends string>({ value, onChange, options, full, accent }: { value: T; onChange: (v: T) => void; options: [T, string][]; full?: boolean; accent?: T }) {
  return (
    <div className={`inline-flex rounded-sm border border-line bg-surface-2 p-0.5 ${full ? 'w-full' : ''}`}>
      {options.map(([v, label]) => {
        const active = v === value;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`h-6 rounded-[4px] px-2 text-[11.5px] font-bold transition-colors ${full ? 'flex-1' : ''} ${
              active ? (accent === v ? 'bg-accent text-white' : 'bg-surface-3 text-text') : 'text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PresetMenu({ presets, onDelete }: { presets: { id: string; name: string }[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost btn-icon h-[38px] w-[38px]" aria-label="Manage presets">
        <Trash2 size={14} />
      </button>
      {open && (
        <div className="animate-fade-up absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-line bg-surface-2 p-1" onMouseLeave={() => setOpen(false)}>
          {presets.map((p) => (
            <button key={p.id} onClick={() => (onDelete(p.id), setOpen(false))} className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[12.5px] text-text hover:bg-surface-3">
              {p.name}
              <X size={12} className="text-muted" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One-click tag presets: click adds the set to every selected image; click again (all have it) removes it. */
function TagSets({ sel }: { sel: Image[] }) {
  const presets = useStore((s) => s.presets).filter((p) => p.tags.length > 0);
  const applyPreset = useStore((s) => s.applyPreset);
  const setPage = useStore((s) => s.setPage);
  const [busy, setBusy] = useState<string | null>(null);
  const has = (i: Image, tags: string[]) => {
    const own = new Set(i.tags.map((t) => t.toLowerCase()));
    return tags.every((t) => own.has(t.toLowerCase()));
  };
  return (
    <div className="mb-4 -mt-1">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">Tag sets</span>
        <button onClick={() => setPage('presets')} className="text-[11px] font-bold text-muted hover:text-text">
          Manage
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="text-[11.5px] text-faint">No tag sets yet. Fill the tags and click “Save as preset”, or use the Presets page.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const count = sel.filter((i) => has(i, p.tags)).length;
            const all = count === sel.length;
            const some = count > 0 && !all;
            return (
              <button
                key={p.id}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(p.id);
                  await applyPreset(p.id, all ? 'remove' : 'add');
                  setBusy(null);
                }}
                aria-label={`Tag set ${p.name}`}
                className={`chip cursor-pointer gap-1.5 transition-colors ${
                  all ? 'border-accent bg-accent-soft text-text' : some ? 'border-dashed border-accent/60' : 'hover:border-line-strong'
                }`}
              >
                {all ? <Check size={11} className="text-accent" /> : <Plus size={11} className="text-muted" />}
                <span className="font-bold">{p.name}</span>
                <span className="text-faint">{p.tags.length}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Characters found in the selected images' generation data, with ✗ to strip their tags. */
function Detected({
  sel,
  characters,
  onAutotag,
  onRemove,
}: {
  sel: Image[];
  characters: Character[];
  onAutotag: () => void;
  onRemove: (id: string, tags: string[]) => void;
}) {
  const withMeta = sel.filter((i) => i.comfy);
  const hits = new Map<string, { c: Character; via: string; images: Image[] }>();
  for (const img of withMeta)
    for (const d of detect(characters, img.comfy)) {
      const c = characters.find((x) => x.id === d.characterId)!;
      const h = hits.get(c.id) ?? { c, via: d.via === 'lora' ? 'LoRA' : 'prompt', images: [] };
      h.images.push(img);
      hits.set(c.id, h);
    }
  if (!withMeta.length) return null;
  const single = sel.length === 1 ? sel[0] : null;

  return (
    <div className="mt-5 rounded-md border border-line bg-surface-2">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        <Users size={13} className="text-accent" />
        Detected characters
        <button onClick={onAutotag} disabled={!hits.size} className="btn-quiet ml-auto h-6 px-2 text-[11px] normal-case tracking-normal">
          <Wand2 size={12} /> Auto-tag{sel.length > 1 ? ` ${sel.length}` : ''}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {hits.size === 0 && (
          <span className="text-[12px] text-faint">
            None. Add characters in the <b>Characters</b> page.
          </span>
        )}
        {[...hits.values()].map(({ c, via, images }) => {
          const tags = [...variantTags(c), ...c.extraTags];
          const lower = new Set(tags.map((t) => t.toLowerCase()));
          const tagged = single ? single.tags.some((t) => lower.has(t.toLowerCase())) : false;
          return (
            <span key={c.id} className={`chip gap-1.5 ${tagged ? 'border-ok/50' : ''}`}>
              {tagged && <Check size={11} className="text-ok" />}
              <RiskBadge c={c} size={12} />
              <span className="font-bold">{c.nameEn || c.danbooru}</span>
              <span className="text-faint">
                via {via}
                {sel.length > 1 ? ` · ${images.length}` : ''}
              </span>
              {single && tagged && (
                <button onClick={() => onRemove(single.id, single.tags.filter((t) => lower.has(t.toLowerCase())))} className="text-muted hover:text-accent" aria-label={`Remove ${c.nameEn} tags`}>
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
