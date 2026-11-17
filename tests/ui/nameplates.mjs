// Vehicle labels in a real browser: a bot in view gets a label on desktop and on a phone in
// both orientations; no leader line is ever drawn; a bot seen through your own open wings keeps
// its label; a bot far off still has one; a second person joining the room gets a person label
// beside a bot's, and still has one 600 m away; and a player 14 m straight ahead of you is
// named (as tools/net-smoke.mjs step 7 places them).
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
  await page.goto(`${url}?autoplay=1&daydream=0&room=${room}${name ? `&name=${name}` : ''}`)
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
      // Settled labels only: one fading out may trail its vehicle for 150 ms.
      if (!p || p.el.hidden || Number(p.el.style.opacity) < .5) continue
      const s = info.vehicle.object.getWorldPosition(cam.position.clone()).project(cam), r = p.el.getBoundingClientRect()
      shown.push({ name: info.name, bot: p.el.classList.contains('is-bot'), centre: [(s.x + 1) / 2 * w, (1 - s.y) / 2 * h],
        overHud: hud.some(b => !b.soft && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) })
    }
    return { shown, w, h }
  })
}
/** Let the fade finish, then check nothing is drawn between a label and its vehicle. */
async function atRest(view, page) {
  await page.waitForTimeout(400)
  const leaders = await page.evaluate(() => document.querySelectorAll('.vehicle-nameplates :is(.s3-leader, .vehicle-nameplate-leader)').length)
  assert.equal(leaders, 0, `${view}: a leader line is drawn`)
}
/** Is the label for vehicle `id` on screen (displayed and not faded out)? */
const labelShown = (page, id) => page.evaluate(id => {
  const el = document.querySelector(`.vehicle-nameplate[data-vehicle="${id}"]`)
  return !!el && !el.hidden && el.style.display !== 'none' && Number(el.style.opacity) > .05
}, id)
async function waitForLabel(view, page, want, place) {
  for (let i = 0; i < 20; i++) {
    if (i % 3 === 0) await place()
    await page.waitForTimeout(1000)
    const state = await labels(page)
    for (const l of state.shown) {
      const [x, y] = l.centre
      // The label sits over the roof, so the body's centre may be just past an edge.
      const slack = 60
      assert.ok(x >= -slack && x <= state.w + slack && y >= -slack && y <= state.h + slack, `${view} ${l.name}: label shown for a vehicle off screen`)
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

// A bot 220 m ahead, then your own buggy in flight, wings open, a bot seen through a wing
// 30 m off. Bugs they catch: your own car's outline (wings, ball, skirt) hiding labels behind it,
// and labels vanishing at a modest distance.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const { page, errors } = await open(browser, 'desktop', `nameplates-wings-${Date.now()}`)
    // Far, first, on the ground: a bot 220 m ahead.
    await page.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0); window.syn3h.player.teleport(s.position, 0) })
    await page.waitForTimeout(1500)
    let far = false
    for (let i = 0; i < 6 && !far; i++) {
      // 30 m over the ground there, so a hill cannot hide it (bots behind terrain are not named).
      await page.evaluate(() => {
        const net = window.syn3hNet, cam = window.syn3h.game.camera, p = window.syn3h.player.body.translation(), terrain = window.syn3h.terrain
        const f = cam.getWorldDirection(cam.position.clone()); f.y = 0; f.normalize()
        const x = p.x + f.x * 220, z = p.z + f.z * 220, [bot, ...rest] = net.tagList.filter(t => t.bot)
        bot.vehicle.teleport(cam.position.clone().set(x, terrain.heightAt(x, z) + 30, z), 0)
        // Nearer bots outrank a far one for the same spot, so park them behind the player.
        rest.forEach((b, i) => { const bx = p.x - f.x * 60 + i * 9, bz = p.z - f.z * 60; b.vehicle.teleport(cam.position.clone().set(bx, terrain.heightAt(bx, bz) + 2, bz), 0) })
      })
      await page.waitForTimeout(1200)
      far = await labelShown(page, await page.evaluate(() => window.syn3hNet.tagList.find(t => t.bot).id))
    }
    await page.screenshot({ path: `${out}/far.png` })
    assert.ok(far, 'far: no label for a bot 220 m ahead')
    // Then up in the air with wings open.
    await page.evaluate(() => { const player = window.syn3h.player, p = player.body.translation(); player.teleport(player.object.position.clone().set(p.x, window.syn3h.terrain.heightAt(p.x, p.z) + 80, p.z), 0) })
    await page.keyboard.press('Space') // wings open
    await page.waitForTimeout(2000)
    let seen = 0, tries = 0, id
    for (; tries < 8; tries++) {
      id = await page.evaluate(() => {
        const net = window.syn3hNet, cam = window.syn3h.game.camera, player = window.syn3h.player, tip = cam.position.clone()
        if (!player.wingsOpen || !player.getWingTip(1, tip)) return null
        player.object.updateMatrixWorld(); player.object.localToWorld(tip)
        const through = player.object.getWorldPosition(cam.position.clone()).lerp(tip, .6), dir = through.sub(cam.position).normalize()
        const bot = net.tagList.find(t => t.bot); bot.vehicle.teleport(cam.position.clone().addScaledVector(dir, 30), 0)
        return bot.id
      })
      assert.ok(id, 'wings: the wings did not open')
      await page.waitForTimeout(600)
      if (await labelShown(page, id)) seen++
    }
    await page.screenshot({ path: `${out}/wings.png` })
    assert.ok(seen >= tries - 1, `wings: a bot seen through your own wing lost its label (${seen}/${tries})`)
    await atRest('wings', page)
    assert.deepEqual(errors, [])
    console.log(`wings: ${seen}/${tries} through the wing, far bot named PASS`)
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
    // The visitor 600 m ahead keeps a label (dimmed if a hill is in the way).
    const visitorId = await host.page.evaluate(() => window.syn3hNet.tagList.find(t => !t.bot).id)
    let far = false
    for (let i = 0; i < 6 && !far; i++) {
      const pose = await host.page.evaluate(() => {
        const cam = window.syn3h.game.camera, p = window.syn3h.player.body.translation(), f = cam.getWorldDirection(cam.position.clone())
        return { x: p.x, z: p.z, fx: f.x, fz: f.z }
      })
      await visitor.page.evaluate(({ x, z, fx, fz }) => {
        const n = Math.hypot(fx, fz), tx = x + fx / n * 600, tz = z + fz / n * 600, player = window.syn3h.player
        player.teleport(player.object.position.clone().set(tx, window.syn3h.terrain.heightAt(tx, tz) + 2, tz), 0)
      }, pose)
      await host.page.waitForTimeout(2000)
      far = await labelShown(host.page, visitorId)
    }
    await host.page.screenshot({ path: `${out}/people-far.png` })
    assert.ok(far, 'people: no label for a person 600 m ahead')
    console.log(`people: ${shown.map(l => `${l.name}${l.bot ? ' (bot)' : ''}`).join(', ')}, and 600 m away PASS`)
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
