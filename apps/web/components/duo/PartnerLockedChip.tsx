import { duoCopy } from '@/lib/copy';
import { formatHoursAgo } from '@/lib/format-et';

export interface PartnerLockedChipProps {
  partnerHandle: string;
  /** ISO instant the partner's pick landed (minute-truncated by the server, §9.2). */
  pickedAtIso: string;
  /** Injectable for tests; defaults to the real clock. */
  nowMsValue?: number;
  className?: string;
}

/**
 * SW10-T3(a) (wiring-gaps doc §4 SW10-T3): the sealed partner chip — `SwipeBallot`'s footer,
 * behind the `duo_queue` flag and an active duo (see that component's `partnerLocked` prop).
 * Sealed means existence + timing ONLY: this component has no branch for an "unsealed" state and
 * never receives (let alone renders) the partner's side — that only ever surfaces post-reveal,
 * via `DuoTandem`.
 */
export function PartnerLockedChip({
  partnerHandle,
  pickedAtIso,
  nowMsValue,
  className = '',
}: PartnerLockedChipProps) {
  const hoursAgo = formatHoursAgo(pickedAtIso, nowMsValue ?? Date.now());
  return (
    <p
      data-testid="partner-locked-chip"
      className={`text-muted inline-block font-mono text-[10px] font-semibold tracking-wide uppercase ${className}`}
    >
      {duoCopy.partnerLockedChip(partnerHandle, hoursAgo)}
    </p>
  );
}
