import { AlertTriangle, HelpCircle } from 'lucide-react';
import { ageRisk, RISK_LABEL, type RiskLevel } from '@shared/age';
import type { Character } from '@/lib/types';

const COLOR: Record<RiskLevel, string> = { minor: 'text-accent', young: 'text-warn', ok: 'text-ok', unknown: 'text-faint' };

/** Warning triangle for a character's DeviantArt age risk (nothing when adult unless `showOk`). */
export function RiskBadge({ c, size = 13, showUnknown = false }: { c: Character; size?: number; showUnknown?: boolean }) {
  const r = ageRisk(c);
  if (r.level === 'ok' || (r.level === 'unknown' && !showUnknown)) return null;
  const Icon = r.level === 'unknown' ? HelpCircle : AlertTriangle;
  return (
    <span className={`inline-flex shrink-0 ${COLOR[r.level]}`} title={`${RISK_LABEL[r.level]}\n${r.reasons.join('\n')}`} role="img" aria-label={RISK_LABEL[r.level]}>
      <Icon size={size} strokeWidth={2.5} />
    </span>
  );
}

export { COLOR as RISK_COLOR };
