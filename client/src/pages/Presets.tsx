import { useState } from 'react';
import { Plus, Trash2, Save, Tags, Minus, Images } from 'lucide-react';
import { useStore } from '@/lib/store';
import { TagInput } from '@/components/TagInput';
import type { Preset } from '@/lib/types';

type Draft = Omit<Preset, 'id'>;
const EMPTY: Draft = { name: '', title: '', description: '', tags: [] };

export function Presets() {
  const presets = useStore((s) => s.presets);
  const images = useStore((s) => s.images);
  const selected = useStore((s) => s.selected);
  const savePreset = useStore((s) => s.savePreset);
  const updatePreset = useStore((s) => s.updatePreset);
  const deletePreset = useStore((s) => s.deletePreset);
  const applyPreset = useStore((s) => s.applyPreset);
  const toast = useStore((s) => s.toast);

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const nSel = selected.size;

  const open = (p: Preset) => {
    const { id: _id, ...rest } = p;
    setDraft(rest);
    setEditing(p.id);
  };

  const fromSelection = () => {
    const sel = images.filter((i) => selected.has(i.id));
    const tags = [...new Set(sel.flatMap((i) => i.tags))];
    setDraft({ ...EMPTY, tags });
    setEditing('new');
  };

  const save = async () => {
    if (!draft.name.trim()) return toast('Give the preset a name', 'err');
    if (editing && editing !== 'new') {
      await updatePreset(editing, { ...draft, name: draft.name.trim() });
      toast('Preset saved', 'ok');
    } else {
      await savePreset({ ...draft, name: draft.name.trim() });
      const created = useStore.getState().presets.find((p) => p.name === draft.name.trim());
      setEditing(created?.id ?? null);
    }
  };

  const remove = async () => {
    if (!editing || editing === 'new') return setEditing(null);
    if (!confirm(`Delete the preset “${draft.name}”? Tags already on images are kept.`)) return;
    await deletePreset(editing);
    setEditing(null);
  };

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <h1 className="text-[15px] font-extrabold tracking-tight">Presets</h1>
          <span className="font-mono text-[12px] text-muted">{presets.length}</span>
          <span className="text-[12px] text-faint">· {nSel} image{nSel !== 1 ? 's' : ''} selected in the Library</span>
          <div className="ml-auto flex gap-2">
            <button onClick={fromSelection} disabled={!nSel} className="btn-ghost h-8">
              <Images size={14} /> From selection
            </button>
            <button
              onClick={() => {
                setDraft(EMPTY);
                setEditing('new');
              }}
              className="btn-primary h-8"
            >
              <Plus size={14} strokeWidth={2.5} /> New preset
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {presets.length === 0 ? (
            <div className="grid h-full place-items-center p-10 text-center">
              <div>
                <Tags size={28} className="mx-auto mb-3 text-faint" />
                <p className="text-[13.5px] font-bold">No presets yet</p>
                <p className="mt-1 max-w-[380px] text-[12.5px] leading-relaxed text-muted">
                  A preset is a reusable set of tags (and optionally a title / description). Apply it in one click to all selected images from the inspector or from here.
                </p>
              </div>
            </div>
          ) : (
            <ul>
              {presets.map((p) => (
                <li
                  key={p.id}
                  onClick={() => open(p)}
                  className={`flex cursor-pointer items-start gap-4 border-b border-line px-5 py-3 transition-colors hover:bg-surface ${editing === p.id ? 'bg-accent-soft' : ''}`}
                >
                  <div className="w-44 shrink-0">
                    <div className="text-[13px] font-bold">{p.name}</div>
                    <div className="font-mono text-[11px] text-faint">
                      {p.tags.length} tag{p.tags.length !== 1 ? 's' : ''}
                      {p.title ? ' · title' : ''}
                      {p.description ? ' · desc' : ''}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {p.tags.slice(0, 14).map((t) => (
                      <span key={t} className="chip h-6">
                        {t}
                      </span>
                    ))}
                    {p.tags.length > 14 && <span className="font-mono text-[11px] text-faint">+{p.tags.length - 14}</span>}
                  </div>
                  <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => applyPreset(p.id, 'add')} disabled={!nSel || !p.tags.length} className="btn-ghost h-7 px-2 text-[12px]" aria-label={`Add ${p.name} tags to selection`}>
                      <Plus size={13} /> Add
                    </button>
                    <button onClick={() => applyPreset(p.id, 'remove')} disabled={!nSel || !p.tags.length} className="btn-quiet h-7 px-2 text-[12px]" aria-label={`Remove ${p.name} tags from selection`}>
                      <Minus size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface">
        {!editing ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-[12.5px] text-muted">Select a preset to edit it.</div>
        ) : (
          <>
            <div className="flex h-14 items-center border-b border-line px-5 text-[14px] font-extrabold">{editing === 'new' ? 'New preset' : draft.name}</div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <label className="block">
                <span className="label">Name</span>
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} className="field" placeholder="e.g. Beach set" autoFocus={editing === 'new'} />
              </label>
              <label className="block">
                <span className="label">Tags</span>
                <TagInput value={draft.tags} onChange={(v) => set('tags', v)} placeholder="tag, tag, tag…" />
              </label>
              <label className="block">
                <span className="label">Title (optional)</span>
                <input value={draft.title} onChange={(e) => set('title', e.target.value)} className="field" />
                <span className="mt-1 block text-[11px] text-faint">Only used by “Load a preset” in the inspector. Tag sets add tags only.</span>
              </label>
              <label className="block">
                <span className="label">Description (optional)</span>
                <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} rows={4} className="field resize-y leading-relaxed" />
              </label>
            </div>
            <div className="flex gap-2 border-t border-line p-4">
              <button onClick={remove} className="btn-ghost h-10" aria-label="Delete preset">
                <Trash2 size={14} />
              </button>
              <button onClick={save} className="btn-primary h-10 flex-1">
                <Save size={14} /> {editing === 'new' ? 'Create preset' : 'Save'}
              </button>
            </div>
          </>
        )}
      </aside>
    </section>
  );
}
