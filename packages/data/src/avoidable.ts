/**
 * Avoidable damage: the spells a careful player takes none of.
 *
 * HAND-CURATED. Unlike every other table in this package this one is not
 * generated, because nothing in the game's data says "you should have moved".
 * A ground effect and a pulse nobody can dodge are both just area damage to
 * SpellEffect.db2, and on a real key the two cannot be told apart by their
 * targeting. So this is a list people keep, the way Elitism Helper's was, and
 * it ships with the app: edit it here, and the next release carries it.
 *
 * Where it came from. Each dungeon's entries start from Method's ability
 * tracker for Midnight Season 2 (method.gg/guides/dungeons/<slug>/ability-
 * tracker), which tags every ability Avoid, Frontal, Party Damage and so on.
 * Those tags name the *cast*; what lands on a player is often another id —
 * Defiled Slam is cast as 1294824 and hits as 1294827 — and an ability tagged
 * both Avoid and Party Damage usually has one id for each half. So every id
 * below was then matched against SpellEffect's trigger chains, the spell's own
 * tooltip, and what sixteen real keys (seven of the eight dungeons, +12 to
 * +17) show actually hit the party, and only the avoidable half was kept.
 * It was then rerun against 99 keys (all eight dungeons, +5 to +17), which
 * took out Chillstorm.
 *
 * Elitism Helper's table (v0.15.3) was cross-checked against this, but of this
 * season it covers only Ruby Life Pools, from its Dragonflight run. Its ids
 * there were followed through the live SpellEffect: the ones still dealing
 * damage were added, and the ones Midnight retired or reworked are noted
 * under that dungeon. Nothing else was taken from it — it carries no licence.
 *
 * What goes in:
 *
 *   - puddles, swirls, beams, tornadoes and patches left on the ground
 *   - frontals and line attacks that lock in place
 *   - mob-centred whirlwinds and death explosions you can walk away from
 *
 * What stays out, even when the guide tags the ability Avoid:
 *
 *   - the unavoidable half of a mixed ability: Defiled Slam's slam is out and
 *     its Defiled Detonations are in
 *   - anything centred on the player it targets: a DoT's splash, a leap onto
 *     you, a bomb that goes off where you are. The target cannot avoid it, and
 *     the log cannot tell the target from a bystander — unless the burst is
 *     logged on the moment the target's own debuff comes off, which is what
 *     `unlessOwn` is for
 *   - soaks, which are meant to be taken
 *   - any id that hit every non-tank about equally in every logged key — in
 *     the keys behind this list Cosmic Crash, Poison Splash and Infest's DoT
 *     did, so whatever the tooltip promises, in practice nobody dodges them.
 *     Calling a player out for damage nobody avoids is worse than missing a
 *     fail
 *
 * `tank` marks a frontal aimed at the tank. The tank takes it by design; anyone
 * else in it did not have to be. That is Elitism Helper's SpellsNoTank.
 *
 * Every entry is a damage id — what a *_DAMAGE line carries — never a cast or
 * an aura id. An id that has not yet hit anyone in a log we have says so, as
 * the first thing to check if it turns out wrong.
 */

export interface AvoidableSpell {
  /** The damage id, as the log writes it on the hit. */
  id: number;
  name: string;
  /** Aimed at the tank by design, so only counted against everyone else. */
  tank?: boolean;
  /**
   * A debuff whose burst this is. Everyone takes the burst of their own, so a
   * hit counts only when the victim's own copy of this aura did not just come
   * off — that is, when they stood in somebody else's.
   */
  unlessOwn?: number;
  /** What the player did wrong, for whoever edits this next. */
  why: string;
}

interface Dungeon {
  challengeModeId: number;
  name: string;
  spells: readonly AvoidableSpell[];
}

