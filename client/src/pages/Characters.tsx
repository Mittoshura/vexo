import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Trash2, Save, Loader2, Users, Sparkles, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { RiskBadge, RISK_COLOR } from '@/components/RiskBadge';
import { ageRisk, RISK_LABEL, minAge } from '@shared/age';
import { useStore } from '@/lib/store';
import { api, type CharacterDraft, type DanbooruHit } from '@/lib/api';
import { TagInput } from '@/components/TagInput';
import { characterTags, detect, type AutotagOptions, type Character } from '@shared/autotag';

const EMPTY: CharacterDraft = {
  danbooru: '',
  nameEn: '',
  nameJa: '',
  pixivTag: '',
  seriesEn: '',
  seriesJa: '',
  promptTriggers: [],
  loraTriggers: [],
  extraTags: [],
  enabled: true,
  ageText: '',
  ageSource: '',
  ageUrl: '',
  youngScore: null,
  ageCheckedAt: '',
};

export function optionsFrom(settings: Record<string, string>): AutotagOptions {
  return {
    lang: settings['autotag.lang'] === 'ja' ? 'ja' : 'en',
    series: settings['autotag.series'] !== '0',
    pixivStyle: settings['autotag.pixivStyle'] !== '0',
    title: settings['autotag.title'] !== '0',
  };
}

