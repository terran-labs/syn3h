/**
 * Planet picker check: the lobby offers one card per kind of world plus Custom; picking a
 * kind rebuilds the world and leads to the name form; Custom opens only the sliders that
 * shape a world; the invite link carries the world; a locked room refuses a change.
 *
 *   tools/heavy.sh node tests/ui/planets.mjs
 *
 * Needs the lane dev server on 5187 and its room server (see README).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/planets'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://127.0.0.1:5187/?room=planets-${Date.now()}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 25, null, { timeout: 120000 })
  const settle = id => page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id)
  await page.evaluate(() => syn3h.shell.showPanel('index')); await settle('index')
  const cards = page.locator('.lobby-index .planet-card')
  assert.deepEqual(await cards.evaluateAll(list => list.map(card => card.dataset.planet)), [...await page.evaluate(() => syn3h.planets.PLANETS.map(p => p.id)), 'custom'])
  assert.equal(await page.locator('.lobby-index .planet-card.is-primary').getAttribute('data-planet'), 'volcanic')
  // The orbs are really drawn: the canvas is not blank once the maps are painted.
  await page.waitForFunction(() => [...document.querySelectorAll('.lobby-index .planet-orb')].every(c => c.width > 0 && c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0), null, { timeout: 15000 })
  await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/index.png` })
  // A different kind: the world changes for the room and the form comes next.
  const before = await page.evaluate(() => ({ kind: syn3h.params.get('terrain.kind').value, seed: syn3h.params.get('world.seed').value }))
  await page.locator('.lobby-index [data-planet=alpine]').click(); await settle('explore')
  const after = await page.evaluate(() => ({ kind: syn3h.params.get('terrain.kind').value, sea: syn3h.params.get('world.seaKind').value, seed: syn3h.params.get('world.seed').value, planet: syn3h.planets.currentPlanet().id }))
  assert.equal(after.planet, 'alpine'); assert.notEqual(after.kind, before.kind); assert.equal(after.sea, 1)
  // Its name and link follow.
  await page.evaluate(() => syn3h.shell.showPanel('worlds')); await settle('worlds')
  const name = await page.evaluate(seed => syn3h.planets.planetName(seed), after.seed)
  assert.equal(await page.locator('[data-panel=worlds] .planet-card.is-primary small').textContent(), name)
  assert.match(await page.locator('.planet-current').textContent(), new RegExp(`Alpine world ${name}`))
  assert.ok((await page.locator('[data-panel=multiplayer] .invite-link').textContent()).includes(`world=alpine.${after.seed}`))
  await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/worlds-alpine.png` })
  // The kind already in play is not re-rolled.
  await page.evaluate(() => syn3h.shell.showPanel('index')); await settle('index')
  await page.locator('.lobby-index [data-planet=alpine]').click(); await settle('explore')
  assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), after.seed)
  // Custom: only the world-shaping slider groups.
  await page.evaluate(() => syn3h.shell.showPanel('index')); await settle('index')
  await page.locator('.lobby-index [data-planet=custom]').click(); await settle('advanced')
  const groups = await page.evaluate(() => [...document.querySelectorAll('.advanced-host .tp-fldv')].filter(f => f.offsetParent !== null && !f.classList.contains('tp-v-hidden')).map(f => f.querySelector('.tp-fldv_t')?.textContent))
  assert.ok(groups.includes('Terrain') && groups.includes('Sky'), `groups shown: ${groups}`)
  assert.ok(!groups.includes('Bots') && !groups.includes('Game'), `groups shown: ${groups}`)
  await page.screenshot({ path: `${out}/custom.png` })
  // Settings then Advanced shows everything again.
  await page.evaluate(() => syn3h.shell.showPanel('settings')); await settle('settings')
  await page.locator('[data-goto=advanced]').first().click(); await settle('advanced')
  assert.ok((await page.evaluate(() => [...document.querySelectorAll('.advanced-host .tp-fldv')].filter(f => f.offsetParent !== null && !f.classList.contains('tp-v-hidden')).map(f => f.querySelector('.tp-fldv_t')?.textContent))).includes('Bots'))
  // A locked world: a guest cannot change kind.
  await page.evaluate(() => { window.syn3hNet = { isHost: false, locked: true, canEditWorld: false, setLocked() {} }; syn3h.shell.showPanel('index') }); await settle('index')
  await page.waitForFunction(() => document.querySelector('.lobby-index [data-planet=desert]').disabled)
  assert.equal(await page.locator('.lobby-index [data-planet=alpine]').isEnabled(), true)
  console.log(JSON.stringify({ ok: true, world: `alpine.${after.seed}`, name, groups, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
