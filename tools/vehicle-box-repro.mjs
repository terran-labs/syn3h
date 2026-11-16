// Reproduce "players arrive as box buggies" against a running dev server.
//   node tools/vehicle-box-repro.mjs fail-once|jet-warm|switch|slow|two-pages [base]
// fail-once aborts the first buggy model requests; before the fix the player stayed a box.
import { chromium } from 'playwright-core'

const scenario = process.argv[2] ?? 'baseline'
const base = process.argv[3] ?? 'http://127.0.0.1:5419'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const look = (page) => page.evaluate(() => {
  const s = window.syn3h
  const describe = (v) => v && ({
    kind: v.kind,
    box: v.fallback ? v.fallback.visible || !v.skin || !v.skin.object.visible : false,
    fallback: v.fallback?.visible ?? null, skin: !!v.skin, skinVisible: v.skin?.object.visible ?? null,
  })
  return {
    player: describe(s.player),
    bots: (s.bots.vehicles ?? []).filter((v) => v.fallback).map(describe).map((d) => d.box),
    remotes: window.syn3hNet ? [...window.syn3hNet.remotes.values()].map((r) => describe(r.vehicle)) : [],
  }
})

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
try {
  const context = await browser.newContext({ viewport: { width: 800, height: 450 } })
  let modelHits = 0
  const room = `box${Date.now() % 100000}`
  const page = await context.newPage()
  page.on('console', (m) => { if (/model|Buggy|skin/i.test(m.text())) console.log('console:', m.text().slice(0, 200)) })
  await page.route(/\/models\/buggy.*\.glb/, async (route) => {
    modelHits++
    if (scenario === 'fail-once' && modelHits <= 2) return route.abort('failed')
    if (scenario === 'jet-warm' || scenario === 'slow') await wait(Number(process.env.DELAY ?? 6000))
    return route.continue()
  })
  const vehicle = scenario === 'jet-warm' ? 'jet' : 'buggy'
  await page.goto(`${base}/?room=${room}&name=Box&autoplay=1&vehicle=${vehicle}`)
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 60000 })
  await page.evaluate(() => window.syn3h.shell.play?.())
  await wait(scenario === 'jet-warm' ? 25000 : 15000)
  console.log('after load', JSON.stringify(await look(page)), 'model requests', modelHits)
  if (scenario === 'jet-warm' || scenario === 'switch' || scenario === 'fail-once') {
    await page.evaluate(() => window.syn3h.swapVehicle(window.syn3h.player.kind === 'buggy' ? 'jet' : 'buggy'))
    await wait(3000)
    if (scenario !== 'jet-warm') { await page.evaluate(() => window.syn3h.swapVehicle('buggy')); await wait(3000) }
    console.log('after switch', JSON.stringify(await look(page)))
  }
  if (scenario === 'two-pages') {
    const other = await context.newPage()
    await other.goto(`${base}/?room=${room}&name=Other&autoplay=1&vehicle=buggy`)
    await other.waitForFunction(() => window.syn3hNet?.remotes?.size >= 1, null, { timeout: 60000 })
    await wait(10000)
    console.log('first sees', JSON.stringify(await look(page)))
    console.log('second sees', JSON.stringify(await look(other)))
  }
} finally {
  await browser.close()
}
