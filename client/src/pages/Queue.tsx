import { useEffect, useState } from 'react';
import { XCircle, RotateCcw, Trash2, ExternalLink, Loader2, Clock, CheckCircle2, AlertCircle, Ban, ChevronDown } from 'lucide-react';
import { useStore } from '@/lib/store';
import { SPEC } from '@shared/platforms';
import type { Job, JobStatus } from '@/lib/types';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function useNow(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

const rel = (iso: string, now: number) => {
  const d = Math.round((Date.parse(iso) - now) / 1000);
  if (d <= 0) return 'now';
  if (d < 60) return `in ${d}s`;
  if (d < 3600) return `in ${Math.floor(d / 60)} min`;
  return `in ${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min`;
};

const STATUS: Record<JobStatus, { label: string; icon: typeof Clock; cls: string }> = {
  queued: { label: 'Queued', icon: Clock, cls: 'text-muted' },
  running: { label: 'Sending…', icon: Loader2, cls: 'text-accent' },
  done: { label: 'Posted', icon: CheckCircle2, cls: 'text-ok' },
  failed: { label: 'Failed', icon: AlertCircle, cls: 'text-accent' },
  cancelled: { label: 'Cancelled', icon: Ban, cls: 'text-faint' },
};

export function Queue({ history }: { history?: boolean }) {
  const data = useStore((s) => s.jobs);
  const jobAction = useStore((s) => s.jobAction);
  const accounts = useStore((s) => s.accounts);
  const now = useNow();
  const jobs = data.jobs.filter((j) => (history ? j.status === 'done' || j.status === 'failed' || j.status === 'cancelled' : j.status === 'queued' || j.status === 'running'));

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <h1 className="text-[15px] font-extrabold tracking-tight">{history ? 'History' : 'Queue'}</h1>
        <span className="font-mono text-[12px] text-faint">{jobs.length}</span>
        {!history && (
          <div className="ml-auto flex gap-2 font-mono text-[11px] text-faint">
            {Object.entries(data.nextSlot)
              .filter(([, v]) => v)
              .map(([p, v]) => (
                <span key={p} className="rounded-sm bg-surface-2 px-2 py-1">
                  {SPEC[p as keyof typeof SPEC].name}: next slot {rel(v!, now)}
                </span>
              ))}
          </div>
        )}
        {history && jobs.length > 0 && (
          <button
            onClick={async () => {
              if (!window.confirm('Clear history? (images stay marked as posted)')) return;
              for (const j of jobs) await jobAction(j.id, 'delete');
            }}
            className="btn-quiet ml-auto h-8 text-[12.5px]"
          >
            <Trash2 size={14} /> Clear
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {jobs.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-faint">{history ? 'No finished posts.' : 'Nothing queued. Select images and click "Publish".'}</div>
        ) : (
          <div className="mx-auto max-w-[860px] space-y-2">
            {jobs.map((j) => {
              const acc = accounts.find((a) => a.id === j.platform);
              const blocked = j.status === 'queued' && acc && !acc.connected;
              return <JobCard key={j.id} job={j} now={now} blocked={!!blocked} onAction={(a) => jobAction(j.id, a)} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function JobCard({ job: j, now, blocked, onAction }: { job: Job; now: number; blocked: boolean; onAction: (a: 'cancel' | 'retry' | 'delete') => void }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[j.status];
  const Icon = st.icon;
  const spec = SPEC[j.platform];
  return (
    <div className={`rounded-md border bg-surface ${j.status === 'running' ? 'border-accent' : 'border-line'}`}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex -space-x-2">
          {j.images.slice(0, 4).map((i) => (
            <img key={i.id} src={i.thumb} alt="" className="h-11 w-11 rounded-sm border-2 border-surface object-cover" />
          ))}
          {j.images.length > 4 && <div className="grid h-11 w-11 place-items-center rounded-sm border-2 border-surface bg-surface-3 font-mono text-[11px] text-muted">+{j.images.length - 4}</div>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-bold">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: spec.color }} />
            {spec.name}
            <span className="text-muted">·</span>
            <span className="truncate text-muted">{j.images.map((i) => i.title).join(', ') || '—'}</span>
            {j.images.some((i) => i.nsfw) && <span className="rounded-sm bg-accent px-1 text-[9px] font-extrabold text-white">R-18</span>}
            {j.options.restrict && j.options.restrict !== 'public' && <span className="rounded-sm bg-surface-3 px-1.5 text-[10px] font-bold uppercase text-muted">{j.options.restrict}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-faint">
            <span className={`flex items-center gap-1 ${st.cls}`}>
              <Icon size={12} className={j.status === 'running' ? 'animate-spin' : ''} /> {st.label}
            </span>
            {j.status === 'queued' && <span>· {blocked ? 'blocked: not connected' : rel(j.scheduled_at, now)}</span>}
            {j.finished_at && <span>· {fmt(j.finished_at)}</span>}
            {j.status === 'failed' && j.error && <span className="truncate text-accent">· {j.error}</span>}
            {j.result?.url && (
              <a href={j.result.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-text hover:text-accent">
                <ExternalLink size={11} /> view post
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {j.log.length > 0 && (
            <button onClick={() => setOpen((v) => !v)} className="btn-quiet btn-icon" aria-label="Log">
              <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
          {j.status === 'queued' && (
            <button onClick={() => onAction('cancel')} className="btn-quiet h-8 text-[12px]">
              <XCircle size={14} /> Cancel
            </button>
          )}
          {(j.status === 'failed' || j.status === 'cancelled') && (
            <button onClick={() => onAction('retry')} className="btn-ghost h-8 text-[12px]">
              <RotateCcw size={13} /> Retry
            </button>
          )}
          {j.status !== 'running' && j.status !== 'queued' && (
            <button onClick={() => onAction('delete')} className="btn-quiet btn-icon hover:text-accent" aria-label="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <pre className="max-h-48 overflow-auto border-t border-line bg-surface-2 px-4 py-2.5 font-mono text-[11px] leading-relaxed text-muted">
          {j.log.join('\n')}
          {j.result && 'raw' in (j.result as object) ? `\n${JSON.stringify((j.result as { raw: unknown }).raw, null, 1).slice(0, 1500)}` : ''}
        </pre>
      )}
    </div>
  );
}
