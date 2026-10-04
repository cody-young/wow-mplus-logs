/**
 * A dungeon, as its game icon.
 *
 * There is no dungeon-art endpoint to ask, but there does not need to be: a
 * dungeon's teleport spell carries exactly the icon the game uses for the
 * dungeon itself, so this is one more spell id down the path the spell icons
 * already take. MDT's own dungeon picker draws itself the same way.
 *
 * Which means the icon arrives with the enemy-forces table and is absent for
 * the same reason a count is — no MDT beside the log. That is why the fallback
 * is a real one rather than an empty box: the key rows have to look deliberate
 * for the many users who will never install MDT.
 */
import { useSpellIcons } from '../icons.js';

export function DungeonIcon({
  teleportSpellId,
  zoneName,
  size = 34,
}: {
  teleportSpellId: number;
  zoneName: string;
  size?: number;
}): React.JSX.Element {
  const icons = useSpellIcons(teleportSpellId > 0 ? [teleportSpellId] : []);
  const url = icons.get(teleportSpellId);

  return (
    <span className="dungeon-ico" style={{ width: size, height: size }} title={zoneName}>
      {url === undefined ? (
        // The dungeon's initials: two letters are enough to tell the rows of a
        // list apart, which is all the icon was doing.
        <span className="dungeon-initials">{initials(zoneName)}</span>
      ) : (
        <img src={url} alt="" width={size} height={size} />
      )}
    </span>
  );
}

/**
 * Up to two letters for a dungeon name, skipping the words that are the same
 * across half the dungeon list and so distinguish nothing.
 */
const NOISE = new Set(['the', 'of', 'and', 'in', 'a']);

function initials(zoneName: string): string {
  const words = zoneName
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '' && !NOISE.has(word.toLowerCase()));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
