// Vehicle labels in a real browser: a bot in view gets a label on desktop and on a phone in
// both orientations; a second person joining the room gets a person label beside a bot's; and a
// player 14 m straight ahead of you is named (as tools/net-smoke.mjs step 7 places them).
// Every picture waits for the reveal to finish, and no name is left clipped at rest.
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/nameplates.mjs
// Screenshots go to tests/ui/artifacts/nameplates/.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.SYN3H_URL
assert.ok(url, 'SYN3H_URL is required')
const out = 'tests/ui/artifacts/nameplates'
await mkdir(out, { recursive: true })
const views = {
  desktop: { viewport: { width: 1440, height: 900 } },
  portrait: devices['iPhone 14'],
  landscape: devices['iPhone 14 landscape'],
}

async function open(browser, view, room, name) {
  const page = await browser.newPage(views[view])
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${url}?autoplay=1&room=${room}${name ? `&name=${name}` : ''}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 180000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  return { page, errors }
}
/** Put a vehicle ahead of this page's player, to one side so the player's car does not hide it. */
function placeAhead(page, which, ahead, side) {
  return page.evaluate(([which, ahead, side]) => {
    const net = window.syn3hNet, cam = window.syn3h.game.camera, player = window.syn3h.player
    const vehicle = which === 'self' ? player : net.tagList.find(t => t.bot)?.vehicle
    if (!vehicle) return false
    const p = player.body.translation(), f = cam.getWorldDirection(cam.position.clone()); f.y = 0; f.normalize()
    vehicle.teleport(cam.position.clone().set(p.x + f.x * ahead - f.z * side, p.y + 2, p.z + f.z * ahead + f.x * side), Math.atan2(f.x, f.z))
    return true
  }, [which, ahead, side])
}
/** Shown labels, each with its vehicle's on-screen centre, and any label over a hard HUD control. */
function labels(page) {
  return page.evaluate(() => {
    const tags = window.syn3hNet.tags, cam = window.syn3h.game.camera, w = innerWidth, h = innerHeight
    const hud = tags.hud.read(w, h), shown = []
    for (const info of window.syn3hNet.tagList) {
      const p = tags.plates.get(info.id)
      if (!p || p.el.hidden) continue
      const s = info.vehicle.object.getWorldPosition(cam.position.clone()).project(cam), r = p.el.getBoundingClientRect()
      shown.push({ name: info.name, bot: p.el.classList.contains('is-bot'), centre: [(s.x + 1) / 2 * w, (1 - s.y) / 2 * h],
        overHud: hud.some(b => !b.soft && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) })
    }
    return { shown, w, h }
  })
}
/** Wait out the reveal, then check no shown plate is still clipped by it. */
async function atRest(view, page) {
  await page.waitForFunction(() => !document.querySelector('.vehicle-nameplate.is-scanning:not([hidden])'), null, { timeout: 5000 })
  await page.waitForTimeout(300)
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.vehicle-nameplate:not([hidden])')]
    .filter(el => getComputedStyle(el).clipPath !== 'none').map(el => el.textContent))
  assert.deepEqual(clipped, [], `${view}: a name is clipped at rest`)
}
async function waitForLabel(view, page, want, place) {
  for (let i = 0; i < 20; i++) {
    if (i % 3 === 0) await place()
    await page.waitForTimeout(1000)
    const state = await labels(page)
    for (const l of state.shown) {
      const [x, y] = l.centre
      assert.ok(x >= 0 && x <= state.w && y >= 0 && y <= state.h, `${view} ${l.name}: label shown for a vehicle off screen`)
      assert.ok(!l.overHud, `${view} ${l.name}: label covers a HUD control`)
    }
    if (want(state.shown)) {
      await page.waitForTimeout(1500) // let moved vehicles settle before the picture
      const settled = (await labels(page)).shown
      if (want(settled)) return settled
    }
  }
  await page.screenshot({ path: `${out}/${view}-failed.png` })
  assert.fail(`${view}: no label appeared for a vehicle in view`)
}

