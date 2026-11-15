import { LogIn, LogOut, RefreshCw, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PLATFORMS, SPEC } from '@shared/platforms';

export function Platforms() {
  const accounts = useStore((s) => s.accounts);
  const login = useStore((s) => s.login);
  const check = useStore((s) => s.checkAccount);
  const logout = useStore((s) => s.logout);
  const toast = useStore((s) => s.toast);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-line px-5">
        <h1 className="text-[15px] font-extrabold tracking-tight">Platforms</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <p className="mb-5 max-w-[640px] text-[12.5px] leading-relaxed text-muted">
          Logging in opens a dedicated VEXO <b className="text-text">Edge</b> window. You log in yourself (username, password, 2FA); VEXO never sees your password, it just reuses the session afterwards.
        </p>
        <div className="grid max-w-[900px] grid-cols-2 gap-3">
          {PLATFORMS.map((p) => {
            const a = accounts.find((x) => x.id === p);
            const spec = SPEC[p];
            return (
              <div key={p} className="rounded-md border border-line bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-md text-[13px] font-extrabold text-bg" style={{ background: spec.color }}>
                    {spec.name[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-extrabold">{spec.name}</div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      {!a?.implemented ? (
                        <span className="text-faint">coming soon</span>
                      ) : a.loginInProgress ? (
                        <span className="flex items-center gap-1 text-warn">
                          <Loader2 size={11} className="animate-spin" /> logging in via Edge…
                        </span>
                      ) : a.connected ? (
                        <span className="flex items-center gap-1 text-ok">
                          <CheckCircle2 size={11} /> connected{a.username ? ` · ${a.username}` : ''}
                        </span>
                      ) : (
                        <span className="text-muted">not connected</span>
                      )}
                    </div>
                  </div>
                </div>
                {a?.error && (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] text-accent">
                    <AlertCircle size={12} /> {a.error}
                  </p>
                )}
                {a?.implemented && (
                  <div className="mt-4 flex gap-1.5">
                    {a.connected ? (
                      <>
                        <button onClick={() => check(p).then(() => toast('Session verified'))} className="btn-ghost h-8 text-[12px]">
                          <RefreshCw size={13} /> Check
                        </button>
                        <button onClick={() => logout(p)} className="btn-quiet h-8 text-[12px] hover:text-accent">
                          <LogOut size={13} /> Log out
                        </button>
                      </>
                    ) : (
                      <button onClick={() => login(p)} disabled={a.loginInProgress} className="btn-primary h-8 text-[12px]">
                        <LogIn size={13} /> Log in
                      </button>
                    )}
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-faint">{spec.hint}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