const DUNGEONS: readonly Dungeon[] = [
  {
    challengeModeId: 588,
    name: 'Altar of Fangs',
    spells: [
      { id: 1306235, name: 'Septic Spatter', why: 'Venom Leech death puddles' },
      { id: 1305637, name: 'Septic Spatter', why: 'Venom Leech death burst' },
      { id: 1306669, name: 'Toxic Breath', tank: true, why: 'Twinfang Harrower frontal, starts on the tank and rotates' },
      { id: 1307915, name: 'Ravenous Stomp', why: "Rav'i's falling stalactites" },
      { id: 1296069, name: 'Regurgitate', why: "Rav'i's acid waves" },
      { id: 1307532, name: 'Bloodletting', why: 'Bloodletter blood puddles' },
      { id: 1300083, name: 'Burrowing Charge', why: 'The Writhing Coil burrow path' },
      { id: 1300044, name: 'Venom Jet', why: 'The Writhing Coil frontal' },
      { id: 1295073, name: 'Virulent Whirl', why: 'Ascendant Serpent roaming tornadoes' },
      { id: 1294958, name: 'Noxious Spray', tank: true, why: 'Ascendant Serpent tank frontal' },
      { id: 1301230, name: 'Bloodletting', why: "Zul'jan's blood puddles" },
      { id: 1301114, name: 'Axegrinder', why: "Zul'jan's spinning axes" },
      {
        id: 1309398,
        name: 'Infest',
        unlessOwn: 1308865,
        why: "Ascendant Serpent: another player's Infest bursting on you. Your own is unavoidable; across 12 keys 22 of 175 bursts hit a second player",
      },
      // Out: Triple Shot's splash (around the debuffed player), Infest 1309382
      // (the DoT itself, on all five at once), Toxic Surge (the pulse; the lines have no id of their
      // own), Boneslicer (aimed at its target), Ravenous Stomp 1307894 (the
      // quake on everyone).
    ],
  },
  {
    challengeModeId: 586,
    name: 'Den of Nalorakk',
    spells: [
      { id: 1297701, name: 'Rotten Ground', why: 'Thornclaw Gatherer puddle' },
      { id: 1234021, name: 'Earthshatter Slam', why: 'The Hoardmonger frontal on a third of the room; not in a log yet' },
      { id: 1252825, name: 'Harsh Winds', why: 'Out of cover in the winds; not in a log yet' },
      { id: 1240280, name: 'Pulverize', why: 'Avatar of Determination 12yd slam' },
      { id: 1235635, name: 'Raging Squall', why: 'Sentinel of Winter tornadoes' },
      { id: 1235641, name: 'Raging Squall', why: 'Sentinel of Winter tornado impact' },
      { id: 1235795, name: 'Shattering Frostspike', why: 'Sentinel of Winter spike either side of the boss' },
      { id: 1247030, name: 'Poison Spear Volley', why: 'Grizzled Warbringer spear circles' },
      { id: 1247367, name: 'Earthquake', why: 'Loa Speaker Nanea puddle' },
      { id: 1242887, name: 'Echoing Maul', why: "Nalorakk's echo landing on a marked spot" },
      { id: 1255577, name: 'Spectral Slash', why: 'Too close to an Echo of Nalorakk' },
      // Out: Rotten Supplies 1297699 (the hit on its target), Cryo Surge (a
      // DoT's splash), Earthquake 1247366 (the hit on its target).
    ],
  },
  {
    challengeModeId: 249,
    name: "Kings' Rest",
    spells: [
      { id: 270003, name: 'Suppression Slam', why: 'Animated Guardian frontal' },
      { id: 265914, name: 'Molten Gold', why: "The Golden Serpent's gold pools" },
      { id: 270891, name: 'Overload', why: "King Rahu'ai's channel around himself" },
      { id: 270928, name: 'Bladestorm', why: 'King Timaji bladestorm' },
      { id: 270292, name: 'Purifying Flame', why: 'Purification Construct fire zone' },
      { id: 271564, name: 'Lingering Fluid', why: 'Embalming Fluid death circles; not in a log yet' },
      { id: 267639, name: 'Burn Corruption', why: "Mchimba's purifying flames" },
      { id: 267874, name: 'Burning Ground', why: "Mchimba's patch left behind" },
      { id: 1312143, name: 'Explosive Acids', why: 'Drain Fluids circles' },
      { id: 270485, name: 'Violent Lunge', why: 'Royal Berserker leap' },
      { id: 270514, name: 'Seismic Upheaval', why: 'Ghostly Brute 18yd slam' },
      { id: 266206, name: 'Whirling Axes', why: 'Kula 10yd spin' },
      { id: 266191, name: 'Whirling Axe', why: "Kula's spiralling axes" },
      { id: 267105, name: 'Torrent', why: 'Torrent Totem water' },
      { id: 1302945, name: 'Impaling Spear', why: 'Dazar spears from the ceiling' },
      { id: 1303374, name: 'Searing Gold', tank: true, why: "Dazar's golden melee cone" },
      // Out: Spit Gold 265773 and 1312104 (the DoT and its hit on the target),
      // Shadow Whirlwind (the AoE; its circles have no id of their own), Drain
      // Fluids (the channel on its target), Dark Revelation, Quaking Leap and
      // Erupting Slam (aimed at a player), Hunting Leap 1303039 (the leap onto
      // the tank) and 270503 (the raptors' frontal channel, which hit every
      // non-tank evenly in both keys).
    ],
  },
  {
    challengeModeId: 587,
    name: 'Murder Row',
    spells: [
      { id: 1216538, name: 'Fel Detonation', why: 'Felwyrm death explosion' },
      { id: 1253813, name: 'Fel Spray', tank: true, why: 'Kystia Manaheart rotating tank frontal' },
      { id: 474768, name: 'Delivery!', why: 'Zaen Bladesorrow Same-Day Delivery impact' },
      { id: 474740, name: 'Murder in a Row', why: 'Not behind a Fel-Infused Freight' },
      { id: 1297691, name: 'Whirlwind', why: 'Shivan Punisher 12yd whirlwind' },
      { id: 1297695, name: 'Felfire Bombardment', why: 'Fel Invoker bombardment' },
      { id: 1216955, name: 'Eye Beam', tank: true, why: 'Felmaster Lucsei tank beam' },
      { id: 473898, name: 'Legion Strike', tank: true, why: "Xathuux's tank frontal" },
      { id: 474234, name: 'Burning Steps', why: "Xathuux's Demonic Rage puddles" },
      { id: 1294836, name: 'Defiled Detonation', why: 'Defiled Golem circles' },
      { id: 1215985, name: 'Fel Beam', why: 'Defiled Golem beams' },
      { id: 1217384, name: 'Malefic Wave', why: "Lithiel Cinderfury's wave; the gateway gets you over it" },
      // Out: Burning Fel (the Massive Felwyrm pulse), Fel Nova (a teleport onto
      // a player that explodes where they stand), Demonic Rage 474197 and
      // Defiled Slam 1294827 (the AoE half), Fire Bomb, Infernal Crush and
      // Fingers of Gul'dan (centred on players, and hit every non-tank in
      // every key).
    ],
  },
  {
    challengeModeId: 399,
    name: 'Ruby Life Pools',
    // Every id is the guide's, followed through SpellEffect to the one that
    // deals the damage, then checked against Elitism Helper's Dragonflight
    // list for the dungeon and against ten keys of logs.
    spells: [
      { id: 1310489, name: 'Blast Chunks', why: 'Primal Juggernaut debris circles' },
      { id: 385292, name: 'Molten Steel', why: 'Defier Draghar Steel Barrage circles' },
      { id: 372088, name: 'Blazing Rush', tank: true, why: 'Defier Draghar charge line' },
      { id: 372796, name: 'Blazing Rush', tank: true, why: 'The bleed from being in the charge' },
      { id: 1307372, name: 'Fiery Demise', why: 'Scorchling death puddle' },
      { id: 378968, name: 'Flame Patch', why: "Scorchling puddle, Dragonflight's id; in none of ten keys, so Fiery Demise has likely replaced it" },
      { id: 384024, name: 'Hailbombs', why: "Melidrussa's hailbombs" },
      { id: 373973, name: 'Blaze of Glory', why: 'Ashseer Flamelasher death whirl' },
      { id: 373977, name: 'Blaze of Glory', why: 'Ashseer Flamelasher embers' },
      { id: 373614, name: 'Burnout', why: 'Blazebound Destroyer death explosion' },
      { id: 391724, name: 'Flame Breath', why: 'Flamegullet frontal' },
      { id: 391727, name: 'Storm Breath', why: 'Thunderhead frontal' },
      { id: 1309540, name: 'Ritual of Blazebinding', why: "Kokia's 12yd impact" },
      { id: 372811, name: 'Molten Boulder', why: "Kokia's rolling boulder" },
      { id: 372819, name: 'Molten Boulder', why: "Kokia's boulder exploding where it stops" },
      { id: 372820, name: 'Scorched Earth', why: "Kokia's boulder trail" },
      { id: 373087, name: 'Burnout', why: 'Blazebound Firestorm death explosion' },
      { id: 381526, name: 'Roaring Firebreath', why: "Kyrakka's frontal" },
      { id: 384773, name: 'Flaming Embers', why: 'Inferno Spit puddles' },
      // Out: Living Bomb and Stormcloud Detonation (centred on their target),
      // Hailburst and Excavating Blast (the AoE half), Steel Barrage (the
      // channel on the tank), and Chillstorm 383925 and 397077 — the guide's
      // tornado, but across ten keys it hit all five players, tank included,
      // within a hit or two of each other, so it is a pulse on the party.
      //
      // Elitism Helper has these, and they stay out here:
      //   - Stormcloud Detonation 392399, which it calls Crackling Detonation.
      //     The Thundercloud charges a player and bursts on arrival, so it is
      //     centred on that player.
      //   - Excavating Blast 372696 and Jagged Earth 372697. These were
      //     Dragonflight's swirl. Midnight's Excavating Blast, 1305201, is a
      //     pulse on everyone, and its dodgeable part is Blast Chunks.
      //   - Ritual of Blazebinding 372863, which is now only the cast; it
      //     deals its damage as 1309540.
      // It counts Blazing Rush against everyone. Midnight aims it at the tank.
    ],
  },
  {
    challengeModeId: 250,
    name: 'Temple of Sethraliss',
    spells: [
      { id: 1292585, name: 'Sandburst Arrow', why: 'Sandswept Hunter arrow' },
      { id: 1288235, name: 'Thunder and Lightning', why: "Adderis's 20yd thunder after the split; not in a log yet" },
      { id: 1314051, name: 'Thunder and Lightning', why: "Adderis's 20yd thunder after the split" },
      { id: 272655, name: 'Scouring Sand', why: 'Sand-Sworn Rider and Krolusk Matriarch frontal' },
      { id: 1293133, name: 'Lingering Storm', why: "Lightning Serpent's puddle" },
      { id: 1289589, name: 'Lingering Storm', why: 'Storm Catalyst pool' },
      { id: 1291622, name: 'Storm Catalyst', why: 'Storm Serpent strike' },
      { id: 1298329, name: 'Thunder Spit', why: "Merektha's circles under the target" },
      { id: 1291734, name: 'Thunder Spit', why: "Merektha's circles under the target" },
      { id: 1296912, name: 'Storm Strikes', why: 'Serpentstorm circles' },
      { id: 264206, name: 'Burrow', why: "Merektha's burrow path" },
      { id: 1293652, name: 'Call Lightning', why: 'Agitated Nimbus strike' },
      { id: 1291598, name: 'Lightning Spire', why: "Galvazzt's spire strikes" },
      { id: 1291815, name: 'Induction Field', why: "Galvazzt's static field" },
      { id: 1303452, name: 'Venom Shrapnel', why: 'Orb Watcher venom circles' },
      { id: 1300684, name: 'Hex Muck', why: 'Latent Hex puddle' },
      { id: 1301253, name: 'Agony of Sethraliss', why: 'Avatar room strikes' },
      { id: 267483, name: 'Loose Sparks', why: 'Spark Channeler spark patterns' },
      // Out: Gale Force and Tempest Winds (at every player), Thunder and
      // Lightning 1288092 (the split soak), Spark Step (a teleport onto a
      // player that bursts where they stand), Induction and Serpentstorm (the
      // AoE half), Galvanized (intercepting a spire is the job), Burrowquake,
      // Latent Hex 1311964/1311979 (around the debuffed player), Corruption
      // Burst (a missed soak, not a dodge).
    ],
  },
  {
    challengeModeId: 584,
    name: 'The Blinding Vale',
    spells: [
      { id: 1237858, name: 'Ruptured Earth', why: 'Virid Grovekeeper slowing puddle' },
      { id: 1263642, name: 'Belch Spores', why: 'Sporeblight Belcher circles' },
      { id: 1238638, name: 'Bullet Seeds', why: 'Overgrown Hydra seed lines' },
      { id: 1261013, name: 'Fan Of Thorns', why: 'Lightblossom Trinity thorn channel; not in a log yet' },
      { id: 1235546, name: 'Lightsower Dash', why: 'Lightblossom Trinity dash line' },
      { id: 1235828, name: 'Light-Scorched Earth', why: 'Lightblossom puddles' },
      { id: 1237330, name: 'Bloodthorn Roots', why: "Ikuzz's roots that emerge where you stood" },
      { id: 1242138, name: 'Solar Breath', why: 'Luminous Thornmaw frontal' },
      { id: 1239919, name: 'Lightfire Beams', why: "Lightwarden Ruia's silencing tornadoes" },
      { id: 1240152, name: 'Lightfall', why: "Lightwarden Ruia's swirls" },
      { id: 1242200, name: "Lightwarden's Blight", why: 'Light-infused death explosion' },
      { id: 1251345, name: 'Blight Resin', why: 'Light-infused death pool' },
      { id: 1246751, name: 'Concentrated Lightbeam', tank: true, why: "Ziekket's tank beam" },
      // Out: Earthrupture Strike and Bedrock Slam (the hit on the tank),
      // Lightmaw Beams (a DoT's splash), Thorncaller Roar (the AoE half),
      // Lightfire 1239825 (the DoT), Pulverizing Strikes (aimed at a player),
      // Hunting Leap 1314885 (the frontal channel, which hit every non-tank
      // evenly — as it does in Kings' Rest).
    ],
  },
  {
    challengeModeId: 585,
    name: 'Voidscar Arena',
    spells: [
      { id: 1249712, name: 'Venomous Spit', why: 'Lost Sethrak pool' },
      { id: 1228126, name: 'Macestorm', why: 'Brutal Overseer whirlwind' },
      { id: 1299145, name: 'Earthsplitter', why: "Aegyra's 15yd slam" },
      { id: 1299913, name: 'Null Eruption', why: 'Voidtouched Magi eruption and its zone' },
      { id: 1234833, name: 'Ravenous Swarm', why: "Chitigoth's roaming swarms" },
      { id: 1234917, name: 'Smashing Charge', tank: true, why: "Brutok's tank charge line" },
      { id: 1249238, name: 'Fire Spit', why: 'Abducted Drakonid fireballs' },
      { id: 1296963, name: 'Umbral Rupture', why: "Taz'Rah's rifts; not in a log yet" },
      { id: 1296967, name: 'Void Fissure', why: "Standing in Taz'Rah's puddles" },
      { id: 1300262, name: 'Dark Bloom', why: "Orbs erupting from Taz'Rah's puddles" },
      { id: 1233264, name: 'Blisterburst', why: 'Blistercreep explosion' },
      { id: 1300116, name: 'Whirling Gust', why: 'Watchful Harrower second AoE after Sky Strike' },
      { id: 1226031, name: 'Poison Splash', why: "Atroxus's poison globs" },
      { id: 1222724, name: 'Noxious Breath', why: "Atroxus's frontal; not in a log yet" },
      { id: 1311923, name: 'Dark Waves', tank: true, why: "Charonus's tank frontal" },
      { id: 1222755, name: 'Void Cascade', why: "Charonus's orb line" },
      // Out: Cosmic Crash 1300372 and Poison Splash 1300351 (hit every
      // non-tank evenly in every key), Nether Dash (at every player), Dark
      // Bloom 1300259 (the AoE half), Sky Strike 1239855 (a soak), Thundering
      // Storm (the AoE half).
    ],
  },
];

