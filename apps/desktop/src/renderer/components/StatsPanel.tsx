import type { Awards } from '../awards.js';
import { AwardsCeremony } from './AwardsCeremony.js';
import type { PartyMember } from './RunRow.js';

/**
 * The awards tab: the awards ceremony, for the whole run, as the badges in
 * the header are.
 */
export function StatsPanel({
  party,
  awards,
  autoplay = false,
  onPlayed = () => undefined,
}: {
  party: readonly PartyMember[];
  /** Null while a key is live, which gets no ceremony. */
  awards: Awards | null;
  /** Play the ceremony from the start rather than open it finished. */
  autoplay?: boolean;
  onPlayed?: () => void;
}): React.JSX.Element {
  return (
    <div className="breakdown-wrap">
      {awards === null ? (
        <p className="measure">The awards are handed out when the key ends.</p>
      ) : (
        <AwardsCeremony awards={awards} party={party} autoplay={autoplay} onPlayed={onPlayed} />
      )}
    </div>
  );
}
