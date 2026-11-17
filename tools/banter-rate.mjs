/**
 * How much the bots talk: one person and four bots for ten minutes per planet, bot lines
 * counted by kind from the director's own counts (src/bots/banter/Director.ts `counts`).
 *
 *   tools/heavy.sh node tools/banter-rate.mjs http://127.0.0.1:<port>/ [minutes] [label]
 *
 * The person drives in short pulses, parks now and then, and types two lines to the bots
 * (a greeting and a question) so replies to a person are measured too. One page at a time.
 */
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const minutes = Number(process.argv[3] ?? 10)
const label = process.argv[4] ?? ''
const KINDS = [
  ['rescue', /^(stuck|conflict|rescue)\./],
  ['replies to the player', /^(req|look|bored|tag|follow)\./],
  ['replies to other bots', /^(idle\.reply|reply\.|retort\.|payoff\.|doubt\.|defend\.|settle\.|tease\.|meet\.reply|sight\.reply|bot\.arrive\.self)/],
  ['reactions to events', /^(mishap|sight\.real|player|time|weather|bot|callback\.clumsy|meet\.hello)/],
  ['idle banter', /./],
]
const kindOf = (key) => KINDS.find(([, re]) => re.test(key))[0]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const rows = []
try {
  for (const [planet, look] of [['volcanic', 0], ['icy', 4]]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    await page.goto(`${base}?room=rate${Date.now().toString(36)}&name=Sam&autoplay=1`)
    await page.waitForFunction(() => window.syn3hChat?.net?.isHost && window.syn3hChat.banter?.director, null, { timeout: 90000 })
    await page.evaluate((look) => { const p = window.syn3h.params; p.set('daydream.seconds', 0); p.set('gfx.auto', false); p.set('gfx.quality', 1); p.set('bots.count', 4); p.set('terrain.look', look) }, look)
    await page.waitForTimeout(5000)
    const start = await page.evaluate(() => ({ ...window.syn3hChat.banter.director.counts }))
    const end = Date.now() + minutes * 60_000
    let i = 0
    while (Date.now() < end) {
      if (i === 6) await page.evaluate(() => window.syn3hChat.net.chat.send('hi bots'))
      if (i === 30) await page.evaluate(() => window.syn3hChat.net.chat.send('what are you all doing'))
      // A sightseeing drive: throttle pulses, a turn now and then, parked one cycle in five.
      if (i % 5 !== 4) for (let k = 0; k < 6; k++) {
        await page.keyboard.down('KeyW'); if (i % 3 === 1) await page.keyboard.down('KeyD')
        await page.waitForTimeout(450); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW'); await page.waitForTimeout(550)
      } else await page.waitForTimeout(6000)
      i++
    }
    const now = await page.evaluate(() => ({ counts: { ...window.syn3hChat.banter.director.counts }, bots: window.syn3h.bots.vehicles.length }))
    const by = {}
    for (const [key, n] of Object.entries(now.counts)) { const d = n - (start[key] ?? 0); if (d > 0) by[kindOf(key)] = (by[kindOf(key)] ?? 0) + d }
    rows.push({ planet, bots: now.bots, by })
    const keys = Object.entries(now.counts).map(([k, n]) => [k, n - (start[k] ?? 0)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`${planet} top pools: ${keys.map(([k, n]) => `${k} ${n}`).join(', ')}`)
    await page.context().close()
  }
} finally {
  await browser.close()
}
const per10 = (n) => Math.round((n * 10) / minutes)
console.log(`\nBot lines per ten minutes${label ? ` (${label})` : ''}, one person, four bots, chatter normal:`)
console.log(`| kind | ${rows.map((r) => `${r.planet} (${r.bots} bots)`).join(' | ')} |`)
console.log(`|---|${rows.map(() => '---').join('|')}|`)
for (const [kind] of KINDS) console.log(`| ${kind} | ${rows.map((r) => per10(r.by[kind] ?? 0)).join(' | ')} |`)
console.log(`| total | ${rows.map((r) => per10(Object.values(r.by).reduce((a, b) => a + b, 0))).join(' | ')} |`)
