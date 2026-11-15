import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { Inspector } from '@/components/Inspector';
import { Library } from '@/pages/Library';
import { Settings } from '@/pages/Settings';
import { Queue } from '@/pages/Queue';
import { Platforms } from '@/pages/Platforms';
import { Characters } from '@/pages/Characters';
import { Presets } from '@/pages/Presets';
import { PublishDialog } from '@/components/PublishDialog';

export default function App() {
  const page = useStore((s) => s.page);
  const load = useStore((s) => s.load);
  const toasts = useStore((s) => s.toasts);

  const refreshJobs = useStore((s) => s.refreshJobs);
  const refreshAccounts = useStore((s) => s.refreshAccounts);
  const active = useStore((s) => s.jobs.jobs.some((j) => j.status === 'queued' || j.status === 'running'));
  const loginInProgress = useStore((s) => s.accounts.some((a) => a.loginInProgress));

  useEffect(() => {
    void load();
  }, [load]);

  // Polling: fast when something is happening, slow otherwise.
  useEffect(() => {
    const fast = active || page === 'queue' || page === 'history';
    const i = setInterval(() => void refreshJobs(), fast ? 3000 : 15000);
    return () => clearInterval(i);
  }, [active, page, refreshJobs]);
  useEffect(() => {
    if (!loginInProgress && page !== 'platforms') return;
    const i = setInterval(() => void refreshAccounts(), 2500);
    return () => clearInterval(i);
  }, [loginInProgress, page, refreshAccounts]);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {page === 'library' && (
        <>
          <Library />
          <Inspector />
        </>
      )}
      {page === 'characters' && <Characters />}
      {page === 'presets' && <Presets />}
      {page === 'queue' && <Queue />}
      {page === 'history' && <Queue history />}
      {page === 'platforms' && <Platforms />}
      <PublishDialog />
      {page === 'settings' && <Settings />}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold ${
              t.kind === 'err' ? 'border-accent bg-accent-soft text-text' : 'border-line bg-surface-2 text-text'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${t.kind === 'ok' ? 'bg-ok' : t.kind === 'err' ? 'bg-accent' : 'bg-muted'}`} />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
