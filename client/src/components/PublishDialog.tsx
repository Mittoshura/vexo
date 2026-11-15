import { useEffect, useMemo, useState } from 'react';
import { X, Send, AlertTriangle, Images, Image as ImageIcon, Clock, RefreshCw } from 'lucide-react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { PLATFORMS, SPEC, resolve, problems, type PlatformId } from '@shared/platforms';
import { detect, type Character } from '@shared/autotag';
import { ageRisk } from '@shared/age';
import { RiskBadge } from './RiskBadge';

export function PublishDialog() {
  const open = useStore((s) => s.publishOpen);
  const setOpen = useStore((s) => s.setPublishOpen);
  const images = useStore((s) => s.images);
  const selected = useStore((s) => s.selected);
  const accounts = useStore((s) => s.accounts);
  const rules = useStore((s) => s.rules);
  const settings = useStore((s) => s.settings);
  const createJobs = useStore((s) => s.createJobs);
  const setPage = useStore((s) => s.setPage);
  const toast = useStore((s) => s.toast);

  const sel = useMemo(() => images.filter((i) => selected.has(i.id)), [images, selected]);
  const available = accounts.filter((a) => a.implemented && a.connected);
  const [platform, setPlatform] = useState<PlatformId>('pixiv');
  // Remember the last choice; defaults to "1 multi-image post".
  const [mode, setModeState] = useState<'single' | 'grouped'>(() => (localStorage.getItem('artpost.publishMode') === 'single' ? 'single' : 'grouped'));
  const setMode = (m: 'single' | 'grouped') => {
    setModeState(m);
    localStorage.setItem('artpost.publishMode', m);
  };
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [restrict, setRestrict] = useState('public');
  const [busy, setBusy] = useState(false);
  // DeviantArt
  type Folder = { id: string; name: string; parentId: string | null };
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState(() => localStorage.getItem('artpost.daFolder') ?? '');
  const [scraps, setScraps] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const loadFolders = async (refresh: boolean) => {
    setLoadingFolders(true);
    try {
      const f = await api.daFolders(refresh);
      setFolders(f);
      setFolderId((cur) => (f.some((x) => x.id === cur) ? cur : (f.find((x) => x.name === 'Featured') ?? f[0])?.id ?? ''));
    } catch (e) {
      toast(`DeviantArt folders: ${(e as Error).message}`, 'err');
    } finally {
      setLoadingFolders(false);
    }
  };
  // SubscribeStar: Public or a set of tiers (remembered)
  const [tiers, setTiers] = useState<{ id: string; name: string }[]>([]);
  const [tierIds, setTierIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('artpost.ssTiers') ?? '[]'));
  const [loadingTiers, setLoadingTiers] = useState(false);
  const loadTiers = async (refresh: boolean) => {
    setLoadingTiers(true);
    try {
      const t = await api.ssTiers(refresh);
      setTiers(t);
      setTierIds((cur) => cur.filter((id) => t.some((x) => x.id === id)));
    } catch (e) {
      toast(`SubscribeStar tiers: ${(e as Error).message}`, 'err');
    } finally {
      setLoadingTiers(false);
    }
  };
  const toggleTier = (id: string) =>
    setTierIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      localStorage.setItem('artpost.ssTiers', JSON.stringify(next));
      return next;
    });
  useEffect(() => {
    if (open && platform === 'subscribestar' && !tiers.length) void loadTiers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform]);
  useEffect(() => {
    if (open && platform === 'deviantart' && !folders.length) void loadFolders(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setRestrict(settings['pixiv.restrict'] ?? 'public');
    if (available.length && !available.some((a) => a.id === platform)) setPlatform(available[0].id);
    const d = new Date(Date.now() + 3600_000);
    d.setSeconds(0, 0);
    setAt(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false));
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, setOpen]);

  const spec = SPEC[platform];
  const canGroup = spec.imagesPerPost > 1 && sel.length > 1;
  const nPosts = mode === 'grouped' && canGroup ? Math.ceil(sel.length / spec.imagesPerPost) : sel.length;

  // Blocking problems computed client-side (the server revalidates).
  const localProblems = useMemo(() => {
    const out: string[] = [];
    const groups = mode === 'grouped' && canGroup ? [sel] : sel.map((i) => [i]);
    groups.forEach((g, gi) => {
      const r = resolve({ title: g[0].title, description: g[0].description, tags: g[0].tags }, g[0].overrides[platform], platform, rules);
      for (const p of problems(r, platform)) out.push(`${groups.length > 1 ? `#${gi + 1} ${g[0].title || g[0].original_name}: ` : ''}${p}`);
    });
    return out;
  }, [sel, platform, mode, canGroup, rules]);

  const alreadyPosted = sel.filter((i) => i.posts.some((p) => p.platform === platform));

  // DeviantArt age check: characters found in the prompt/LoRA or in the tags of the selected images.
  const characters = useStore((s) => s.characters);
  const risky = useMemo(() => {
    const out = new Map<string, { c: Character; images: number; nsfw: number }>();
    for (const img of sel) {
      const lower = new Set(img.tags.map((t) => t.toLowerCase()));
      const ids = new Set(detect(characters, img.comfy).map((d) => d.characterId));
      for (const c of characters) if ([c.nameEn, c.nameJa, c.pixivTag].filter(Boolean).some((t) => lower.has(t.toLowerCase()))) ids.add(c.id);
      for (const id of ids) {
        const c = characters.find((x) => x.id === id)!;
        const lvl = ageRisk(c).level;
        if (lvl !== 'minor' && lvl !== 'young') continue;
        const e = out.get(id) ?? { c, images: 0, nsfw: 0 };
        e.images++;
        if (img.nsfw) e.nsfw++;
        out.set(id, e);
      }
    }
    return [...out.values()];
  }, [sel, characters]);
  const [ackRisk, setAckRisk] = useState(false);
  useEffect(() => setAckRisk(false), [open, platform, sel.length]);
  // DeviantArt bans even suggestive art of young-looking characters; the others (and the law) ban sexualised minors.
  const riskyShown = platform === 'deviantart' ? risky : risky.filter((x) => x.nsfw > 0);
  const needAck = riskyShown.length > 0;
  const nsfwCount = sel.filter((i) => i.nsfw).length;

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    try {
      await createJobs({
        platform,
        imageIds: sel.map((i) => i.id),
        mode: canGroup ? mode : 'single',
        scheduledAt: when === 'later' && at ? new Date(at).toISOString() : null,
        options:
          platform === 'pixiv'
            ? { restrict }
            : platform === 'deviantart'
              ? { ...(scraps ? { scraps: '1' } : { folderId, folderName: folders.find((f) => f.id === folderId)?.name ?? '' }) }
              : platform === 'subscribestar'
                ? { tiers: tierIds.join(','), tierNames: tierIds.map((id) => tiers.find((t) => t.id === id)?.name ?? id).join(', ') }
                : {},
      });
      setOpen(false);
      setPage('queue');
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setErrors(err.details?.length ? err.details : [err.message]);
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg/70 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div className="animate-fade-up w-[520px] max-w-[calc(100vw-40px)] rounded-lg border border-line bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-14 items-center justify-between border-b border-line px-5">
          <div className="text-[15px] font-extrabold">
            Publish {sel.length} image{sel.length > 1 ? 's' : ''}
          </div>
          <button onClick={() => setOpen(false)} className="btn-quiet btn-icon" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* thumbnails */}
          <div className="mb-4 flex gap-1 overflow-hidden rounded-md">
            {sel.slice(0, 8).map((i) => (
              <img key={i.id} src={i.thumb} alt="" className="h-12 flex-1 rounded-sm object-cover" />
            ))}
            {sel.length > 8 && <div className="grid h-12 w-12 shrink-0 place-items-center rounded-sm bg-surface-3 font-mono text-xs text-muted">+{sel.length - 8}</div>}
          </div>

          {/* platform */}
          <span className="label">Platform</span>
          <div className="mb-4 grid grid-cols-5 gap-1.5">
            {PLATFORMS.map((p) => {
              const acc = accounts.find((a) => a.id === p);
              const ok = acc?.implemented && acc.connected;
              return (
                <button
                  key={p}
                  disabled={!ok}
                  onClick={() => setPlatform(p)}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    platform === p ? 'border-accent bg-accent-soft text-text' : 'border-line text-muted hover:border-line-strong hover:text-text'
                  }`}
                  title={!acc?.implemented ? 'Coming soon' : !acc.connected ? 'Not connected (see Platforms)' : ''}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: SPEC[p].color }} />
                  {SPEC[p].name.length > 10 ? SPEC[p].short : SPEC[p].name}
                </button>
              );
            })}
          </div>
          {available.length === 0 && (
            <p className="mb-4 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[12.5px]">
              No platform connected. Go to <b>Platforms</b> to log in.
            </p>
          )}

          {/* mode */}
          {canGroup && (
            <>
              <span className="label">Grouping</span>
              <div className="mb-4 grid grid-cols-2 gap-1.5">
                <Choice active={mode === 'single'} onClick={() => setMode('single')} icon={<ImageIcon size={14} />} title="1 post per image" sub={`${sel.length} posts`} />
                <Choice
                  active={mode === 'grouped'}
                  onClick={() => setMode('grouped')}
                  icon={<Images size={14} />}
                  title="1 multi-image post"
                  sub={`${Math.ceil(sel.length / spec.imagesPerPost)} post${sel.length > spec.imagesPerPost ? 's' : ''} · max ${spec.imagesPerPost}/post`}
                />
              </div>
            </>
          )}

          {/* when */}
          <span className="label">Send</span>
          <div className="mb-4 grid grid-cols-2 gap-1.5">
            <Choice active={when === 'now'} onClick={() => setWhen('now')} icon={<Send size={14} />} title="As soon as possible" sub={`${Math.round(Number(settings[`delay.${platform}`] ?? 600) / 60)} min delay between posts`} />
            <Choice active={when === 'later'} onClick={() => setWhen('later')} icon={<Clock size={14} />} title="Schedule" sub="from a set time" />
          </div>
          {when === 'later' && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="field mb-4 font-mono text-[12.5px]" />}

          {/* pixiv options */}
          {platform === 'pixiv' && (
            <>
              <span className="label">Pixiv visibility</span>
              <div className="mb-4 grid grid-cols-3 gap-1.5">
                {[
                  ['public', 'Public'],
                  ['mypixiv', 'My pixiv'],
                  ['private', 'Private'],
                ].map(([v, l]) => (
                  <button key={v} onClick={() => setRestrict(v)} className={`h-8 rounded-md border text-[12px] font-bold transition-colors ${restrict === v ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:text-text'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* subscribestar options */}
          {platform === 'subscribestar' && (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">Who can see it</span>
                <button onClick={() => loadTiers(true)} disabled={loadingTiers} className="flex items-center gap-1 text-[11px] font-bold text-muted hover:text-text">
                  <RefreshCw size={11} className={loadingTiers ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button
                  onClick={() => {
                    setTierIds([]);
                    localStorage.setItem('artpost.ssTiers', '[]');
                  }}
                  className={`h-8 rounded-md border px-3 text-[12px] font-bold transition-colors ${!tierIds.length ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:text-text'}`}
                >
                  Public
                </button>
                {tiers.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTier(t.id)}
                    className={`h-8 rounded-md border px-3 text-[12px] font-bold transition-colors ${tierIds.includes(t.id) ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:text-text'}`}
                  >
                    {t.name}
                  </button>
                ))}
                {!tiers.length && <span className="self-center text-[11.5px] text-faint">{loadingTiers ? 'Loading tiers…' : 'No tiers found'}</span>}
              </div>
            </>
          )}

          {/* deviantart options */}
          {platform === 'deviantart' && (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">Gallery folder</span>
                <button onClick={() => loadFolders(true)} disabled={loadingFolders} className="flex items-center gap-1 text-[11px] font-bold text-muted hover:text-text">
                  <RefreshCw size={11} className={loadingFolders ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <div className="mb-4 flex gap-1.5">
                <select
                  value={folderId}
                  disabled={scraps || !folders.length}
                  onChange={(e) => {
                    setFolderId(e.target.value);
                    localStorage.setItem('artpost.daFolder', e.target.value);
                  }}
                  className="field h-9 flex-1 py-0 text-[12.5px] disabled:opacity-40"
                >
                  {!folders.length && <option value="">{loadingFolders ? 'Loading…' : 'No folders'}</option>}
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.parentId ? '\u00a0\u00a0└ ' : ''}
                      {f.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setScraps((v) => !v)}
                  className={`h-9 rounded-md border px-3 text-[12px] font-bold transition-colors ${scraps ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:text-text'}`}
                >
                  Scraps
                </button>
              </div>
              {nsfwCount > 0 && (
                <p className="mb-4 flex items-start gap-1.5 rounded-md border border-warn/40 px-3 py-2 text-[12px] text-warn">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {nsfwCount} R-18 image{nsfwCount > 1 ? 's' : ''} will be posted as Mature. Explicit sexual content is not allowed on DeviantArt.
                </p>
              )}
            </>
          )}

          {/* age risk (all platforms; DeviantArt even without R-18) */}
          {riskyShown.length > 0 && (
            <div className="mb-4 rounded-md border border-accent/60 bg-accent-soft px-3 py-2.5 text-[12px] leading-relaxed">
              <div className="mb-1 flex items-center gap-1.5 font-bold text-accent">
                <AlertTriangle size={13} strokeWidth={2.5} /> Ban risk on {spec.name}
              </div>
              <ul className="mb-1.5 space-y-0.5">
                {riskyShown.map(({ c, images, nsfw }) => (
                  <li key={c.id} className="flex items-center gap-1.5">
                    <RiskBadge c={c} size={12} />
                    <b>{c.nameEn || c.danbooru}</b>
                    <span className="text-muted">
                      · {ageRisk(c).reasons[0]} · {images} image{images > 1 ? 's' : ''}
                      {nsfw ? `, ${nsfw} R-18` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted">
                {platform === 'deviantart' ? (
                  <>
                    DeviantArt bans sexual or suggestive art of characters who are minors in canon <b className="text-text">or look like minors</b>, even when drawn or stated as 18+.
                    {riskyShown.some((x) => x.nsfw) && <b className="text-accent"> Posting these as Mature is very likely to get the account banned.</b>}
                  </>
                ) : (
                  <>
                    {spec.name} bans sexual content of characters who are minors in canon <b className="text-text">or look like minors</b> — “aged up / 18+” is usually not accepted for young-looking characters.
                  </>
                )}
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 font-bold">
                <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} className="h-4 w-4 accent-accent" />
                I understand the risk, post anyway
              </label>
            </div>
          )}

          {/* summary */}
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
            <b className="text-text">{nPosts}</b> post{nPosts > 1 ? 's' : ''} on <b className="text-text">{spec.name}</b>
            {nsfwCount > 0 && (
              <>
                {' '}
                · <b className="text-accent">{nsfwCount}</b> R-18
              </>
            )}
            {alreadyPosted.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-warn">
                <AlertTriangle size={12} /> {alreadyPosted.length} image{alreadyPosted.length > 1 ? 's' : ''} already published on {spec.name}
              </div>
            )}
          </div>

          {(localProblems.length > 0 || errors.length > 0) && (
            <ul className="mt-3 space-y-1 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[12px]">
              {[...errors, ...localProblems].map((p, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-accent" /> {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line p-4">
          <button onClick={() => setOpen(false)} className="btn-ghost">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !available.length || localProblems.length > 0 || (needAck && !ackRisk)} className="btn-primary">
            <Send size={14} strokeWidth={2.5} />
            {when === 'later' ? 'Schedule' : 'Queue'} · {nPosts} post{nPosts > 1 ? 's' : ''}
            {nPosts < sel.length ? ` (${sel.length} images)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button onClick={onClick} className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors ${active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}>
      <span className={`mt-0.5 ${active ? 'text-accent' : 'text-muted'}`}>{icon}</span>
      <span>
        <span className="block text-[12.5px] font-bold">{title}</span>
        <span className="block text-[11.5px] text-muted">{sub}</span>
      </span>
    </button>
  );
}
