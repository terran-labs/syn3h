/**
 * Banter samples, drawn at random, for tuning the lines by ear.
 *
 *   npx tsx tools/banter-sample.ts [seed] [minutes]
 *
 * Runs the real director (src/bots/banter) against a simulated session: four bots driving
 * about, getting stuck, flipping, going airborne and visiting sights now and then, a player
 * who jumps, sits still and types a few requests, and the hour turning. Prints forty single
 * lines picked at random from everything said, then six multi-line exchanges picked at
 * random, so what you read is the generator's average, not its best.
 */
import { BanterDirector, type BanterBot, type BanterPlayer, type Directive } from '../src/bots/banter/Director'
import { seededRandom, hashString } from '../src/bots/random'

const seed = process.argv[2] ?? String(Date.now())
const minutes = Number(process.argv[3] ?? 90)
const r = seededRandom(hashString(seed))
const NAMES = ['Temolin Dust Clerk', 'Detodak Rust Auditor', 'Fanirek Cone Marshal', 'Lomavin Hull Intern', 'Begonek Spare Pilot', 'Zemitor Junior Moon', 'Kanavon Snack Probe', 'Rolinix Bolt Inspector']
// Four of the eight, as a room would have.
const names = [...NAMES].sort(() => r() - 0.5).slice(0, 4)
let now = 0
const bots: BanterBot[] = names.map((name, i) => ({
  id: 0xff00 + i, name, x: i * 60, y: 10, z: 0, speed: 8, activity: 'road', caption: 'cruising the road',
  stuckFor: 0, flippedFor: 0, bogFor: 0, airFor: 0, resets: 0, nearLava: false, sight: null,
}))
const player: BanterPlayer = { id: 1, name: 'Sam', x: 10, y: 10, z: 10, speed: 8, airFor: 0, idleFor: 0, kind: 'buggy', flippedFor: 0, stuckFor: 0 }
const said: { t: number; name: string; text: string }[] = []
const CAPTIONS = ['cruising the road', 'exploring', 'heading for the summit', 'taking in the view', 'doing donuts', 'going to see the fire', 'heading for the shore', 'carving']
const SIGHTS = ['vent', 'peak', 'shore', 'road-end', 'summit']
const FEATURES = ['the lava vent', 'the summit', 'the lava shore', 'the end of the road', 'the peak']
const director = new BanterDirector({
  now: () => now, bots: () => bots, players: () => [player], hour: () => (14 + now / 300) % 24, planet: () => 'volcanic',
  sea: () => 'lava', cloudy: () => Math.floor(now / 900) % 2 === 1,
  feature: () => (r() < 0.7 ? { kind: 'vent', phrase: FEATURES[Math.floor(r() * FEATURES.length)] } : null),
}, {
  say: () => {}, direct: (_b: number, _d: Directive | null) => true, allows: () => true,
}, { seed, onLine: (_bot, name, text) => said.push({ t: now, name, text }) })

const REQUESTS = ['hey you guys follow me', 'what are you doing', 'who are you', 'check this out', 'shut up', 'talk to me', 'thanks', 'race me', 'chase me', 'temo, come here', 'hi bots', 'you guys suck']
for (let s = 0; s < minutes * 60; s++) {
  now = s
  for (const b of bots) {
    const roll = r()
    if (b.stuckFor > 0) b.stuckFor = b.stuckFor > 9 ? 0 : b.stuckFor + 1
    else if (roll < 0.0015) b.stuckFor = 1
    b.flippedFor = b.flippedFor > 0 ? (b.flippedFor > 5 ? 0 : b.flippedFor + 1) : roll > 0.9988 ? 1 : 0
    b.airFor = roll > 0.997 ? 1.5 : 0
    if (roll > 0.4 && roll < 0.402) b.resets++
    b.sight = roll > 0.5 && roll < 0.503 ? SIGHTS[Math.floor(r() * SIGHTS.length)] : b.sight && r() < 0.8 ? b.sight : null
    if (r() < 0.01) b.caption = CAPTIONS[Math.floor(r() * CAPTIONS.length)]
    b.x += (r() - 0.5) * 10; b.z += (r() - 0.5) * 10
  }
  player.airFor = r() < 0.004 ? 2 : 0
  player.idleFor = s % 600 > 480 ? player.idleFor + 1 : 0
  if (s > 60 && s % 420 === 0) director.hear(1, REQUESTS[(s / 420) % REQUESTS.length])
  director.tick()
}

const pick = <T>(items: T[], n: number): T[] => { const copy = [...items]; const out: T[] = []; while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]); return out }
// Exchanges: runs of lines with less than eight seconds between them.
const exchanges: (typeof said)[] = []
let run: typeof said = []
for (const line of said) {
  if (run.length && line.t - run[run.length - 1].t > 8) { if (run.length > 1) exchanges.push(run); run = [] }
  run.push(line)
}
if (run.length > 1) exchanges.push(run)
const short = (n: string) => n.split(' ')[0] + ' (' + n.split(' ').slice(1).join(' ') + ')'
console.log(`seed ${seed}: ${said.length} lines in ${minutes} simulated minutes, ${exchanges.length} exchanges; bots ${names.join(', ')}\n`)
console.log('FORTY RANDOM LINES')
for (const l of pick(said, 40)) console.log(`${short(l.name)}: ${l.text}`)
console.log('\nSIX RANDOM EXCHANGES')
for (const e of pick(exchanges, 6)) { console.log('--'); for (const l of e) console.log(`${short(l.name)}: ${l.text}`) }
