/**
 * Generated names for people, bots and worlds. New browser-edition vocabulary, not recovered
 * Mira names. Keep edits here.
 *
 * A given name is built from parts in one of several shapes, so names differ in length and
 * rhythm: a head and a tail ("Zibwick", "Quilara"), two or three spoken syllables ("Tobelin",
 * "Shu", "Ravoska"), or a head with a soft vowel ending ("Pippo"). A bot adds a whimsical role
 * ("Gravel Notary", "Acting Forecaster"); a world adds a place ("Basin", "Probably Solid").
 *
 * Every result is checked against BLOCKED below and rerolled from the same seed if it spells
 * something unkind by accident, so the output stays deterministic.
 */

/** One-syllable heads: the first half of a "head and tail" name. */
const heads = [
  'Arn', 'Bel', 'Bix', 'Bop', 'Bram', 'Cal', 'Cor', 'Dax', 'Dez', 'Dob', 'Dun', 'Ebb', 'Elm', 'Esk',
  'Fen', 'Fig', 'Fizz', 'Gil', 'Glim', 'Gub', 'Hap', 'Hin', 'Hob', 'Hux', 'Ivo', 'Jib', 'Jor', 'Jun',
  'Kaz', 'Kel', 'Kip', 'Kob', 'Lark', 'Lin', 'Lop', 'Lum', 'Mav', 'Mib', 'Mol', 'Mott', 'Mun', 'Nel',
  'Nib', 'Nim', 'Nob', 'Nox', 'Oll', 'Orb', 'Orl', 'Oz', 'Pell', 'Pim', 'Pip', 'Plim', 'Puf', 'Quil',
  'Quin', 'Rix', 'Ros', 'Sib', 'Sol', 'Sprock', 'Tam', 'Tib', 'Tov', 'Tuv', 'Ulm', 'Val', 'Vel', 'Vim',
  'Wen', 'Wex', 'Wil', 'Wim', 'Wob', 'Xan', 'Yar', 'Yim', 'Zan', 'Zep', 'Zib', 'Zor', 'Zuz', 'Bim',
  'Crum', 'Dril', 'Flin', 'Grub', 'Pex', 'Snib', 'Thob', 'Trov', 'Vorn', 'Whim',
]
/** Tails for those heads. A tail starting with a vowel runs on ("Quilara"), others join ("Fenwick"). */
const tails = [
  'wick', 'bert', 'ix', 'ara', 'ette', 'ling', 'ulus', 'omb', 'ka', 'ble', 'pod', 'ander', 'by',
  'ott', 'ina', 'iel', 'ak', 'ump', 'kin', 'ley', 'nik', 'ova', 'oo', 'us', 'eth', 'ard', 'ia', 'on',
  'ella', 'ito', 'ulo', 'ibald', 'wise', 'quist', 'dle', 'ken', 'ter', 'abel', 'enor', 'imo',
  'osa', 'umble', 'wyn', 'ric', 'aby', 'elo', 'opolis', 'tock', 'zle', 'mund', 'bo', 'ix',
]
/** Spoken syllables for the syllable-built shape. */
const firstOnsets = [
  'b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'y', 'z',
  'br', 'dr', 'fl', 'gl', 'kr', 'pl', 'sk', 'sn', 'st', 'tr', 'th', 'sh', 'ch', 'qu', '',
]
/** Later syllables keep to single sounds, so a name stays easy to say. */
const innerOnsets = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'l', 'r', 'n', 'm']
const vowels = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o', 'a', 'o']
/** The last vowel may be long: "Tobeloo", "Mirree". */
const lastVowels = [...vowels, 'oo', 'ee', 'a', 'o']
const codas = ['', '', '', 'n', 'l', 'r', 'm', 'x', 'k', 's', 'th', 'sh', 'nd', 'rk', 'lt', 'sk', 'ndle', 'ven', 'ska', 'lin', 'mo', 'bel', 'wick', 'ton']
/** Soft endings for the "head and vowel" shape. */
const softEnds = ['o', 'a', 'i', 'y', 'ie', 'ee', 'oo', 'u']

