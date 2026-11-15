import { memo } from 'react';
import { Check, Sparkles } from 'lucide-react';
import type { Image } from '@/lib/types';
import { SPEC } from '@shared/platforms';

type Props = {
  image: Image;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggle: () => void;
};

export const ImageCard = memo(function ImageCard({ image, selected, onClick, onToggle }: Props) {
  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer select-none overflow-hidden rounded-md border bg-surface transition-colors ${
        selected ? 'border-accent' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="relative aspect-square bg-surface-2">
        <img
          src={image.thumb}
          alt=""
          loading="lazy"
          draggable={false}
          className={`h-full w-full object-cover transition-opacity ${selected ? 'opacity-85' : ''}`}
        />
        {selected && <div className="pointer-events-none absolute inset-0 bg-accent/15" />}

        {/* checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label="Select"
          className={`absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-sm border-2 transition-all ${
            selected
              ? 'border-accent bg-accent text-white'
              : 'border-white/70 bg-black/40 text-transparent opacity-0 group-hover:opacity-100'
          }`}
        >
          <Check size={14} strokeWidth={3} />
        </button>

        <div className="absolute right-2 top-2 flex gap-1">
          {image.comfy && (
            <span title="ComfyUI metadata detected" className="grid h-6 w-6 place-items-center rounded-sm bg-black/55 text-text">
              <Sparkles size={13} />
            </span>
          )}
          {image.nsfw && (
            <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">R-18</span>
          )}
        </div>
      </div>

      <div className="px-2.5 py-2">
        <div className="truncate text-[12.5px] font-semibold" title={image.title}>
          {image.title || <span className="text-faint">Untitled</span>}
        </div>
        <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-faint">
          <span>
            {image.width}×{image.height}
          </span>
          <span className="flex items-center gap-1.5">
            {Array.from(new Set(image.posts.map((p) => p.platform))).map((p) => (
              <span key={p} title={`Published on ${SPEC[p].name}`} className="h-1.5 w-1.5 rounded-full" style={{ background: SPEC[p].color }} />
            ))}
            <span className={image.tags.length ? 'text-muted' : ''}>{image.tags.length ? `${image.tags.length} tag${image.tags.length > 1 ? 's' : ''}` : '—'}</span>
          </span>
        </div>
      </div>
    </div>
  );
});