export function Characters() {
  const characters = useStore((s) => s.characters);
  const images = useStore((s) => s.images);
  const settings = useStore((s) => s.settings);
  const saveCharacter = useStore((s) => s.saveCharacter);
  const deleteCharacter = useStore((s) => s.deleteCharacter);
  const autotag = useStore((s) => s.autotag);
  const recheckAge = useStore((s) => s.recheckAge);
  const [checking, setChecking] = useState<string | null>(null);
  const runCheck = async (id: string | 'all') => {
    setChecking(id);
    await recheckAge(id);
    setChecking(null);
    if (id !== 'all') {
      const c = useStore.getState().characters.find((x) => x.id === id);
      if (c) open(c);
    }
  };
  const flagged = characters.filter((c) => ['minor', 'young'].includes(ageRisk(c).level)).length;
  const toast = useStore((s) => s.toast);
  const opts = optionsFrom(settings);

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<CharacterDraft>(EMPTY);
  const [busy, setBusy] = useState(false);

  // Danbooru search
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DanbooruHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) return setHits([]);
    timer.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await api.searchDanbooru(q));
      } catch (e) {
        toast(`Danbooru: ${(e as Error).message}`, 'err');
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [q, toast]);

  // How many library images each character matches.
  const matches = useMemo(() => {
    const m = new Map<string, number>();
    for (const img of images) for (const d of detect(characters, img.comfy)) m.set(d.characterId, (m.get(d.characterId) ?? 0) + 1);
    return m;
  }, [images, characters]);

  const pick = async (h: DanbooruHit) => {
    const existing = characters.find((c) => c.danbooru === h.tag);
    if (existing) return open(existing);
    setLooking(h.tag);
    try {
      const d = await api.lookupCharacter(h.tag);
      setDraft(d);
      setEditing('new');
      setQ('');
      setHits([]);
    } catch (e) {
      toast(`Danbooru: ${(e as Error).message}`, 'err');
    } finally {
      setLooking(null);
    }
  };

  const open = (c: Character) => {
    const { id: _id, ...rest } = c;
    setDraft(rest);
    setEditing(c.id);
  };

  const save = async () => {
    if (!draft.danbooru.trim()) return toast('The Danbooru tag is required', 'err');
    setBusy(true);
    try {
      const saved = await saveCharacter(draft, editing && editing !== 'new' ? editing : undefined);
      setEditing(saved.id);
      toast(`${saved.nameEn || saved.danbooru} saved`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing || editing === 'new') return setEditing(null);
    if (!confirm(`Delete ${draft.nameEn || draft.danbooru} from the list? Tags already on images are kept.`)) return;
    await deleteCharacter(editing);
    setEditing(null);
  };

  const set = <K extends keyof CharacterDraft>(k: K, v: CharacterDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const preview = characterTags({ ...draft, id: '' }, opts);
  const matchedIds = images.filter((i) => detect(characters, i.comfy).length > 0).map((i) => i.id);

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <h1 className="text-[15px] font-extrabold tracking-tight">Characters</h1>
          <span className="font-mono text-[12px] text-muted">{characters.length}</span>
          {flagged > 0 && (
            <span className="flex items-center gap-1 text-[12px] font-bold text-accent">
              <AlertTriangle size={13} strokeWidth={2.5} /> {flagged} risky on DeviantArt
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => runCheck('all')} disabled={!characters.length || checking !== null} className="btn-ghost h-8">
              <RefreshCw size={14} className={checking === 'all' ? 'animate-spin' : ''} /> Re-check ages
            </button>
            <button onClick={() => autotag(matchedIds)} disabled={!matchedIds.length} className="btn-ghost h-8" title="">
              <Sparkles size={14} /> Auto-tag library ({matchedIds.length})
            </button>
            <button
              onClick={() => {
                setDraft(EMPTY);
                setEditing('new');
              }}
              className="btn-ghost h-8"
            >
              <Plus size={14} /> Manual
            </button>
          </div>
        </header>

        <div className="relative border-b border-line px-5 py-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add from Danbooru: type a character name (e.g. kohaku, frieren)…" className="field h-9 pl-9" />
            {searching && <Loader2 size={14} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          {hits.length > 0 && (
            <ul className="absolute right-5 left-5 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-line bg-surface-2 py-1">
              {hits.map((h) => {
                const known = characters.some((c) => c.danbooru === h.tag);
                return (
                  <li key={h.tag}>
                    <button onClick={() => pick(h)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-surface-3">
                      <span className="flex-1 font-mono">{h.tag}</span>
                      {known && <span className="text-[11px] font-bold text-ok">in list</span>}
                      {looking === h.tag ? <Loader2 size={13} className="animate-spin text-muted" /> : <span className="font-mono text-[11px] text-faint">{h.count.toLocaleString('en-GB')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {characters.length === 0 ? (
            <div className="grid h-full place-items-center p-10 text-center">
              <div>
                <Users size={28} className="mx-auto mb-3 text-faint" />
                <p className="text-[13.5px] font-bold">No characters yet</p>
                <p className="mt-1 max-w-[360px] text-[12.5px] leading-relaxed text-muted">
                  Search a character above. The Japanese name and the series are fetched from Danbooru, then the character is detected in your ComfyUI prompts and LoRA names.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-bg text-left text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2">Character</th>
                  <th className="px-3 py-2">日本語</th>
                  <th className="px-3 py-2">Series</th>
                  <th className="px-3 py-2">Canon age</th>
                  <th className="px-3 py-2 text-right">Images</th>
                </tr>
              </thead>
              <tbody>
                {characters.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => open(c)}
                    className={`cursor-pointer border-b border-line transition-colors hover:bg-surface ${editing === c.id ? 'bg-accent-soft' : ''} ${c.enabled ? '' : 'opacity-45'}`}
                  >
                    <td className="px-5 py-2">
                      <span className="inline-flex items-center gap-1.5 font-bold">
                        <RiskBadge c={c} />
                        {c.nameEn || '—'}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-faint">{c.danbooru}</span>
                    </td>
                    <td className="px-3 py-2">{c.pixivTag || c.nameJa || '—'}</td>
                    <td className="px-3 py-2 text-muted">{c.seriesEn || '—'}</td>
                    <td className="max-w-[220px] px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <RiskBadge c={c} showUnknown />
                        <span className={`truncate ${RISK_COLOR[ageRisk(c).level]}`}>{c.ageText || '?'}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{matches.get(c.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* editor */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface">
        {!editing ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-[12.5px] text-muted">Select a character to edit it.</div>
        ) : (
          <>
            <div className="flex h-14 items-center border-b border-line px-5">
              <span className="text-[14px] font-extrabold">{editing === 'new' ? 'New character' : draft.nameEn || draft.danbooru}</span>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] font-bold text-muted">
                Enabled
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 accent-accent" />
              </label>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <Field label="Danbooru tag">
                <input value={draft.danbooru} onChange={(e) => set('danbooru', e.target.value)} className="field font-mono text-[12.5px]" placeholder="kohaku_(dr._stone)" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name · EN">
                  <input value={draft.nameEn} onChange={(e) => set('nameEn', e.target.value)} className="field" />
                </Field>
                <Field label="Name · JP">
                  <input value={draft.nameJa} onChange={(e) => set('nameJa', e.target.value)} className="field" />
                </Field>
                <Field label="Series · EN">
                  <input value={draft.seriesEn} onChange={(e) => set('seriesEn', e.target.value)} className="field" />
                </Field>
                <Field label="Series · JP">
                  <input value={draft.seriesJa} onChange={(e) => set('seriesJa', e.target.value)} className="field" />
                </Field>
              </div>
              <Field label="Pixiv-style tag · JP" hint="Used instead of the JP name when “Pixiv-style tag” is on in Settings.">
                <input value={draft.pixivTag} onChange={(e) => set('pixivTag', e.target.value)} className="field" placeholder="コハク(Dr.STONE)" />
              </Field>
              <Field label="Prompt triggers" hint="Whole words in the prompt. Underscores and \( \) escapes are ignored.">
                <TagInput value={draft.promptTriggers} onChange={(v) => set('promptTriggers', v)} placeholder="kohaku (dr. stone)" />
              </Field>
              <Field label="LoRA triggers" hint="Part of a LoRA file name (case and punctuation ignored).">
                <TagInput value={draft.loraTriggers} onChange={(v) => set('loraTriggers', v)} placeholder="kohaku" />
              </Field>
              <Field label="Extra tags" hint="Always added with this character, in any language.">
                <TagInput value={draft.extraTags} onChange={(v) => set('extraTags', v)} placeholder="blonde hair" />
              </Field>

              <AgeBox draft={draft} onAgeText={(v) => setDraft((d) => ({ ...d, ageText: v, ageSource: 'manual' }))} onRecheck={editing !== 'new' ? () => runCheck(editing) : undefined} checking={checking === editing} />

              <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <span className="label">Tags added · {opts.lang === 'ja' ? '日本語' : 'English'}</span>
                <div className="flex flex-wrap gap-1">
                  {preview.length ? preview.map((t) => <span key={t} className="chip">{t}</span>) : <span className="text-[12px] text-faint">—</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2 border-t border-line p-4">
              <button onClick={remove} className="btn-ghost h-10" aria-label="Delete character">
                <Trash2 size={14} />
              </button>
              <button onClick={save} disabled={busy} className="btn-primary h-10 flex-1">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editing === 'new' ? 'Add to list' : 'Save'}
              </button>
            </div>
          </>
        )}
      </aside>
    </section>
  );
}

function AgeBox({ draft, onAgeText, onRecheck, checking }: { draft: CharacterDraft; onAgeText: (v: string) => void; onRecheck?: () => void; checking: boolean }) {
  const r = ageRisk(draft);
  const min = minAge(draft.ageText ?? '');
  const border = r.level === 'minor' ? 'border-accent/60 bg-accent-soft' : r.level === 'young' ? 'border-warn/50' : 'border-line bg-surface-2';
  return (
    <div className={`rounded-md border px-3 py-2.5 ${border}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="label mb-0">DeviantArt age check</span>
        <span className={`ml-auto flex items-center gap-1 text-[11.5px] font-bold ${RISK_COLOR[r.level]}`}>
          {(r.level === 'minor' || r.level === 'young') && <AlertTriangle size={12} strokeWidth={2.5} />}
          {RISK_LABEL[r.level]}
        </span>
      </div>
      <div className="flex gap-1.5">
        <input value={draft.ageText ?? ''} onChange={(e) => onAgeText(e.target.value)} placeholder="Canon age (e.g. 17, 16-23…)" className="field h-8 flex-1 py-0 text-[12.5px]" />
        {onRecheck && (
          <button onClick={onRecheck} disabled={checking} className="btn-ghost h-8 px-2" aria-label="Re-check age">
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11.5px] leading-snug text-muted">
        <li>
          Canon age: <b className="text-text">{draft.ageText || 'unknown'}</b>
          {min !== null && <span className="text-faint"> · lowest {min}</span>} ·{' '}
          {draft.ageSource === 'manual' ? 'typed by you' : draft.ageSource === 'anilist' ? 'AniList' : 'no source'}
          {draft.ageUrl && (
            <a href={draft.ageUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-muted underline hover:text-text">
              AniList <ExternalLink size={10} />
            </a>
          )}
        </li>
        <li>
          Drawn young on Danbooru: <b className="text-text">{draft.youngScore != null ? `${draft.youngScore} %` : '?'}</b>
          <span className="text-faint"> of posts tagged “loli” (orange ≥ 3, red ≥ 10)</span>
        </li>
        {r.reasons.map((x) => (
          <li key={x} className={RISK_COLOR[r.level]}>
            → {x}
          </li>
        ))}
      </ul>
      {(r.level === 'minor' || r.level === 'young') && (
        <p className="mt-2 text-[11.5px] leading-snug text-text">
          DeviantArt bans sexual or suggestive art of characters who are minors in canon <b>or look like minors</b>, even if you state they are 18+ or “aged up”.
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}
