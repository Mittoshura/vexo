import { useState } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PLATFORMS, SPEC } from '@shared/platforms';
import type { PlatformId } from '@/lib/types';

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="rounded-md border border-line bg-surface p-3">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field h-8 py-0 text-[12.5px]">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ k, label, sub }: { k: string; label: string; sub: string }) {
  const value = useStore((s) => s.settings[k]);
  const saveSettings = useStore((s) => s.saveSettings);
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-line bg-surface p-3">
      <span>
        <span className="block text-[12.5px] font-bold">{label}</span>
        <span className="block text-[11.5px] text-muted">{sub}</span>
      </span>
      <input type="checkbox" checked={value !== '0'} onChange={(e) => saveSettings({ [k]: e.target.checked ? '1' : '0' })} className="h-4 w-4 shrink-0 accent-accent" />
    </label>
  );
}

export function Settings() {
  const rules = useStore((s) => s.rules);
  const addRule = useStore((s) => s.addRule);
  const deleteRule = useStore((s) => s.deleteRule);
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const save = (k: string, v: string) => saveSettings({ [k]: v }).then(() => toast('Setting saved', 'ok'));
  const [platform, setPlatform] = useState<PlatformId>('pixiv');
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');

  const submit = async () => {
    if (!src.trim() || !dst.trim()) return;
    await addRule({ platform, src: src.trim(), dst: dst.trim() });
    setSrc('');
    setDst('');
  };

  const forPlatform = rules.filter((r) => r.platform === platform);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-line px-5">
        <h1 className="text-[15px] font-extrabold tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[720px]">
          <h2 className="text-[13px] font-extrabold">Posting</h2>
          <p className="mt-1 mb-3 text-[12.5px] leading-relaxed text-muted">Minimum delay between two posts on the same platform. The longer, the less bot-like.</p>
          <div className="mb-4 grid grid-cols-5 gap-2">
            {PLATFORMS.map((p) => (
              <label key={p} className="rounded-md border border-line bg-surface p-3">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: SPEC[p].color }} />
                  {SPEC[p].name}
                </span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={Math.round(Number(settings[`delay.${p}`] ?? 600) / 60)}
                    onBlur={(e) => save(`delay.${p}`, String(Math.max(0, Number(e.target.value)) * 60))}
                    className="field h-8 w-20 py-0 font-mono text-[12.5px]"
                  />
                  <span className="text-[11px] text-muted">min</span>
                </span>
              </label>
            ))}
          </div>

          <label className="mb-6 flex cursor-pointer items-center justify-between rounded-md border border-line bg-surface p-3">
            <span>
              <span className="block text-[12.5px] font-bold">Hide the Edge window while posting</span>
              <span className="block text-[11.5px] text-muted">The window is moved off-screen (headless mode is blocked by Pixiv). Uncheck to see what happens when a post fails.</span>
            </span>
            <input type="checkbox" checked={settings.hideBrowser === '1'} onChange={(e) => save('hideBrowser', e.target.checked ? '1' : '0')} className="h-4 w-4 accent-accent" />
          </label>

          <h2 className="text-[13px] font-extrabold">Pixiv — defaults</h2>
          <div className="mt-3 mb-6 grid grid-cols-3 gap-2">
            <Select label="Visibility" value={settings['pixiv.restrict'] ?? 'public'} onChange={(v) => save('pixiv.restrict', v)} options={[['public', 'Public'], ['mypixiv', 'My pixiv'], ['private', 'Private']]} />
            <Select label="Work type" value={settings['pixiv.aiType'] ?? 'aiGenerated'} onChange={(v) => save('pixiv.aiType', v)} options={[['aiGenerated', 'AI-generated'], ['notAiGenerated', 'Not AI']]} />
            <Select label="Community tag editing" value={settings['pixiv.allowTagEdit'] ?? '1'} onChange={(v) => save('pixiv.allowTagEdit', v)} options={[['1', 'Yes'], ['0', 'No']]} />
          </div>

          <h2 className="text-[13px] font-extrabold">DeviantArt — defaults</h2>
          <div className="mt-3 mb-6 grid grid-cols-2 gap-2">
            <Toggle k="deviantart.aiGenerated" label="Created using AI tools" sub="Required by DeviantArt for AI images." />
            <Toggle k="deviantart.noai" label="Forbid AI dataset use (noai)" sub="Asks third parties not to use the image to train AI." />
          </div>

          <h2 className="text-[13px] font-extrabold">Auto-tag</h2>
          <p className="mt-1 mb-3 text-[12.5px] leading-relaxed text-muted">
            Characters from the <b className="text-text">Characters</b> list are detected in the ComfyUI prompt and LoRA names. Changing the language and re-running Auto-tag swaps the tags already added.
          </p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <Select label="Tag language" value={settings['autotag.lang'] ?? 'en'} onChange={(v) => save('autotag.lang', v)} options={[['en', 'English'], ['ja', '日本語 (Japanese)']]} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-2">
            <Toggle k="autotag.onImport" label="Run on import" sub="New images are tagged as soon as they are imported." />
            <Toggle k="autotag.series" label="Add the series tag" sub="e.g. Dr. Stone / Dr.STONE" />
            <Toggle k="autotag.pixivStyle" label="Pixiv-style tag (JP)" sub="コハク(Dr.STONE) instead of コハク" />
            <Toggle k="autotag.title" label="Auto-title" sub="When the title is empty or still the file name: “Kohaku / Dr. Stone”." />
          </div>

          <h2 className="text-[13px] font-extrabold">Tag rules per platform</h2>
          <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-muted">
            When posting, each common tag is replaced by its translation if a rule exists. Example: <span className="chip h-5">1girl</span> → <span className="chip h-5">女の子</span> on Pixiv.
          </p>

          <div className="mb-4 inline-flex rounded-sm border border-line bg-surface p-0.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex h-7 items-center gap-1.5 rounded-[4px] px-3 text-[12px] font-bold transition-colors ${
                  platform === p ? 'bg-surface-3 text-text' : 'text-muted hover:text-text'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SPEC[p].color }} />
                {SPEC[p].name}
                <span className="font-mono text-[10px] text-faint">{rules.filter((r) => r.platform === p).length}</span>
              </button>
            ))}
          </div>

          <div className="rounded-md border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line p-2">
              <input value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="common tag" className="field h-8 py-0 font-mono text-[12.5px]" />
              <ArrowRight size={14} className="shrink-0 text-faint" />
              <input value={dst} onChange={(e) => setDst(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={`tag ${SPEC[platform].name}`} className="field h-8 py-0 font-mono text-[12.5px]" />
              <button onClick={submit} disabled={!src.trim() || !dst.trim()} className="btn-primary h-8 shrink-0">
                <Plus size={14} strokeWidth={2.5} /> Add
              </button>
            </div>
            {forPlatform.length === 0 ? (
              <div className="p-6 text-center text-[12.5px] text-faint">No rules for {SPEC[platform].name}.</div>
            ) : (
              <ul className="divide-y divide-line">
                {forPlatform.map((r) => (
                  <li key={r.id} className="group flex items-center gap-3 px-3 py-2 font-mono text-[12.5px]">
                    <span className="min-w-[160px] text-muted">{r.src}</span>
                    <ArrowRight size={12} className="text-faint" />
                    <span className="flex-1 text-text">{r.dst}</span>
                    <button onClick={() => deleteRule(r.id)} className="btn-quiet btn-icon h-6 w-6 opacity-0 group-hover:opacity-100" aria-label="Delete">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <h2 className="mt-8 text-[13px] font-extrabold">Limits per platform</h2>
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-[0.1em] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-bold">Platform</th>
                <th className="py-2 font-bold">Title</th>
                <th className="py-2 font-bold">Text</th>
                <th className="py-2 font-bold">Tags</th>
                <th className="py-2 font-bold">Images / post</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {PLATFORMS.map((p) => (
                <tr key={p} className="border-b border-line">
                  <td className="py-2 font-sans font-bold">{SPEC[p].name}</td>
                  <td className="py-2 text-muted">{SPEC[p].titleMax ?? '—'}</td>
                  <td className="py-2 text-muted">{SPEC[p].descMax}</td>
                  <td className="py-2 text-muted">{SPEC[p].tagsMax}</td>
                  <td className="py-2 text-muted">{SPEC[p].imagesPerPost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
