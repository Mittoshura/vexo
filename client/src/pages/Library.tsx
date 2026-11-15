import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Search, CheckSquare, Square, ImagePlus, Send, Wand2 } from 'lucide-react';
import { useStore, type Filter } from '@/lib/store';
import { ImageCard } from '@/components/ImageCard';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['sfw', 'SFW'],
  ['nsfw', 'R-18'],
  ['untagged', 'Untagged'],
];

const isImage = (f: File) => /^image\/(png|jpeg|webp)$/.test(f.type);

export function Library() {
  const images = useStore((s) => s.images);
  const selected = useStore((s) => s.selected);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const click = useStore((s) => s.click);
  const toggle = useStore((s) => s.toggle);
  const selectAll = useStore((s) => s.selectAll);
  const clear = useStore((s) => s.clear);
  const upload = useStore((s) => s.upload);
  const uploadPct = useStore((s) => s.uploadPct);
  const loading = useStore((s) => s.loading);
  const setPublishOpen = useStore((s) => s.setPublishOpen);
  const autotag = useStore((s) => s.autotag);

  const visible = useStore((s) => s.visible)();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const dragDepth = useRef(0);

  const pick = (list: FileList | File[] | null) => {
    if (!list) return;
    void upload(Array.from(list).filter(isImage));
  };

  // drag & drop over the whole page
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth.current++;
      setDrag(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDrag(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDrag(false);
      pick(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selectAll, clear]);

  const allSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));
  const onCard = useCallback(
    (id: string) => (e: React.MouseEvent) => click(id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }),
    [click],
  );

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <header className="flex h-14 min-w-0 shrink-0 items-center gap-2.5 border-b border-line px-5 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <h1 className="text-[15px] font-extrabold tracking-tight">Library</h1>
        <span className="font-mono text-[12px] text-faint">
          {visible.length}
          {visible.length !== images.length ? ` / ${images.length}` : ''}
        </span>

        <div className="ml-2 inline-flex rounded-sm border border-line bg-surface p-0.5">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-6 whitespace-nowrap rounded-[4px] px-2.5 text-[11.5px] font-bold transition-colors ${
                filter === f ? 'bg-surface-3 text-text' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto min-w-[64px] max-w-60 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or tag…"
            className="field h-8 py-0 pl-8"
          />
        </div>

        <button
          onClick={allSelected ? clear : selectAll}
          className="btn-ghost h-8"
          disabled={!visible.length}
          aria-label={allSelected ? 'Deselect all' : 'Select all'}
        >
          {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          {/* label only on wide screens: the toolbar must not overflow into the inspector */}
          <span className="hidden 2xl:inline">{allSelected ? 'Deselect all' : 'Select all'}</span>
        </button>

        <button onClick={() => fileRef.current?.click()} className="btn-ghost h-8" disabled={uploadPct !== null} aria-label="Import">
          <Upload size={14} strokeWidth={2.5} />
          <span className="hidden min-[1400px]:inline">Import</span>
        </button>
        <button onClick={() => autotag()} className="btn-ghost h-8" disabled={selected.size === 0} aria-label="Auto-tag">
          <Wand2 size={14} strokeWidth={2.5} />
          <span className="hidden min-[1400px]:inline">Auto-tag</span>
        </button>
        <button onClick={() => setPublishOpen(true)} className="btn-primary h-8" disabled={selected.size === 0}>
          <Send size={14} strokeWidth={2.5} />
          Publish{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      {/* upload progress bar */}
      {uploadPct !== null && (
        <div className="h-0.5 w-full bg-surface-3">
          <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.max(uploadPct, 3)}%` }} />
        </div>
      )}

      {/* grid */}
      <div className="flex-1 overflow-y-auto p-5" onClick={(e) => e.target === e.currentTarget && clear()}>
        {loading ? null : images.length === 0 ? (
          <EmptyState onPick={() => fileRef.current?.click()} />
        ) : visible.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-faint">Nothing matches this filter.</div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
            {visible.map((img) => (
              <ImageCard key={img.id} image={img} selected={selected.has(img.id)} onClick={onCard(img.id)} onToggle={() => toggle(img.id)} />
            ))}
          </div>
        )}
      </div>

      {/* drop overlay */}
      {drag && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-bg/80 backdrop-blur-[2px]">
          <div className="animate-fade-up rounded-lg border-2 border-dashed border-accent px-10 py-8 text-center">
            <ImagePlus size={28} className="mx-auto mb-3 text-accent" />
            <div className="text-base font-extrabold">Drop to import</div>
            <div className="mt-1 text-[12.5px] text-muted">PNG · JPG · WebP</div>
          </div>
        </div>
      )}
    </section>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <button onClick={onPick} className="group max-w-sm rounded-lg border border-dashed border-line-strong px-12 py-10 text-center transition-colors hover:border-accent">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
          <ImagePlus size={22} />
        </div>
        <div className="text-[15px] font-extrabold">Drop your images here</div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-muted">
          or click to choose files.
          <br />
          ComfyUI metadata is read automatically.
        </div>
      </button>
    </div>
  );
}