/** What the shape of a role is drawn from: odd jobs, cosmic bureaucracy, geology, weather, navigation, repair. */
const roleThings = [
  'Dust', 'Rust', 'Comet', 'Pebble', 'Drizzle', 'Fog', 'Moss', 'Basalt', 'Orbit', 'Lantern', 'Compass',
  'Sprocket', 'Gasket', 'Puddle', 'Nebula', 'Gravel', 'Quartz', 'Meteor', 'Tide', 'Breeze', 'Bolt',
  'Hull', 'Spare', 'Snack', 'Cone', 'Crater', 'Lichen', 'Pumice', 'Mica', 'Cloud', 'Hail', 'Drift',
  'Gust', 'Rainbow', 'Sleet', 'Zenith', 'Apogee', 'Beacon', 'Sextant', 'Waypoint', 'Detour', 'Gear',
  'Valve', 'Hinge', 'Rivet', 'Widget', 'Spanner', 'Grommet', 'Wobble', 'Static', 'Spark', 'Echo',
  'Pollen', 'Sock', 'Biscuit', 'Teacup', 'Moon', 'Glacier', 'Dune', 'Geyser', 'Canyon', 'Ozone',
  'Vapour', 'Ripple', 'Fossil', 'Magnet', 'Pylon', 'Sundial', 'Kettle', 'Cobble', 'Shale', 'Mist',
  'Tangent', 'Satellite', 'Thermos', 'Doodle', 'Puzzle', 'Ladder', 'Noodle', 'Starlight', 'Asteroid',
]
const roleJobs = [
  'Clerk', 'Auditor', 'Pilot', 'Inspector', 'Marshal', 'Intern', 'Notary', 'Surveyor', 'Archivist',
  'Courier', 'Polisher', 'Wrangler', 'Tinkerer', 'Forecaster', 'Steward', 'Registrar', 'Collector',
  'Keeper', 'Counter', 'Mender', 'Botanist', 'Navigator', 'Librarian', 'Taster', 'Sorter', 'Minder',
  'Whisperer', 'Scout', 'Herder', 'Sweeper', 'Tuner', 'Curator', 'Liaison', 'Envoy', 'Monitor',
  'Officer', 'Dispatcher', 'Spotter', 'Fixer', 'Ponderer', 'Admirer', 'Juggler', 'Enthusiast',
  'Consultant', 'Caretaker', 'Gardener', 'Doorman', 'Accountant', 'Translator', 'Apprentice',
]
/** A title before a job: "Acting Notary", "Honorary Spotter". */
const roleTitles = ['Junior', 'Acting', 'Deputy', 'Honorary', 'Assistant', 'Retired', 'Part-time', 'Visiting', 'Senior', 'Spare', 'Chief', 'Lost', 'Former', 'Probably']
/** Whole roles that do not follow the patterns. */
const roleSpecials = ['Junior Moon', 'Hull Intern', 'Snack Probe', 'of the Long Way', 'the Unhurried', 'Who Waved', 'Mostly Harmless Pilot', 'the Patient', 'of No Fixed Orbit', 'the Lukewarm']
const worldPlaces = ['Reach', 'Basin', 'Drift', 'Rest', 'Shelf', 'Hollow', 'Minor', 'Probably Solid', 'Plateau', 'Landing', 'Shallows', 'Expanse', 'Major', 'Terrace', 'Quiet', 'Ridge', 'Fold']

export type NameKind = 'bot' | 'player' | 'world'

/** Longest given name, in characters, so one fits a name plate with room for a role. */
export const MAX_GIVEN_NAME = 12
/** Longest full name of any kind: a bot with its role, or a world with its place. The room's limit too. */
export const MAX_NAME = 24

/**
 * Accidental real words that must never come out of the generator: rude, cruel, violent or
 * the vocabulary the owner retired (no weapons, no death). Checked as substrings of the
 * lower-cased name with spaces removed, so "Kilbert Lantern" cannot hide "kil" + "l...".
 */
export const BLOCKED: readonly string[] = [
  // rude and cruel
  'fuck', 'fuk', 'shit', 'shat', 'cunt', 'dick', 'dik', 'cock', 'cok', 'piss', 'slut', 'whor', 'hoor', 'fag', 'nig', 'neg',
  'rape', 'rapi', 'tit', 'twat', 'arse', 'ass', 'anus', 'anal', 'penis', 'pnis', 'vagin', 'sex', 'porn', 'bitch',
  'bastard', 'damn', 'crap', 'wank', 'bum', 'butt', 'poo', 'pee', 'turd', 'fart', 'boob', 'cum', 'jiz', 'spunk', 'homo', 'lesb',
  'retard', 'tard', 'spaz', 'spaz', 'cripp', 'gimp', 'dumb', 'moron', 'idiot', 'stupid', 'ugly', 'fat', 'jew', 'gay', 'paki',
  'chink', 'gook', 'kike', 'coon', 'wop', 'dago', 'yob', 'tup', 'bonk', 'knob', 'nob', 'prick', 'puss', 'muff', 'hump', 'nazi', 'hitler',
  'satan', 'devil', 'hell', 'god', 'jesus', 'allah', 'drug', 'meth', 'weed', 'crack', 'booz', 'drunk',
  // violence and the retired words (tests/ui/wording.test.ts)
  'kill', 'kil', 'die', 'dead', 'death', 'murd', 'gun', 'shoot', 'shot', 'fire', 'hit', 'stab', 'blood', 'gore', 'war', 'bomb',
  'laser', 'weapon', 'eliminat', 'destroy', 'destruct', 'explod', 'explos', 'slay', 'slain', 'massac', 'terror', 'army', 'tank',
  'nuke', 'knife', 'sword', 'blade', 'axe', 'bullet', 'grenad', 'missil', 'rocket', 'attack', 'hate', 'hurt', 'pain', 'wound', 'corpse', 'tomb', 'grave',
  // A name only the creator wears (CREATOR_RESERVED_NAMES; the owner, 25 Nov 2026: "I will be
  // the only Aubrey"): no bot or generated player name may come near it.
  'aubr',
]

