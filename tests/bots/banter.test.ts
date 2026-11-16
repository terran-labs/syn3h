/**
 * The banter director's invariants, on a fake world and clock: it never talks over itself,
 * never repeats, respects the chatter setting, says only lines that pass the filter, and
 * requests from players end on their own and respect the room's settings.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BanterDirector, type BanterBot, type BanterPlayer, type Directive } from '../../src/bots/banter/Director'
import { POOLS, POOL_FILES } from '../../src/bots/banter/data'
import { FRAGMENTS } from '../../src/bots/banter/data/fragments'
import { expand, type Context } from '../../src/bots/banter/grammar'
import { VOICE_IDS } from '../../src/bots/banter/voices'
import { botChatter, botChatterLevel, filterChat, MAX_CHAT_LENGTH } from '../../shared/chat'
import { params } from '../../shared/params'
import { seededRandom } from '../../src/bots/random'

/** Words the bots must never say, as whole words: the game has no violence in its wording. */
const NEVER = /\b(kill\w*|die|dies|died|dying|dead|death|weapons?|guns?|shoot\w*|blood\w*|hurt\w*|hate\w*|stupid|idiots?|sex\w*|drunk|drugs?|suicide|murder\w*)\b/i

const NAMES = ['Temolin Dust Clerk', 'Detodak Rust Auditor', 'Fanirek Cone Marshal', 'Lomavin Hull Intern', 'Begonek Spare Pilot', 'Zemitor Junior Moon', 'Kanavon Snack Probe', 'Rolinix Bolt Inspector']

function fakeWorld(count = 4) {
  let now = 0
  const bots: BanterBot[] = NAMES.slice(0, count).map((name, i) => ({
    id: 0xff00 + i, name, x: i * 50, y: 10, z: 0, speed: 5, activity: 'road', caption: 'cruising the road',
    stuckFor: 0, flippedFor: 0, bogFor: 0, airFor: 0, resets: 0, nearLava: false, sight: null,
  }))
  const players: BanterPlayer[] = [{ id: 1, name: 'Sam', x: 0, y: 10, z: 10, speed: 6, airFor: 0, idleFor: 0, kind: 'buggy', flippedFor: 0, stuckFor: 0 }]
  const said: { t: number; bot: number; text: string }[] = []
  const directed: { bot: number; d: Directive | null }[] = []
  const allow = { follow: true, drive: true }
  const world = {
    now: () => now, bots: () => bots, players: () => players, hour: () => 12, planet: () => 'volcanic',
    sea: () => 'lava' as const, cloudy: () => false, feature: () => ({ kind: 'vent', phrase: 'the lava vent' }),
  }
  const hooks = {
    say: (bot: number, text: string) => said.push({ t: now, bot, text }),
    direct: (bot: number, d: Directive | null) => { directed.push({ bot, d }); return true },
    allows: (what: 'follow' | 'drive') => allow[what],
  }
  const director = new BanterDirector(world, hooks, { seed: 'test' })
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { now += 1; director.tick() } }
  return { director, bots, players, said, directed, allow, run, get now() { return now } }
}

afterEach(() => {
  params.set(botChatter.def.id, true)
  params.set(botChatterLevel.def.id, 1)
})

