import type { StringInterner } from './interner.js';

/**
 * Actor table.
 *
 * Every GUID seen in a run gets one row. Pets and guardians carry an owner
 * link so damage can be rolled up to the player, which matters more in M+
 * than in arena: hunter pets, Dancing Rune Weapon, totems and Wild Imps are
 * a large share of several specs' output.
 */

export const enum ActorKind {
  UNKNOWN = 0,
  PLAYER,
  CREATURE,
  PET,
  VEHICLE,
  GAME_OBJECT,
  ENVIRONMENT,
}

export interface Actor {
  /** Row index, used as the value in the store's srcActor/dstActor columns. */
  readonly index: number;
  readonly guid: string;
  kind: ActorKind;
  /** Interned display name, "Name-Realm" for players. */
  nameId: number;
  /** Raw unit flags, most recently observed. */
  flags: number;
  /** Actor row of the owning player for pets and guardians, else -1. */
  ownerIndex: number;
  /** Creature/NPC id parsed out of the GUID, else -1. */
  npcId: number;
  /** Class id from COMBATANT_INFO, else -1. */
  classId: number;
  /** Spec id from COMBATANT_INFO, else -1. */
  specId: number;
  /** True once the actor appears in COMBATANT_INFO, i.e. is in the party. */
  inParty: boolean;
}

/** Unit flag bits we actually branch on. */
export const enum UnitFlag {
  AFFILIATION_MINE = 0x00000001,
  AFFILIATION_PARTY = 0x00000002,
  AFFILIATION_RAID = 0x00000004,
  AFFILIATION_OUTSIDER = 0x00000008,
  REACTION_FRIENDLY = 0x00000010,
  REACTION_NEUTRAL = 0x00000020,
  REACTION_HOSTILE = 0x00000040,
  CONTROL_PLAYER = 0x00000100,
  CONTROL_NPC = 0x00000200,
  TYPE_PLAYER = 0x00000400,
  TYPE_NPC = 0x00000800,
  TYPE_PET = 0x00001000,
  TYPE_GUARDIAN = 0x00002000,
  TYPE_OBJECT = 0x00004000,
}

function kindFromGuid(guid: string): ActorKind {
  if (guid.startsWith('Player-')) return ActorKind.PLAYER;
  if (guid.startsWith('Creature-')) return ActorKind.CREATURE;
  if (guid.startsWith('Pet-')) return ActorKind.PET;
  if (guid.startsWith('Vehicle-')) return ActorKind.VEHICLE;
  if (guid.startsWith('GameObject-')) return ActorKind.GAME_OBJECT;
  if (guid.length === 0 || guid.charCodeAt(0) === 48) return ActorKind.ENVIRONMENT;
  return ActorKind.UNKNOWN;
}

/**
 * Creature GUIDs are "Creature-0-serverID-instanceID-zoneUID-npcID-spawnUID".
 * The npc id is the sixth dash-delimited part and is the key for enemy-forces
 * tables and for naming trash packs.
 */
function npcIdFromGuid(guid: string, kind: ActorKind): number {
  if (kind !== ActorKind.CREATURE && kind !== ActorKind.VEHICLE && kind !== ActorKind.PET) return -1;
  let dashes = 0;
  let start = -1;
  for (let i = 0; i < guid.length; i++) {
    if (guid.charCodeAt(i) !== 45 /* - */) continue;
    dashes++;
    if (dashes === 5) start = i + 1;
    else if (dashes === 6) {
      const value = Number.parseInt(guid.slice(start, i), 10);
      return Number.isNaN(value) ? -1 : value;
    }
  }
  return -1;
}

export class ActorTable {
  private readonly byGuid = new Map<string, Actor>();
  private readonly rows: Actor[] = [];

  constructor(private readonly interner: StringInterner) {}

  /**
   * Returns the row for `guid`, creating it on first sight. `name` and `flags`
   * refresh the row because a unit's first appearance is often as a damage
   * target before its name is known.
   */
  touch(guid: string, name: string, flags: number): Actor {
    let actor = this.byGuid.get(guid);
    if (actor === undefined) {
      const kind = kindFromGuid(guid);
      actor = {
        index: this.rows.length,
        guid,
        kind,
        nameId: this.interner.intern(name),
        flags,
        ownerIndex: -1,
        npcId: npcIdFromGuid(guid, kind),
        classId: -1,
        specId: -1,
        inParty: false,
      };
      this.rows.push(actor);
      this.byGuid.set(guid, actor);
      return actor;
    }
    if (flags !== 0) actor.flags = flags;
    if (name.length > 0 && actor.nameId === 0) actor.nameId = this.interner.intern(name);
    return actor;
  }

  get(guid: string): Actor | undefined {
    return this.byGuid.get(guid);
  }

  at(index: number): Actor | undefined {
    return this.rows[index];
  }

  all(): readonly Actor[] {
    return this.rows;
  }

  get size(): number {
    return this.rows.length;
  }

  /** Party members, in COMBATANT_INFO order. */
  party(): Actor[] {
    return this.rows.filter((actor) => actor.inParty);
  }

  /**
   * Walks pet/guardian ownership to the controlling player, so a Wild Imp's
   * damage lands on the warlock. Falls back to the actor itself.
   */
  attribute(index: number): number {
    let current = index;
    for (let hops = 0; hops < 4; hops++) {
      const actor = this.rows[current];
      if (actor === undefined || actor.ownerIndex < 0) return current;
      current = actor.ownerIndex;
    }
    return current;
  }
}
