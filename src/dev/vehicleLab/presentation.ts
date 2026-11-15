/**
 * How the lab names and orders its exhibits, in one place.
 *
 * Exhibits are written by several vehicle lanes, each in its own file, and their titles
 * drifted: "Next Syn3h buggy", "Syn3h hovercraft", "Syn3h next-gen tank". The owner's rules
 * of 15 November 2026 are applied here, after collection, so a lane's file needs no edit and
 * a new round cannot drift again:
 *
 *  - design studies are "Future buggies", "Future hovercrafts", "Future jets", "Future tanks";
 *  - the game's buggy is simply "Buggy", and the retired Mars Explorer buggy is not shown;
 *  - the side by side comparison of the game's vehicles is one line, "Compare all vehicles",
 *    at the top, directly above the Buggy.
 */
import type { LabExhibit } from './types'

/** The section the game's own vehicles are listed under. */
export const IN_GAME = 'In the game'
/** The section for designs that are not in the game yet. */
export const FUTURE = 'Future vehicles'
/** Exhibit ids that are never listed. */
const HIDDEN = new Set(['game-buggy-classic'])
/** The comparison of the game's vehicles (exhibits/lineup.ts, when a lane provides it). */
export const COMPARE_ALL = 'lineup'
/** Exhibits shown as a single line that opens the whole set side by side, not as a list of designs. */
export const compareOnly: ReadonlySet<string> = new Set([COMPARE_ALL])

const PLURAL: Record<string, string> = { buggy: 'buggies', hovercraft: 'hovercrafts', hover: 'hovercrafts', jet: 'jets', tank: 'tanks' }
/** 'buggy' gives 'Future buggies'; an unknown family just gains an s. */
export function futureTitle(family: string): string {
  const word = family.split('-')[0]
  return `Future ${PLURAL[word] ?? `${word}s`}`
}

const isStudy = (e: LabExhibit) => !e.id.startsWith('game-') && e.id !== COMPARE_ALL && (e.section === 'Design studies' || e.section === FUTURE || e.section === undefined)

/**
 * Applies the naming and ordering rules to the collected exhibits. Titles and sections are
 * set on the exhibit objects themselves, because other exhibits read them (the comparison
 * lists each game vehicle by its title).
 */
export function present(exhibits: LabExhibit[]): LabExhibit[] {
  const shown = exhibits.filter(e => !HIDDEN.has(e.id))
  const titles = new Map<string, number>()
  for (const e of shown) {
    if (e.id === 'game-buggy') e.title = 'Buggy'
    else if (e.id === COMPARE_ALL) { e.title = 'Compare all vehicles'; e.section = IN_GAME }
    // Read by the sidebar (lab.ts renderTree) to draw the exhibit as one line.
    if (compareOnly.has(e.id)) (e as LabExhibit & { compareOnly?: boolean }).compareOnly = true
    else if (isStudy(e)) {
      // The family names the vehicle ('tank'); an exhibit without one is named by its id ('tank-archive').
      const title = futureTitle(e.family ?? e.id)
      const seen = titles.get(title) ?? 0
      titles.set(title, seen + 1)
      // A second exhibit for the same vehicle holds its older rounds.
      e.title = seen ? `${title}: earlier rounds` : title
      e.section = FUTURE
    }
  }
  // The game's vehicles first, with the comparison directly above the Buggy; then the studies.
  // Within each part the registered order is kept.
  const rank = (e: LabExhibit) => (e.section === IN_GAME ? (e.id === COMPARE_ALL ? 0 : 1) : 2)
  return shown.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(x => x.e)
}