describe('bot banter', () => {
  it('never talks over itself: one line at a time, spaced for reading', () => {
    const w = fakeWorld()
    w.run(1800)
    expect(w.said.length).toBeGreaterThan(20)
    for (let i = 1; i < w.said.length; i++) expect(w.said[i].t - w.said[i - 1].t).toBeGreaterThanOrEqual(1)
  })

  it('never repeats a line until its pool is used up', () => {
    const gap = (said: { text: string }[]) => {
      const seen = new Map<string, number>()
      let closest = Infinity
      said.forEach((s, i) => { const j = seen.get(s.text); if (j !== undefined) { closest = Math.min(closest, i - j) } seen.set(s.text, i) })
      return closest
    }
    // Half an hour at normal with four bots: not one repeat.
    const w = fakeWorld(4)
    w.run(1800)
    expect(w.said.length).toBeGreaterThan(60)
    expect(gap(w.said)).toBe(Infinity)
    // Three chatty hours with six bots: a line comes back only after a long gap.
    params.set(botChatterLevel.def.id, 2)
    const long = fakeWorld(6)
    long.run(3 * 3600)
    const closest = gap(long.said)
    console.log(`three chatty hours: ${long.said.length} lines, nearest repeat ${closest} lines apart`)
    expect(closest).toBeGreaterThan(40)
  })

  it('talks at the rate the setting asks: quiet < normal < chatty, normal about every 20 to 40 s', () => {
    const rate = (level: number) => {
      params.set(botChatterLevel.def.id, level)
      const w = fakeWorld(4)
      w.run(3600)
      // Conversations started, not lines: an exchange is several lines.
      let starts = 0
      for (let i = 0; i < w.said.length; i++) if (i === 0 || w.said[i].t - w.said[i - 1].t > 8) starts++
      return { starts, lines: w.said.length }
    }
    const quiet = rate(0), normal = rate(1), chatty = rate(2)
    console.log(`per hour, four bots, nothing happening: quiet ${quiet.starts} (${quiet.lines} lines), normal ${normal.starts} (${normal.lines}), chatty ${chatty.starts} (${chatty.lines})`)
    expect(quiet.lines).toBeLessThan(normal.lines)
    expect(normal.lines).toBeLessThan(chatty.lines)
    expect(quiet.starts).toBeLessThan(normal.starts)
    // Normal: one conversation every 20 to 40 s is 90 to 180 an hour; leave room for exchanges.
    expect(normal.starts).toBeGreaterThanOrEqual(70)
    expect(normal.starts).toBeLessThanOrEqual(190)
  })

  it('says nothing at all with bot chatter off, and still acts on requests', () => {
    params.set(botChatter.def.id, false)
    const w = fakeWorld()
    w.run(600)
    w.director.hear(1, 'everyone follow me')
    w.run(30)
    expect(w.said).toEqual([])
    expect(w.directed.some((d) => d.d?.kind === 'follow')).toBe(true)
  })

  it('keeps quiet while people are chatting', () => {
    const w = fakeWorld()
    w.run(60)
    const before = w.said.length
    for (let i = 0; i < 12; i++) { w.director.hear(1, `just chatting about my day part ${i}`); w.run(10) }
    expect(w.said.length - before).toBeLessThanOrEqual(1)
  })

  it('a follow request ends on its own, one bot leaving at a time', () => {
    const w = fakeWorld(4)
    w.director.hear(1, 'everyone follow me')
    w.run(5)
    expect(w.director.requests().length).toBeGreaterThan(0)
    // Even with the player doing exciting things the whole time, boredom wins in bounded time.
    w.players[0].speed = 30
    let t = 0
    while (w.director.requests().length && t < 600) { w.run(1); t++ }
    expect(w.director.requests()).toEqual([])
    expect(t).toBeLessThan(600)
    const leaves = w.directed.filter((d) => d.d === null).map((d) => d.bot)
    expect(new Set(leaves).size).toBe(leaves.length)
  })

  it('requests respect the host\'s settings and each player\'s rate limit', () => {
    const w = fakeWorld(4)
    w.allow.follow = false
    w.director.hear(1, 'everyone follow me')
    w.run(20)
    expect(w.directed.some((d) => d.d?.kind === 'follow')).toBe(false)
    w.allow.follow = true
    // A flood of requests: only the first few act.
    for (let i = 0; i < 20; i++) w.director.hear(1, i % 2 ? 'everyone stop' : 'everyone follow me')
    w.run(20)
    const acted = w.directed.filter((d) => d.d !== null).length
    expect(acted).toBeLessThanOrEqual(4 * 3)
  })

  it('every template, for every voice, expands to a line that passes the filter and the limits', () => {
    const r = seededRandom(7)
    const ctx: Context = { me: 'Temolin', you: 'Detodak', subj: 'Fanirek', player: 'Sam', critter: 'very small moose', feature: 'the lava vent', activity: 'cruising the road', count: 'third', sea: 'lava', planet: 'volcanic', kind: 'jet' }
    let checked = 0
    const bad: string[] = []
    for (const [key, pool] of Object.entries(POOLS)) {
      for (const voice of ['any', ...VOICE_IDS] as const) {
        for (const template of pool[voice] ?? []) {
          for (let i = 0; i < 6; i++) {
            const line = expand(template, ctx, r)
            checked++
            if (line.length > MAX_CHAT_LENGTH || filterChat(line) !== line || NEVER.test(line) || /[{}[\]]/.test(line) || !line.trim()) bad.push(`${key}/${voice}: ${line}`)
          }
        }
      }
    }
    for (const [key, list] of Object.entries(FRAGMENTS)) for (const f of list) if (NEVER.test(f)) bad.push(`fragment ${key}: ${f}`)
    expect(checked).toBeGreaterThan(5000)
    expect(bad).toEqual([])
  })

  it('every key the director uses exists, and no data file shadows another', () => {
    const keys = Object.values(POOL_FILES).flatMap((p) => Object.keys(p))
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ['idle.musing', 'propose.tag', 'reply.busy', 'retort.busy', 'sight.critter', 'doubt.critter', 'mishap.stuck', 'req.accept.follow', 'bored.leave', 'stuck.call', 'rescue.start']) {
      expect(POOLS[key], key).toBeDefined()
    }
  })
})
