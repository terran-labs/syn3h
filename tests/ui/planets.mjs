/**
 * Planet choice check, through the galaxy (the only lobby since 14 November): a label for each
 * kind of world plus Custom; picking a kind rebuilds the world and leads to the name form;
 * Custom opens only the sliders that shape a world; the invite link carries the world; a
 * locked room refuses a change; an invited guest is held to the linked world until they join;
 * Play releases the galaxy's graphics context.
 *
 *   SYN3H_URL=http://127.0.0.1:5193/ tools/heavy.sh node tests/ui/planets.mjs
 *
 * Needs a dev server (SYN3H_URL, default http://127.0.0.1:5187/). The guest walk joins a room,
 * so that server needs its room server too.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/planets'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
// Headless Chrome is slow enough that the game would step its graphics level down; hold it.
const pin = page => page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
const settler = page => id => page.waitForFunction(id => { const p = document.querySelector('.lobby-panels'); return p.dataset.activePanel === id && p.dataset.busy === 'false' }, id, { timeout: 30000 })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${base}?room=planets-${Date.now()}`, { waitUntil: 'load' }); await ready(page); await pin(page)
  const settle = settler(page)
  const labels = page.locator('.galaxy-label')
  const planets = await page.evaluate(() => syn3h.planets.PLANETS.map(p => p.id))
  assert.deepEqual((await labels.evaluateAll(list => list.map(l => l.dataset.world))).sort(), [...planets, 'custom'].sort())
  assert.equal(await page.locator('.galaxy-label.is-current').getAttribute('data-world'), 'volcanic')
  assert.equal(await page.locator('.planet-card, .planet-orb, .lobby-starfield').count(), 0, 'no planet cards anywhere')
  // The maps are really painted.
  await page.waitForFunction(() => syn3h.shell.graphics.planetMaps >= 3, null, { timeout: 20000 })
  await page.screenshot({ path: `${out}/galaxy.png` })
  // A different kind: the world changes for the room and the form comes next.
  const before = await page.evaluate(() => ({ kind: syn3h.params.get('terrain.kind').value, seed: syn3h.params.get('world.seed').value }))
  await page.locator('.galaxy-label[data-world=alpine]').dispatchEvent('click'); await settle('explore')
  const after = await page.evaluate(() => ({ kind: syn3h.params.get('terrain.kind').value, sea: syn3h.params.get('world.seaKind').value, seed: syn3h.params.get('world.seed').value, planet: syn3h.planets.currentPlanet().id }))
  assert.equal(after.planet, 'alpine'); assert.notEqual(after.kind, before.kind); assert.equal(after.sea, 1)
  // Its name and link follow, on the Worlds panel and on the galaxy's label.
  await page.evaluate(() => syn3h.shell.showPanel('worlds')); await settle('worlds')
  const name = await page.evaluate(seed => syn3h.planets.planetName(seed), after.seed)
  assert.match(await page.locator('.planet-current').textContent(), new RegExp(`Alpine world ${name}`))
  assert.ok((await page.locator('[data-panel=multiplayer] .invite-link').textContent()).includes(`world=alpine.${after.seed}`))
  await page.screenshot({ path: `${out}/worlds-alpine.png` })
  await page.evaluate(() => syn3h.shell.showPanel('index')); await settle('index')
  await page.waitForFunction(name => document.querySelector('.galaxy-label[data-world=alpine] small').textContent === name, name)
  // The kind already in play is not re-rolled.
  await page.locator('.galaxy-label[data-world=alpine]').dispatchEvent('click'); await settle('explore')
  assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), after.seed)
  // Custom: only the world-shaping slider groups.
  await page.evaluate(() => syn3h.shell.showPanel('index')); await settle('index')
  await page.locator('.galaxy-label[data-world=custom]').dispatchEvent('click'); await settle('advanced')
  const groups = await page.evaluate(() => [...document.querySelectorAll('.advanced-host .tp-fldv')].filter(f => f.offsetParent !== null && !f.classList.contains('tp-v-hidden')).map(f => f.querySelector('.tp-fldv_t')?.textContent))
  assert.ok(groups.includes('Terrain') && groups.includes('Sky'), `groups shown: ${groups}`)
  assert.ok(!groups.includes('Bots') && !groups.includes('Game'), `groups shown: ${groups}`)
  await page.screenshot({ path: `${out}/custom.png` })
  // Settings then Advanced shows everything again.
  await page.evaluate(() => syn3h.shell.showPanel('settings')); await settle('settings')
  await page.locator('[data-panel=settings] [data-goto=advanced]').click(); await settle('advanced')
  assert.ok((await page.evaluate(() => [...document.querySelectorAll('.advanced-host .tp-fldv')].filter(f => f.offsetParent !== null && !f.classList.contains('tp-v-hidden')).map(f => f.querySelector('.tp-fldv_t')?.textContent))).includes('Bots'))
  // A locked world: a guest cannot change kind. The other labels dim, and a tap is refused.
  await page.evaluate(() => { window.syn3hNet = { isHost: false, locked: true, canEditWorld: false, setLocked() {} }; syn3h.shell.showPanel('index') }); await settle('index')
  await page.waitForFunction(() => document.querySelector('.galaxy-label[data-world=desert]').classList.contains('is-locked'))
  await page.locator('.galaxy-label[data-world=desert]').dispatchEvent('click')
  // The flight goes, the arrival is refused, and the view backs out to the whole system.
  await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('galaxy-open') && window.syn3h.shell.galaxy.chosen === -1 && window.syn3h.shell.galaxy.arrived === false, null, { timeout: 20000 })
  assert.equal(await page.evaluate(() => syn3h.planets.currentPlanet().id), 'alpine', 'a locked room keeps its world')
  await page.close()
  // A guest arriving by an invite link that names a world: that world, and no other, until
  // they are in the room. Pressing Play hands the galaxy's graphics context back.
  const guest = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  guest.on('pageerror', e => errors.push(e.message))
  await guest.goto(`${base}?room=planets-guest-${Date.now()}&world=desert.4242`, { waitUntil: 'load' }); await ready(guest); await pin(guest)
  assert.deepEqual(await guest.evaluate(() => [syn3h.planets.currentPlanet().id, syn3h.params.get('world.seed').value]), ['desert', 4242])
  await guest.waitForFunction(() => document.querySelector('.galaxy-label[data-world=alpine]').classList.contains('is-locked'))
  assert.deepEqual(await guest.locator('.galaxy-label:not(.is-locked)').evaluateAll(list => list.map(l => l.dataset.world)), ['desert'])
  assert.equal(await guest.locator('#new-world').isDisabled(), true)
  await guest.locator('.galaxy-label[data-world=desert]').dispatchEvent('click'); await settler(guest)('explore')
  await guest.evaluate(() => clearInterval(window.__pin))
  await guest.locator('.shell-play').click()
  await guest.waitForFunction(() => { const s = document.querySelector('.syn3h-shell'); return s.classList.contains('is-playing') && !s.classList.contains('is-descending') }, null, { timeout: 20000 })
  await guest.waitForTimeout(500)
  assert.equal(await guest.evaluate(() => syn3h.shell.graphics.galaxyLive), false, 'context released on Play')
  await guest.close()
  console.log(JSON.stringify({ ok: true, world: `alpine.${after.seed}`, name, groups, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