/** True when a generated or typed name contains a blocked word. */
export function isBlockedName(name: string): boolean {
  const flat = name.toLowerCase().replace(/[^a-z]/g, '')
  return BLOCKED.some(word => flat.includes(word))
}

/**
 * Stable across clients and runtimes. Names are labels, never unique identifiers.
 * A bot is shown by its given name alone ("Temolin"; the owner, 16 November 2026: "Bots should
 * only ever have a single first name"). Its role ("Dust Clerk") is hidden character data, from
 * botIdentity, for the voice it speaks in.
 */
export function generateName(seed: number | string, kind: NameKind): string {
  return kind === 'bot' ? botIdentity(seed).name : fullName(seed, kind)
}

/**
 * A bot's given name and its hidden role, generated exactly as the full names were before
 * ("Temolin" and "Dust Clerk" from what was "Temolin Dust Clerk"), so a bot keeps its voice.
 */
export function botIdentity(seed: number | string): { name: string; role: string } {
  const full = fullName(seed, 'bot'), space = full.indexOf(' ')
  return { name: full.slice(0, space), role: full.slice(space + 1) }
}

/**
 * A bot's display name, different from every name in `taken` (lower case): its own given name,
 * or else deterministic rerolls from the same seed, so every client that knows the same room
 * picks the same one.
 */
export function uniqueBotName(seed: number | string, taken: ReadonlySet<string>): string {
  let name = botIdentity(seed).name
  for (let k = 1; taken.has(name.toLowerCase()) && k < 64; k++) name = fullName(`${seed}~${k}`, 'player')
  return name
}

function fullName(seed: number | string, kind: NameKind): string {
  const text = `${kind}:${seed}`
  let state = 2166136261
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619) >>> 0
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return (n ^ n >>> 14) >>> 0 }
  const pick = <T>(items: readonly T[]): T => items[next() % items.length]
  // Rerolls continue the same random stream, so the result depends only on the seed.
  for (let attempt = 0; attempt < 64; attempt++) {
    const given = givenName(next, pick)
    if (given.length < 3 || given.length > MAX_GIVEN_NAME || isBlockedName(given)) continue
    const name = kind === 'bot' ? `${given} ${role(next, pick)}` : kind === 'world' ? `${given} ${pick(worldPlaces)}` : given
    if (name.length > MAX_NAME || isBlockedName(name)) continue
    return name
  }
  return kind === 'bot' ? 'Zibwick Spare Pilot' : kind === 'world' ? 'Zibwick Basin' : 'Zibwick'
}

type Pick = <T>(items: readonly T[]) => T

function givenName(next: () => number, pick: Pick): string {
  const shape = next() % 100
  let name: string
  if (shape < 30) {
    // Head and tail: "Fenwick", "Quilara", "Zuzopolis".
    name = pick(heads) + pick(tails)
  } else if (shape < 45) {
    // Head, a linking vowel and a tail: "Molibert", "Zibawick".
    const tail = pick(tails)
    name = pick(heads) + pick(vowels) + (/^[aeiou]/.test(tail) ? pick(innerOnsets) : '') + tail
  } else if (shape < 88) {
    // Two or three spoken syllables, the last with a coda: "Tobelin", "Shu", "Ravoska".
    const count = next() % 10 < 7 ? 2 : next() % 3 === 0 ? 1 : 3
    name = ''
    name = pick(firstOnsets) + (count === 1 ? pick(lastVowels) : pick(vowels))
    for (let i = 1; i < count; i++) name += pick(innerOnsets) + (i === count - 1 ? pick(lastVowels) : pick(vowels))
    name += pick(codas)
  } else {
    // A head with a soft vowel ending, sometimes doubled: "Pippo", "Bimbim".
    const head = pick(heads)
    name = head.length <= 3 && next() % 4 === 0 ? head + head.toLowerCase() : head + pick(softEnds)
  }
  // Three identical letters in a row are unreadable ("Shooo"); squeeze them to two. A name
  // made only of vowels after its first letter ("Aeo") has nothing to hold on to.
  name = name.replace(/(.)\1\1+/g, '$1$1')
  if (!/[^aeiou]/.test(name.slice(1))) name += 'n'
  return name[0].toUpperCase() + name.slice(1)
}

function role(next: () => number, pick: Pick): string {
  const shape = next() % 100
  if (shape < 70) return `${pick(roleThings)} ${pick(roleJobs)}`
  if (shape < 92) return `${pick(roleTitles)} ${pick(roleJobs)}`
  return pick(roleSpecials)
}

/** A fresh random given name for a person, and the seed that made it. */
export function rollPlayerName(): { name: string; seed: string } {
  const seed = String(crypto.getRandomValues(new Uint32Array(1))[0])
  return { name: generateName(seed, 'player'), seed }
}
