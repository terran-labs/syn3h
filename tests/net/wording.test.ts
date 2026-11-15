/**
 * The owner's rule: nothing in these worlds dies or is destroyed, and there are no weapons.
 * Lava is sticky, vehicles are returned to their pad, and the beams are tag beams. This test
 * reads every piece of text the multiplayer and mode code can put in front of a player and
 * fails on a word that says otherwise.
 *
 * Covered: the HUD status lines, event lines, name tag notes and server error messages (read
 * from the source, since they are assembled inside the client), and the label and group of
 * every Tag, King of the Hill, tag beam and network slider. Identifiers, parameter ids, file
 * names and protocol message names are not player-visible and keep their older words.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import '../../src/modes/params'
import '../../src/net/params'
import '../../src/weapons/params'

const BANNED = /\b(fire[ds]?|firing|shoot(s|ing)?|shots?|lasers?|weapons?|hits?|kill(s|ed|ing)?|eliminat(e|ed|ion)|die[ds]?|dying|death|destroy(s|ed)?|dead|out)\b/i

/** Lines of source that put text in front of a player. */
const VISIBLE = /this\.event\(|lines\.push\(|\blines = \[|return \['mode|\bnote:|\bmessage:/

/**
 * Text a player can read in one source file: the string and template literals on the lines
 * VISIBLE matches, and in the `flags` list of the player table. Interpolations are dropped,
 * so only the words written in the source remain.
 */
function playerText(file: string): string[] {
  const found: string[] = []
  let inFlags = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/const flags = \[/.test(line)) inFlags = true
    if (inFlags || VISIBLE.test(line)) {
      // Drop interpolations, and `case 'name':` labels, which are protocol names, not text.
      const code = line.replace(/\$\{[^}]*\}/g, ' ').replace(/\bcase '[^']*':/g, ' ')
      for (const m of code.matchAll(/'((?:[^'\\]|\\.)*)'|`([^`]*)`/g)) found.push(m[1] ?? m[2])
    }
    if (inFlags && /\]\.filter/.test(line)) inFlags = false
  }
  return found.filter((t) => t.trim().length > 0)
}

describe('player-visible wording', () => {
  it('finds the text it is meant to scan', () => {
    const text = playerText('src/net/index.ts')
    expect(text).toContain('You are stuck in the lava')
    expect(text).toContain('mode: Tag   ram or beam whoever is it')
    expect(text.some((s) => s.includes('dunked'))).toBe(true)
    expect(playerText('server/room.ts')).toContain('room is full')
  })

  it('has no words of harm or weapons in status lines, events, notes or server messages', () => {
    const bad = ['src/net/index.ts', 'src/net/NameTags.ts', 'server/room.ts']
      .flatMap((file) => playerText(file).map((s) => ({ file, text: s })))
      .filter((s) => BANNED.test(s.text))
    expect(bad).toEqual([])
  })

  it('has none in the labels or groups of the multiplayer, mode and tag beam sliders', () => {
    const mine = params.all().filter((p) => /^(tag|koth|game|laser|net)\./.test(p.def.id))
    expect(mine.length).toBeGreaterThanOrEqual(15)
    const bad = mine
      .map((p) => ({ id: p.def.id, label: p.def.label, group: p.def.group }))
      .filter((p) => BANNED.test(p.label) || BANNED.test(p.group))
    expect(bad).toEqual([])
  })
})