/** Built on first lookup, like the generated tables. */
let byId: Map<number, AvoidableSpell & { challengeModeId: number }> | null = null;

function table(): Map<number, AvoidableSpell & { challengeModeId: number }> {
  if (byId === null) {
    byId = new Map();
    for (const dungeon of DUNGEONS) {
      for (const spell of dungeon.spells) {
        byId.set(spell.id, { ...spell, challengeModeId: dungeon.challengeModeId });
      }
    }
  }
  return byId;
}

/**
 * The entry for a damage id, or undefined when it is not avoidable.
 *
 * Looked up by id alone, not by dungeon, so a key whose challenge mode is
 * missing from its log is still checked. Ids are unique across dungeons; the
 * test holds that.
 */
export function avoidable(spellId: number): AvoidableSpell | undefined {
  return table().get(spellId);
}

/**
 * Ids Blizzard's flag carries that are not avoidable, checked against logs.
 *
 * `blizzard-avoidable.ts` is generated, so it is overruled here rather than
 * edited. Only the combined view reads this; Blizzard's own side stays as the
 * data has it, since that side is there to be compared with the in-game meter.
 */
const BLIZZARD_WRONG: ReadonlyMap<number, string> = new Map([
  [1309382, "Infest's DoT ticks, on all five players at once. The burst after it, 1309398, is the part to dodge"],
]);

/** Whether this list overrules Blizzard's avoidable flag on the id. */
export function overrulesBlizzard(spellId: number): boolean {
  return BLIZZARD_WRONG.has(spellId);
}

/** The overruled ids with their reasons. Exported for the test. */
export function blizzardOverrules(): ReadonlyMap<number, string> {
  return BLIZZARD_WRONG;
}

/** The auras an entry's `unlessOwn` names, for the analysis to watch come off. */
export function ownAuras(): ReadonlySet<number> {
  return new Set(avoidableEntries().flatMap((entry) => (entry.unlessOwn === undefined ? [] : [entry.unlessOwn])));
}

/** The dungeons this covers, for the view to say when a key is not one of them. */
export function avoidableDungeons(): ReadonlySet<number> {
  return new Set(DUNGEONS.map((dungeon) => dungeon.challengeModeId));
}

/** Every entry, with its dungeon. Exported for the test. */
export function avoidableEntries(): ReadonlyArray<AvoidableSpell & { challengeModeId: number; dungeon: string }> {
  return DUNGEONS.flatMap((dungeon) =>
    dungeon.spells.map((spell) => ({ ...spell, challengeModeId: dungeon.challengeModeId, dungeon: dungeon.name })),
  );
}
