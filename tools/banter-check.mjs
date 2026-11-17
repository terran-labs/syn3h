/**
 * Bot banter in a real browser, for transcripts and for checking the bots act on requests.
 *
 *   tools/heavy.sh node tools/banter-check.mjs http://127.0.0.1:<port>/ [out-dir] [mode]
 *
 * mode "talk" (default): two minutes of bot lines at normal and two at chatty, on a volcanic
 * and an icy planet. mode "follow": the player types "hey you guys follow me", drives about,
 * then parks; prints the transcript with each bot's distance to the player every five
 * seconds until every bot has left. One page, closed when done.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const out = process.argv[3] ?? '/tmp/syn3h-banter-check'
const mode = process.argv[4] ?? 'talk'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const errors = []
let exitCode = 0

async function host(name, look) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}?room=banter${Date.now().toString(36)}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3hChat?.net?.connected && window.syn3hChat.net.isHost, null, { timeout: 60000 })
  await page.evaluate((look) => {
    const p = window.syn3h.params
    p.set('daydream.seconds', 0)
    p.set('bots.count', 4)
    if (look !== null) p.set('terrain.look', look)
  }, look)
  await page.waitForTimeout(4000)
  return { ctx, page }
}

/** Lines in the chat log since `since` (performance.now on the page), as "Name (job): text". */
const lines = (page, since = 0) => page.evaluate((since) => window.syn3hChat.net.chat.lines
  .filter((l) => !l.system && l.at >= since)
  .map((l) => ({ t: Math.round(l.at / 100) / 10, who: l.bot ? l.name : `${l.name} (player)`, text: l.text })), since)

try {
  if (mode === 'talk') {
    for (const [planet, look] of [['volcanic', 0], ['icy', 4]]) {
      for (const [label, level] of [['normal', 1], ['chatty', 2]]) {
        const { ctx, page } = await host(`Sam`, look)
        await page.evaluate((level) => window.syn3h.params.set('bots.chatterLevel', level), level)
        // Drive about a little, as a player would, so there is something to remark on.
        const start = await page.evaluate(() => performance.now())
        for (let s = 0; s < 120; s += 10) {
          await page.keyboard.down('KeyW'); await page.keyboard.down(s % 20 ? 'KeyA' : 'KeyD')
          await page.waitForTimeout(6000)
          await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW')
          await page.waitForTimeout(4000)
        }
        const said = await lines(page, start)
        const t0 = said[0]?.t ?? 0
        const text = said.map((l) => `[${(l.t - t0).toFixed(0).padStart(3)} s] ${l.who}: ${l.text}`).join('\n')
        console.log(`\n=== ${planet}, ${label}: ${said.length} lines in two minutes ===\n${text}`)
        writeFileSync(`${out}/talk-${planet}-${label}.txt`, text + '\n')
        await page.screenshot({ path: `${out}/talk-${planet}-${label}.png` })
        await ctx.close()
      }
    }
  } else {
    const { ctx, page } = await host('Sam', null)
    const start = await page.evaluate(() => performance.now())
    await page.evaluate(() => window.syn3hChat.net.chat.send('hey you guys follow me'))
    const t0 = Date.now()
    const log = []
    const sample = async (phase) => {
      const s = await page.evaluate(() => {
        const me = window.syn3h.player.body.translation()
        const bots = window.syn3h.bots.vehicles.map((v, i) => {
          const p = v.body.translation(), brain = window.syn3h.bots.brainList[i]
          return { name: window.syn3hChat.net.displayName(0xff00 + i).split(' ')[0], d: Math.round(Math.hypot(p.x - me.x, p.z - me.z)), following: brain?.directive?.kind ?? '-' }
        })
        return bots
      })
      log.push(`[${Math.round((Date.now() - t0) / 1000).toString().padStart(3)} s] ${phase}: ${s.map((b) => `${b.name} ${b.d} m ${b.following}`).join(', ')}`)
    }
    // Drive a loop for about seventy seconds, then park until everyone has left.
    // Pulses of throttle: a sightseeing pace the bots can keep up with.
    for (let i = 0; i < 14; i++) {
      for (let k = 0; k < 5; k++) {
        await page.keyboard.down('KeyW'); if (i % 4 === 2) await page.keyboard.down('KeyD')
        await page.waitForTimeout(450)
        await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW')
        await page.waitForTimeout(550)
      }
      await sample('driving')
    }
    let following = 1
    for (let i = 0; i < 48 && following; i++) {
      await page.waitForTimeout(5000)
      await sample('parked')
      following = await page.evaluate(() => window.syn3h.bots.brainList.filter((b) => b.directive?.kind === 'follow').length)
    }
    // The last goodbye is said a moment after the last bot peels off.
    await page.waitForTimeout(12000)
    const said = await lines(page, start)
    const s0 = said[0]?.t ?? 0
    const transcript = said.map((l) => `[${(l.t - s0).toFixed(0).padStart(3)} s] ${l.who}: ${l.text}`).join('\n')
    console.log(`=== follow me ===\n${transcript}\n\n=== distances ===\n${log.join('\n')}`)
    writeFileSync(`${out}/follow.txt`, `${transcript}\n\n${log.join('\n')}\n`)
    if (following) { console.log('FAIL bots were still following after four minutes parked'); exitCode = 1 }
    await ctx.close()
  }
} catch (e) {
  console.log('ERROR', e?.stack ?? e); exitCode = 1
} finally {
  await browser.close()
}
for (const e of errors) console.log('PAGE ERROR', e)
process.exit(errors.length ? 1 : exitCode)
