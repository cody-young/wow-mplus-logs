/**
 * A player's spec, as its game icon.
 *
 * Reserves its box whether or not the art has arrived, so a name never shifts
 * sideways when the icons resolve a moment after the table paints. Until then
 * — and forever, offline or for a spec we have no id for — the box holds the
 * class colour, which was the only cue these views had before and is still the
 * one that survives everything.
 *
 * The icon is decoration over that colour, not a replacement for it: the two
 * together are what makes a row identifiable at a glance, and spec icons are
 * genuinely hard to tell apart at 16px for the three specs of a class.
 */
import { useSpecIcons } from '../icons.js';
import { specOf } from '../specs.js';

export function SpecIcon({
  specId,
  size = 16,
  title,
}: {
  specId: number;
  size?: number;
  /** Defaults to "Spec Class"; pass a name to put the player in it too. */
  title?: string;
}): React.JSX.Element {
  const icons = useSpecIcons();
  const spec = specOf(specId);
  const url = spec.icon === '' ? undefined : icons.get(spec.icon);
  const label = title ?? (spec.className === '' ? spec.name : `${spec.name} ${spec.className}`);

  return (
    <span
      className="spec-ico"
      style={{ width: size, height: size, background: spec.color }}
      title={label}
    >
      {url === undefined ? null : <img src={url} alt="" width={size} height={size} />}
    </span>
  );
}