for (const view of ['desktop', 'portrait', 'landscape']) {
  const browser = await (view === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const { page, errors } = await open(browser, view, `nameplates-${view}-${Date.now()}`)
    const shown = await waitForLabel(view, page, s => s.some(l => l.bot), () => placeAhead(page, 'bot', 16, 8))
    await atRest(view, page)
    await page.screenshot({ path: `${out}/${view}.png` })
    assert.deepEqual(errors, [])
    console.log(`${view}: ${shown.map(l => l.name).join(', ')} PASS`)
  } finally { await browser.close() }
}

// Two people in one room: the host's view shows the visitor as a person beside a bot.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true }), room = `nameplates-people-${Date.now()}`
  try {
    const host = await open(browser, 'desktop', room), visitor = await open(browser, 'desktop', room)
    // A different paint, so the picture shows each label in its own vehicle's tint.
    await visitor.page.evaluate(() => window.syn3hNet.setProfile({ kind: 'buggy-syn3h', colors: { body: '#ff3a1a', accent: '#ffd23a' } }))
    const toHost = async () => {
      const pose = await host.page.evaluate(() => {
        const cam = window.syn3h.game.camera, p = window.syn3h.player.body.translation(), f = cam.getWorldDirection(cam.position.clone())
        return { x: p.x, y: p.y, z: p.z, fx: f.x, fz: f.z }
      })
      await visitor.page.evaluate(({ x, y, z, fx, fz }) => {
        const n = Math.hypot(fx, fz), ux = fx / n, uz = fz / n, player = window.syn3h.player
        player.teleport(player.object.position.clone().set(x + ux * 20 + uz * 8, y + 2, z + uz * 20 - ux * 8), Math.atan2(ux, uz))
      }, pose)
      await placeAhead(host.page, 'bot', 16, 8)
    }
    const shown = await waitForLabel('people', host.page, s => s.some(l => l.bot) && s.some(l => !l.bot), toHost)
    await atRest('people', host.page)
    await host.page.screenshot({ path: `${out}/people.png` })
    assert.deepEqual([...host.errors, ...visitor.errors], [])
    console.log(`people: ${shown.map(l => `${l.name}${l.bot ? ' (bot)' : ''}`).join(', ')} PASS`)
  } finally { await browser.close() }
}

// A player straight ahead: B 14 m behind A, both facing the same way (tools/net-smoke.mjs step
// 7). Bug it catches: the own-car rule hid the label of a car whose roof showed over yours.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true }), room = `nameplates-ahead-${Date.now()}`
  try {
    const a = await open(browser, 'desktop', room, 'Alice'), b = await open(browser, 'desktop', room, 'Bob')
    await b.page.waitForFunction(() => [...window.syn3hNet.players.values()].some(p => p.name === 'Alice'), null, { timeout: 20000 })
    let tag
    for (let i = 0; i < 3 && !tag?.shown; i++) {
      await a.page.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0); window.syn3h.player.teleport(s.position, 0) })
      await b.page.evaluate(() => {
        const s = window.syn3h.terrain.spawnPoint(0)
        s.position.z += 14; s.position.y = window.syn3h.terrain.heightAt(s.position.x, s.position.z) + 1.5
        window.syn3h.player.teleport(s.position, 0)
      })
      await b.page.waitForTimeout(1500)
      tag = await b.page.evaluate(() => {
        const el = [...document.querySelectorAll('.vehicle-nameplate')].find(d => d.textContent.startsWith('Alice'))
        return el && { shown: el.style.display === 'block' && !el.hidden && Number(el.style.opacity) > .5, text: el.textContent }
      })
    }
    assert.ok(tag?.shown, `ahead: B shows no label for A 14 m in front (${JSON.stringify(tag)})`)
    await atRest('ahead', b.page)
    await b.page.screenshot({ path: `${out}/ahead.png` })
    assert.deepEqual([...a.errors, ...b.errors], [])
    console.log('ahead: Alice named on Bob\'s screen PASS')
  } finally { await browser.close() }
}
