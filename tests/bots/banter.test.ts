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
import { ROLE_WORDS, VOICE_IDS, VOICES } from '../../src/bots/banter/voices'
import { generateName } from '../../src/ui/data/names'
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
    // Normal, nothing happening: a remark or exchange every 28 to 50 s, so about 70 to 130 an hour.
    expect(normal.starts).toBeGreaterThanOrEqual(55)
    expect(normal.starts).toBeLessThanOrEqual(150)
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

  it('a second player pulls a bot away only by naming it', () => {
    const w = fakeWorld(4)
    w.players.push({ id: 2, name: 'Ana', x: 200, y: 10, z: 0, speed: 6, airFor: 0, idleFor: 0, kind: 'jet', flippedFor: 0, stuckFor: 0 })
    w.run(2)
    w.director.hear(1, 'everyone follow me')
    w.run(20)
    const withSam = w.director.requests().filter((r) => r.player === 1).map((r) => r.bot)
    expect(withSam.length).toBeGreaterThan(0)
    w.director.hear(2, 'everyone follow me')
    w.run(20)
    // Asked as a group, nobody already with Sam leaves him.
    for (const r of w.director.requests()) if (withSam.includes(r.bot)) expect(r.player).toBe(1)
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
    const ctx: Context = { me: 'Temolin', role: 'Glacier Courier', you: 'Detodak', subj: 'Fanirek', player: 'Sam', critter: 'very small moose', feature: 'the lava vent', activity: 'cruising the road', count: 'third', sea: 'lava', planet: 'volcanic', kind: 'jet' }
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

  it('nearly every generated bot name gets its voice from its role, not by chance', () => {
    let byRole = 0
    for (let i = 0; i < 2000; i++) {
      const name = generateName(`seed${i}`, 'bot')
      if (name.split(' ').slice(1).some((w) => ROLE_WORDS.has(w.toLowerCase())) || VOICE_IDS.some((v) => name.endsWith(VOICES[v].job))) byRole++
    }
    expect(byRole / 2000).toBeGreaterThan(0.9)
  })

  it('every key the director uses exists, and no data file shadows another', () => {
    const keys = Object.values(POOL_FILES).flatMap((p) => Object.keys(p))
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ['idle.musing', 'propose.tag', 'reply.busy', 'retort.busy', 'sight.critter', 'doubt.critter', 'mishap.stuck', 'req.accept.follow', 'bored.leave', 'stuck.call', 'rescue.start']) {
      expect(POOLS[key], key).toBeDefined()
    }
  })

  it('rescue lines name only the bots and people in that rescue, by the names on their labels', () => {
    // The bug: "Hold on, Toratek" read as addressed to the stuck bot. Every name in a rescue line
    // must be a label in the room, and one of the parties to that event.
    const w = fakeWorld(4)
    w.players.push({ id: 2, name: 'Toratek', x: 0, y: 10, z: 20, speed: 0, airFor: 0, idleFor: 0, kind: 'buggy', flippedFor: 0, stuckFor: 0 })
    params.set(botChatterLevel.def.id, 2)
    w.run(10)
    const label = (id: number) => w.bots.find((b) => b.id === id)!.name.split(' ')[0]
    const names = [...w.bots.map((b) => b.id).map(label), 'Sam', 'Toratek']
    // A line is rescue speech when it fits a template from a rescue pool.
    const templates = Object.entries(POOLS).filter(([k]) => /^(stuck|rescue|conflict)\./.test(k)).flatMap(([, pool]) => Object.values(pool).flat() as string[])
    const pattern = (t: string) => new RegExp('^' + t.replace(/[.*+?^$()|\\]/g, '\\$&').replace(/\\\[|\[[^\]]*\]/g, '.+?').replace(/\{[^}]*\}/g, '.+?') + '$')
    const patterns = templates.map(pattern)
    const rescueLine = (text: string) => patterns.some((p) => p.test(text))
    const [stuck, a, b] = [0xff00, 0xff01, 0xff02]
    const events: { e: Parameters<typeof w.director.rescue>[0]; parties: string[] }[] = [
      { e: { kind: 'stuck', stuck, clumsy: true, count: 1 }, parties: [label(stuck)] },
      { e: { kind: 'conflict', bot: a, stuck, player: 1, going: true }, parties: [label(a), label(stuck), 'Sam'] },
      { e: { kind: 'conflict', bot: b, stuck, player: 2, going: false }, parties: [label(b), label(stuck), label(a), 'Toratek'] },
      { e: { kind: 'start', bot: a, stuck }, parties: [label(a), label(stuck)] },
      { e: { kind: 'retry', bot: a, stuck }, parties: [label(a), label(stuck)] },
      { e: { kind: 'join', bot: b, stuck, others: [a] }, parties: [label(a), label(b), label(stuck)] },
      { e: { kind: 'waiting', stuck, minutes: 2 }, parties: [label(stuck)] },
      { e: { kind: 'swap', bot: a, stuck }, parties: [label(a), label(stuck)] },
      { e: { kind: 'player.ask', player: 1, stuck }, parties: [label(stuck), 'Sam'] },
      { e: { kind: 'player.hooked', player: 1, stuck }, parties: [label(stuck), 'Sam'] },
      { e: { kind: 'handoff', bot: b, stuck }, parties: [label(b), label(stuck)] },
      { e: { kind: 'freed', stuck, by: [a], players: [1], count: 2 }, parties: [label(stuck), label(a), 'Sam'] },
      { e: { kind: 'calloff', bot: a, stuck }, parties: [label(a), label(stuck)] },
      { e: { kind: 'giveup', stuck }, parties: [label(stuck)] },
    ]
    let checked = 0
    for (let round = 0; round < 6; round++) {
      for (const { e, parties } of events) {
        const before = w.said.length
        w.director.rescue(e)
        w.run(25)
        for (const line of w.said.slice(before)) {
          // Ordinary chatter in the gap may name anyone; only rescue speech is checked.
          if (!rescueLine(line.text)) continue
          checked++
          for (const n of names) if (new RegExp(`\\b${n}\\b`).test(line.text)) expect(parties, `${e.kind}: ${line.text}`).toContain(n)
        }
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('a bot claims an earlier tow only when it really towed someone this session', () => {
    const w = fakeWorld(4)
    params.set(botChatterLevel.def.id, 2)
    w.run(10)
    const claims = /\b(I went last time|I did the last one|I did the last rescue|the last rescue)\b/
    const [stuck, a, b] = [0xff00, 0xff01, 0xff02]
    for (let i = 0; i < 40; i++) {
      w.director.rescue({ kind: 'conflict', bot: a, stuck, player: 1, going: false })
      w.director.rescue({ kind: 'conflict', bot: b, stuck, player: 1, going: false })
      w.run(30)
    }
    expect(w.said.some((l) => claims.test(l.text))).toBe(false)
    // Once b has really towed someone out, it may say so.
    w.director.rescue({ kind: 'freed', stuck, by: [b], players: [], count: 1 })
    let claimed = false
    for (let i = 0; i < 60 && !claimed; i++) {
      w.director.rescue({ kind: 'conflict', bot: a, stuck, player: 1, going: false })
      w.director.rescue({ kind: 'conflict', bot: b, stuck, player: 1, going: false })
      w.run(30)
      claimed = w.said.some((l) => l.bot === b && claims.test(l.text))
    }
    expect(w.said.filter((l) => l.bot !== b && claims.test(l.text))).toEqual([])
  })
})
