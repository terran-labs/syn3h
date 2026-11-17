/**
 * Planet names. A world's name is its own setting (`world.nameSeed`, shared/params.ts), not
 * its terrain seed: a new seed reshapes the world and keeps its name, and players will one
 * day name their own worlds. Until names can be typed, the setting is the seed of a name
 * built here from parts, the same on every client.
 *
 * The parts are made to sound like places among the stars, not like people: soft openings,
 * a vowel-led middle and endings such as -ara, -eth or -une, with now and then a numeral or
 * a word after it ("Velmora", "Ostrathe IV", "Caldune Reach"). People's and bots' names come
 * from src/ui/data/names.ts, in a different style. A short list keeps out real places and
 * brands the parts could spell by chance.
 *
 * No renderer imports: the lobby, the server and tests all use this file.
 */

const OPEN = [
  'Al', 'Am', 'Ar', 'As', 'Bel', 'Bry', 'Cal', 'Cae', 'Cor', 'Dra', 'Del', 'El', 'Es', 'Fen', 'Gal', 'Hal', 'Ith', 'Ka',
  'Kel', 'Lir', 'Lun', 'Mae', 'Mir', 'Mor', 'Nym', 'Nor', 'Ost', 'Or', 'Pel', 'Pyr', 'Qua', 'Rhe', 'Ros', 'Sel', 'Syl', 'Tal',
  'Ther', 'Tor', 'Ul', 'Val', 'Vel', 'Ves', 'Wyn', 'Xan', 'Yl', 'Zan', 'Zeph', 'Ery',
]
const MIDDLE = ['', '', '', 'a', 'e', 'i', 'o', 'ra', 're', 'ri', 'la', 'le', 'li', 'na', 'ne', 'mo', 've', 'ta', 'tha', 'sa']
const CLOSE = [
  'ra', 'ris', 'rion', 'mora', 'mir', 'dune', 'thea', 'the', 'nis', 'lune', 'vane', 'sia', 'dor', 'drel', 'neth', 'ion',
  'ara', 'eth', 'aris', 'ith', 'os', 'ys', 'ova', 'ena', 'ix', 'ar', 'el', 'is', 'ane', 'orra', 'valle', 'quis', 'rith',
  'tara', 'mund', 'phae', 'cyne', 'wen', 'brae', 'holm',
]
/** After the name, sometimes: a numeral, or a word for a place. */
const AFTER = [
  '', '', '', '', '', '', '', '', '', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' IX', ' Prime', ' Minor', ' Major',
  ' Reach', ' Deep', ' Rise', ' Vale',
]
/**
 * Whole names the parts can spell that are real places, brands, people or plain words: the
 * hand list, plus every core a sweep of 300,000 name seeds found in a dictionary.
 */
const BLOCKED = new Set([
  'alar', 'alaska', 'alethea', 'alix', 'allerion', 'alois', 'altar', 'althea', 'amar', 'amara', 'amnesia', 'amos',
  'amra', 'arar', 'arara', 'ararat', 'ardor', 'arear', 'arena', 'ariel', 'arion', 'aroar', 'arrear', 'arris',
  'artar', 'aruba', 'arvel', 'assarion', 'astana', 'astasia', 'avalon', 'bali', 'belar', 'belion', 'belis', 'bellis',
  'beltane', 'caesar', 'calais', 'calathea', 'calix', 'caloris', 'caracas', 'cornel', 'corridor', 'delos', 'elis',
  'eris', 'erythea', 'fennel', 'galena', 'galera', 'halesia', 'hallel', 'ithiel', 'kalis', 'kanara', 'karel',
  'katar', 'katara', 'kellion', 'lima', 'lunar', 'lunel', 'malta', 'mars', 'mira', 'mirador', 'morel', 'morion',
  'morris', 'mortar', 'nike', 'nymphae', 'oman', 'orarion', 'oriel', 'orion', 'ornis', 'orris', 'oslo', 'ostara',
  'ostia', 'pellar', 'pyrena', 'pyrrhos', 'quar', 'rosel', 'seldor', 'selena', 'selion', 'sellar', 'sirius',
  'syllis', 'talar', 'talion', 'talis', 'talliar', 'tallis', 'tallith', 'tara', 'thera', 'thermos', 'theromora',
  'tortuga', 'ulnar', 'valencia', 'valera', 'vallar', 'vallis', 'valois', 'velar', 'venus', 'xanax', 'xanthane',
  'zara',])

function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * A generated planet name for a name seed. Deterministic, pronounceable, from about
 * 48 x 20 x 40 x 24 combinations. Never empty, never a blocked word on its own.
 */
export function generatedWorldName(nameSeed: number): string {
  for (let attempt = 0; ; attempt++) {
    const a = mix32((nameSeed | 0) + attempt * 0x51ed27), b = mix32(a ^ 0x2545f491), c = mix32(b), d = mix32(c)
    let core = OPEN[a % OPEN.length] + MIDDLE[b % MIDDLE.length] + CLOSE[c % CLOSE.length]
    // Two of the same vowel or the same consonant across a join read as a typo: fold them.
    core = core.replace(/([aeiouy])\1/g, '$1').replace(/([^aeiouy])\1\1/g, '$1$1')
    const name = core[0].toUpperCase() + core.slice(1).toLowerCase()
    if (BLOCKED.has(name.toLowerCase()) && attempt < 8) continue
    return name + AFTER[d % AFTER.length]
  }
}

// Older names: what `planetName(seed)` gave before names had their own setting. Kept
// exactly, so worlds saved and links shared before then keep their names.
const STARTS = ['Tho', 'Xy', 'Lu', 'Am', 'Ymi', 'Va', 'Mira', 'Ke', 'Ory', 'Sa', 'Zeph', 'Ika', 'No', 'Bry', 'Eli', 'Quo', 'Ash', 'Ve', 'Dra', 'Ula', 'Ha', 'Pyr', 'Cae', 'Io']
const MIDDLES = ['', '', 'la', 'ri', 'no', 've', 'da', 'mi', 'ko', 'the', 'ra', 'li']
const ENDS = ['lus', 'lia', 'cidar', 'mir', 'r', 'lerius', 'dor', 'x', 'th', 'ron', 'ra', 'nis', 'gard', 'phon', 'rix', 'ne', 'tis', 'von', 'mos', 'lune']

/** The name a terrain seed gave before names had their own setting: "Xylia", "Tholus IV". */
export function seedName(seed: number): string {
  const a = mix32(seed | 0)
  const b = mix32(a)
  const c = mix32(b)
  let name = STARTS[a % STARTS.length] + MIDDLES[b % MIDDLES.length] + ENDS[c % ENDS.length]
  name = name[0].toUpperCase() + name.slice(1).toLowerCase()
  const numeral = ['', '', '', ' II', ' III', ' IV', ' V', ' VII', ' IX'][(c >>> 8) % 9]
  return name + numeral
}

/** A world's name from its two settings: see `world.nameSeed`. */
export function worldName(nameSeed: number, seed: number): string {
  if (nameSeed > 0) return generatedWorldName(nameSeed)
  if (nameSeed < 0) return seedName(-nameSeed)
  return seedName(seed)
}

/** A fresh name seed, for a newly rolled world. Not used for generation, so Math.random is fine. */
export function randomNameSeed(): number {
  return 1 + Math.floor(Math.random() * 999999998)
}

/**
 * The name setting to keep when a world's terrain seed changes from `seed`: a name already
 * of its own stays; one still read from the old seed is pinned to it, so it does not change.
 */
export function nameSeedKeptAcross(nameSeed: number, seed: number): number {
  return nameSeed === 0 ? -seed : nameSeed
}
