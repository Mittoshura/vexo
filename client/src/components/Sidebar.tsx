import { Images, ListOrdered, History, Share2, Settings, Users, Tags } from 'lucide-react';
import { useStore, type Page } from '@/lib/store';

const NAV: { id: Page; label: string; icon: typeof Images; soon?: string }[] = [
  { id: 'library', label: 'Library', icon: Images },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'presets', label: 'Presets', icon: Tags },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'history', label: 'History', icon: History },
  { id: 'platforms', label: 'Platforms', icon: Share2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const count = useStore((s) => s.images.length);
  const nChars = useStore((s) => s.characters.length);
  const queued = useStore((s) => s.jobs.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length);
  const connected = useStore((s) => s.accounts.filter((a) => a.connected).length);

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-accent font-extrabold text-bg">V</span>
        <span className="text-[15px] font-extrabold tracking-tight">VEXO</span>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5 px-3">
        {NAV.map(({ id, label, icon: Icon, soon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-semibold transition-colors ${
                active ? 'bg-accent-soft text-text' : 'text-muted hover:bg-surface-3 hover:text-text'
              }`}
            >
              <span className={`h-4 w-[3px] rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`} />
              <Icon size={16} strokeWidth={2.25} className={active ? 'text-accent' : ''} />
              <span className="flex-1 text-left">{label}</span>
              {id === 'library' && count > 0 && (
                <span className="rounded-sm bg-surface-3 px-1.5 font-mono text-[11px] text-muted">{count}</span>
              )}
              {id === 'characters' && nChars > 0 && <span className="rounded-sm bg-surface-3 px-1.5 font-mono text-[11px] text-muted">{nChars}</span>}
              {id === 'queue' && queued > 0 && <span className="rounded-sm bg-accent px-1.5 font-mono text-[11px] text-white">{queued}</span>}
              {id === 'platforms' && connected > 0 && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
              {soon && <span className="text-[10px] font-bold uppercase tracking-wider text-faint">{soon}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-5 pb-5 text-[11px] leading-relaxed text-faint">
        <div className="mb-2 h-px bg-line" />
        <kbd className="font-mono">Ctrl+A</kbd> select all
        <br />
        <kbd className="font-mono">Shift</kbd> / <kbd className="font-mono">Ctrl</kbd> + click range / add
        <br />
        <kbd className="font-mono">Esc</kbd> deselect
      </div>
    </aside>
  );
}
