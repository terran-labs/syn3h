/**
 * Entering a different world gives a fresh vehicle, seen by both players. Production build:
 *
 *   tools/heavy.sh npm run build
 *   tools/heavy.sh node tools/world-entry-browser.mjs [output directory]
 *
 * Serves dist/ with a room server in this process and opens two players in one room. For the
 * Zorb case and the buggy-wings case, player A turns the mode on, leaves to the lobby and picks
 * a different planet through the lobby's own tap handler; the room moves both players there.
 * Then a settings rebuild (sea level moved) with the mode on, which must keep it. Prints what
 * each side shows, saves frames, and exits non zero on a stale mode or a page error.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { serveStable } from './serve-stable.mjs'

const out = process.argv[2] ?? '/tmp/vehicle-state-reset'
await mkdir(out, { recursive: true })
const app = await serveStable({ dir: process.cwd(), port: 0 })
const base = `http://127.0.0.1:${app.server.address().port}/`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const errors = [], results = []
const wait = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 })

async function player(room, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}?autoplay=1&vehicle=buggy&planet=alpine&seed=4&room=${room}&name=${name}`)
  await wait(page, () => window.miraNet?.connected && window.mira?.game.tick > 30 && window.mira.shell.playing, null, 120000)
  await page.evaluate(() => window.mira.params.set('bots.count', 0))
  return { ctx, page }
}
/** What a page shows: its own vehicle and its copy of the other player. */
const look = () => {
  const s = window.mira, me = s.player, other = [...window.miraNet.remotes.values()][0]?.vehicle
  return {
    planet: s.params.get('terrain.look').value, seed: s.params.get('world.seed').value, playing: s.shell.playing,
    own: { zorbKey: s.game.input.state.zorb, spaceKey: s.game.input.state.special, ball: me.zorb.active, radius: +me.zorb.radius.toFixed(2), wings: me.wingsOpen },
    copy: other ? { ball: other.zorb.active, radius: +other.zorb.radius.toFixed(2), wings: other.wingsOpen, zorbFlag: other.input.zorb, spaceFlag: other.input.special } : null,
  }
}

const room = `entry${Date.now().toString(36)}`
const a = await player(room, 'A'), b = await player(room, 'B')
await Promise.all([a, b].map((p) => wait(p.page, () => window.miraNet.remotes.size === 1)))

for (const [label, on, shown, worlds] of [
  ['zorb', (st) => { st.zorb = true }, (v) => v.zorb.active && v.zorb.radius === v.zorb.target, ['volcanic', 'desert']],
  ['wings', (st) => { st.special = true }, (v) => v.wingsOpen, ['archipelago', 'alpine']],
]) {
  const dir = `${out}/${label}`
  await mkdir(dir, { recursive: true })
  // A turns the mode on and both sides see it.
  await a.page.evaluate(`(${on})(window.mira.game.input.state)`)
  await wait(a.page, `(${shown})(window.mira.player)`)
  await wait(b.page, `(${shown})([...window.miraNet.remotes.values()][0].vehicle)`)
  const before = { a: await a.page.evaluate(look), b: await b.page.evaluate(look) }
  await a.page.screenshot({ path: `${dir}/1-a-mode-on.png` })
  // Settings rebuild of the same world (sea level): the mode stays.
  await a.page.evaluate(() => window.mira.params.set('world.lavaAltitude', window.mira.params.get('world.lavaAltitude').value + 2))
  await a.page.waitForTimeout(4000)
  const rebuilt = { a: await a.page.evaluate(look), b: await b.page.evaluate(look) }
  // A leaves to the lobby and picks another planet with the lobby's own handler.
  const target = worlds.find((w) => w !== before.a.planet) ?? worlds[0]
  await a.page.evaluate(() => window.mira.shell.openMenu())
  await a.page.waitForTimeout(500)
  await a.page.evaluate((id) => window.mira.shell.tapWorld(id), target)
  await wait(a.page, (seed) => window.mira.params.get('world.seed').value !== seed && window.mira.shell.playing, before.a.seed, 60000)
  await wait(b.page, (seed) => window.mira.params.get('world.seed').value !== seed, before.a.seed, 60000)
  await a.page.waitForTimeout(4000)
  const after = { a: await a.page.evaluate(look), b: await b.page.evaluate(look) }
  await a.page.screenshot({ path: `${dir}/2-a-new-world.png` }); await b.page.screenshot({ path: `${dir}/2-b-new-world.png` })
  const stale = label === 'zorb'
    ? [after.a.own.zorbKey, after.a.own.ball, after.b.copy?.ball, after.b.copy?.zorbFlag]
    : [after.a.own.spaceKey, after.a.own.wings, after.b.copy?.wings, after.b.copy?.spaceFlag]
  const kept = label === 'zorb' ? rebuilt.a.own.ball && rebuilt.b.copy?.ball : rebuilt.a.own.wings && rebuilt.b.copy?.wings
  const r = { case: label, fresh: !stale.some(Boolean), keptOnSettingsRebuild: Boolean(kept), before, rebuilt, after }
  results.push(r)
  console.log(JSON.stringify({ case: label, fresh: r.fresh, keptOnSettingsRebuild: r.keptOnSettingsRebuild, worlds: [before.a.planet, after.a.planet], afterA: after.a.own, copyOnB: after.b.copy }))
}
await a.ctx.close(); await b.ctx.close()
await browser.close()
await app.close()
await writeFile(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2))
if (errors.length) { console.error(errors); process.exit(1) }
process.exit(results.every((r) => r.fresh && r.keptOnSettingsRebuild) ? 0 : 1)
