// Vehicle labels in a real browser: a bot in view gets a label on desktop and on a phone in
// both orientations, and a second person joining the room gets a person label beside a bot's.
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

async function open(browser, view, room) {
  const page = await browser.newPage(views[view])
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${url}?autoplay=1&room=${room}`)
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
/** Shown labels, each with its vehicle's on-screen centre, and any label over a HUD control. */
function labels(page) {
  return page.evaluate(() => {
    const tags = window.syn3hNet.tags, cam = window.syn3h.game.camera, w = innerWidth, h = innerHeight
    const hud = tags.hud.read(w, h), shown = []
    for (const info of window.syn3hNet.tagList) {
      const p = tags.plates.get(info.id)
      if (!p || p.el.hidden) continue
      const s = info.vehicle.object.getWorldPosition(cam.position.clone()).project(cam), r = p.el.getBoundingClientRect()
      shown.push({ name: info.name, bot: p.el.classList.contains('is-bot'), centre: [(s.x + 1) / 2 * w, (1 - s.y) / 2 * h],
        overHud: hud.some(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) })
    }
    return { shown, w, h }
  })
}
async function waitForLabel(view, page, want, place) {
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) await place()
    await page.waitForTimeout(1000)
    const state = await labels(page)
    for (const l of state.shown) {
      const [x, y] = l.centre
      assert.ok(x >= 0 && x <= state.w && y >= 0 && y <= state.h, `${view} ${l.name}: label shown for a vehicle off screen`)
      assert.ok(!l.overHud, `${view} ${l.name}: label covers a HUD control`)
    }
    if (want(state.shown)) return state.shown
  }
  await page.screenshot({ path: `${out}/${view}-failed.png` })
  assert.fail(`${view}: no label appeared for a vehicle in view`)
}

for (const view of ['desktop', 'portrait', 'landscape']) {
  const browser = await (view === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch())
  try {
    const { page, errors } = await open(browser, view, `nameplates-${view}-${Date.now()}`)
    const shown = await waitForLabel(view, page, s => s.some(l => l.bot), () => placeAhead(page, 'bot', 16, 8))
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
    await host.page.screenshot({ path: `${out}/people.png` })
    assert.deepEqual([...host.errors, ...visitor.errors], [])
    console.log(`people: ${shown.map(l => `${l.name}${l.bot ? ' (bot)' : ''}`).join(', ')} PASS`)
  } finally { await browser.close() }
}
