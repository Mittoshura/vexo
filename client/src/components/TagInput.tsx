import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

const split = (s: string) =>
  s
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);

export function TagInput({ value, onChange, placeholder, autoFocus }: Props) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parts = split(draft);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="field flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5 py-1.5" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((t) => (
        <span key={t} className="chip max-w-full">
          <span className="truncate">{t}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((x) => x !== t));
            }}
            className="ml-0.5 text-muted hover:text-accent"
            aria-label={`Remove ${t}`}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        onPaste={(e) => {
          const txt = e.clipboardData.getData('text');
          if (txt.includes(',') || txt.includes('\n')) {
            e.preventDefault();
            onChange(Array.from(new Set([...value, ...split(txt)])));
          }
        }}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[80px] flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  );
}
