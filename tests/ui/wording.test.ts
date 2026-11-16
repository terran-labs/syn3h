/**
 * Nothing a player can read may speak of death, violence or weapons. The owner's rule:
 * these worlds have no death; lava is sticky and makes things glow; the vehicles are
 * indestructible; the beam game is "tag beams" and its verb is "tag".
 *
 * This scans the UX lane's player-visible text: every human-readable string and every
 * HTML text node and label attribute in src/ui and src/audio, the generated names, the
 * loading messages, index.html and the web manifest, and every slider label and group in
 * every lane (they all show in the Advanced panel). Internal identifiers, file names,
 * parameter ids and protocol markers are not text a player reads and are left alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadingMessages, phaseMessages, stillWorkingMessages } from '../../src/ui/data/loadingMessages'
import { generateName } from '../../src/ui/data/names'

/** Whole words, so "screenshot" and "without" pass. */
const WORDS = /\b(fire|fires|fired|firing|shot|shots|hit|hits|dead|died|dies|die|death|deaths|deadly|gun|guns|knocked out)\b/i
/** Anywhere in a word, so "LaserShot" and "killer" fail too. */
const STEMS = /laser|weapon|shoot|kill|eliminat|destroy|destruct|explod|explos/i
const banned = (text: string) => WORDS.exec(text)?.[0] ?? STEMS.exec(text)?.[0] ?? null
/**
 * Names the owner retired on 15 November 2026. The gear is Plasma Tag, Plasma Thunder,
 * Chaser, Grapple and Yoink; the buggy is just "Buggy". Ids, parameter ids and saved keys
 * keep their old spellings and are not text a player reads.
 */
const RETIRED = /Syn3h Buggy|\bClassic\b|\btag beams?\b|\bBig Red\b|\bPesters?\b|\bBungee\b/i
/** The inspector still lists the gear lane's old parameter group until that lane renames it. */
const RETIRED_ALLOWED = new Set(['Tag beams'])
const retired = (text: string) => RETIRED_ALLOWED.has(text) ? null : RETIRED.exec(text)?.[0] ?? null

const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) ? [path] : []
})
/** Strings a person would read: literals with a space in them, HTML text and label attributes. */
function visibleText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? ''
    for (const node of literal.matchAll(/>([^<>]+)</g)) found.push(node[1])
    for (const attribute of literal.matchAll(/(?:aria-label|placeholder|title|alt)="([^"]+)"/g)) found.push(attribute[1])
    // Prose, not a path, selector, class list or identifier.
    if (/[A-Za-z]/.test(literal) && /\s/.test(literal.trim()) && !/^[.#/@]|^\w+:\/\/|[<>{}=;]|^[a-z-]+( [a-z-]+)*$/.test(literal.trim())) found.push(literal)
  }
  return found.map(text => text.replace(/\$\{[^}]*\}/g, ' ').trim()).filter(Boolean)
}

describe('player-visible wording', () => {
  for (const path of [...files('src/ui'), ...files('src/audio')]) {
    it(`${path} has no death, violence or weapon words`, () => {
      const hits = visibleText(readFileSync(path, 'utf8')).map(text => ({ text, word: banned(text) })).filter(hit => hit.word)
      expect(hits).toEqual([])
    })
    it(`${path} uses no retired gear or vehicle name`, () => {
      const hits = visibleText(readFileSync(path, 'utf8')).map(text => ({ text, word: retired(text) })).filter(hit => hit.word)
      expect(hits).toEqual([])
    })
  }
  it('every slider label and group in every lane is clean', () => {
    // Read from source, so this needs no renderer: any file that defines a parameter.
    const sources = [...files('src'), ...files('shared'), ...files('server')].map(path => ({ path, text: readFileSync(path, 'utf8') })).filter(file => file.text.includes('defineParam('))
    const hits: { path: string; text: string; word: string }[] = []
    for (const { path, text } of sources) for (const match of text.matchAll(/\b(?:label|group)\s*:\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)) {
      const label = match[1] ?? match[2] ?? match[3] ?? '', word = banned(label)
      if (word) hits.push({ path, text: label, word })
    }
    expect(sources.length).toBeGreaterThan(10)
    expect(hits).toEqual([])
  })
  it('index.html and the manifest are clean', () => {
    for (const path of ['index.html', 'public/brand/manifest.webmanifest']) {
      const text = readFileSync(path, 'utf8')
      const strings = [...text.matchAll(/content="([^"]*)"|<title>([^<]*)<|"(?:name|short_name|description)"\s*:\s*"([^"]*)"/g)].map(m => m[1] ?? m[2] ?? m[3])
      expect(strings.map(s => ({ s, word: banned(s) })).filter(hit => hit.word), path).toEqual([])
    }
  })
  it('loading messages are clean', () => {
    const all = [...loadingMessages, ...Object.values(phaseMessages).flat(), ...stillWorkingMessages]
    expect(all.map(text => ({ text, word: banned(text) })).filter(hit => hit.word)).toEqual([])
  })
  it('generated names are clean across many seeds', () => {
    const hits: string[] = []
    for (const kind of ['player', 'bot', 'world'] as const) for (let seed = 0; seed < 1500; seed++) {
      const name = generateName(`wording:${seed}`, kind)
      if (banned(name)) hits.push(name)
    }
    expect(hits).toEqual([])
  })
  it('the scanner itself catches the words', () => {
    expect(visibleText("const a = '<button>FIRE</button>'; const b = 'L or click: shoot the laser'").map(banned)).toEqual(['FIRE', 'shoot'])
    expect(visibleText("import x from './laserShot'; const id = 'laserHit'")).toEqual([])
    expect(banned('Take a screenshot without worry')).toBeNull()
  })
})
