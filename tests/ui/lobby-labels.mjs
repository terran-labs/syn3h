// The lobby's planet captions sit under their planets and nowhere else: at phone landscape
// (844x390, 667x375), phone portrait (390x844) and desktop (1440x900, 1280x800), settled and
// while the view is dragged, every caption's centre is level with its planet's centre and its
// top sits CAPTION_GAP below the planet's limb, within a pixel. No plate or leader exists.
// Pointing at a planet brings its caption to full opacity, never changing its place or size. Captions
// may overlap each other; that is the design (the owner, 16 November 2026).
//   SYN3H_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/lobby-labels.mjs
// Screenshots go to tests/ui/artifacts/lobby-labels/.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const url = process.env.SYN3H_URL
assert.ok(url, 'SYN3H_URL is required')
/** Must match CAPTION_GAP in src/ui/Shell.ts. */
const GAP = 5
const out = 'tests/ui/artifacts/lobby-labels'
await mkdir(out, { recursive: true })
const views = { landscape: [844, 390, true], 'landscape-small': [667, 375, true], portrait: [390, 844, true], desktop: [1440, 900, false], 'desktop-1280': [1280, 800, false] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [name, [width, height, phone]] of Object.entries(views)) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone }), page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}?room=lobby-labels-${name}-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false' && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    // Hold the graphics level, as galaxy.mjs does: a slow headless browser would retire the galaxy.
    await page.evaluate(() => { window.__pin = setInterval(() => window.syn3h.params.set('gfx.level', 2), 400) })
    // Past the opening: the captions fade in once their worlds have arrived.
    await page.waitForTimeout(9000)
    // Each caption against its planet, read in one frame: horizontal offset of the centres, and
    // the gap from the limb to the caption's top, minus GAP.
    const measure = () => page.evaluate(() => {
      const screen = window.syn3h.shell.galaxy.screen
      return [...document.querySelectorAll('.galaxy-label')].filter(c => !c.hidden).map(c => {
        const r = c.getBoundingClientRect(), p = screen.find(s => s.id === c.dataset.world)
        return { id: c.dataset.world, dx: r.left + r.width / 2 - p.x, dy: r.top - (p.y + p.radius), width: r.width, height: r.height, opacity: Number(getComputedStyle(c).opacity) }
      })
    })
    const check = (captions, when) => {
      assert.ok(captions.length > 0, `${name}: captions are shown ${when}`)
      for (const c of captions) {
        assert.ok(Math.abs(c.dx) <= 1, `${name}: the ${c.id} caption is centred under its planet ${when} (${c.dx.toFixed(2)} px off)`)
        assert.ok(Math.abs(c.dy - GAP) <= 1, `${name}: the ${c.id} caption sits ${GAP} px below its planet ${when} (${c.dy.toFixed(2)} px)`)
      }
    }
    assert.equal(await page.evaluate(() => document.querySelectorAll('.galaxy-labels .s3-plate, .galaxy-labels .s3-leader').length), 0, `${name}: no plates or leaders`)
    for (let sample = 0; sample < 3; sample++) { check(await measure(), 'settled'); await page.waitForTimeout(400) }
    await page.screenshot({ path: `${out}/check-${name}.png` })
    // While the view is dragged, several frames: the captions stay with their planets.
    const from = { x: width * 0.5, y: height * 0.22 }
    const cdp = phone ? await context.newCDPSession(page) : null
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
    for (let step = 1; step <= 6; step++) {
      const at = { x: from.x + step * 18, y: from.y + step * 4 }
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] })
      else await page.mouse.move(at.x, at.y)
      await page.waitForTimeout(60)
      check(await measure(), `while dragged (step ${step})`)
    }
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    else await page.mouse.up()
    await page.waitForTimeout(1500)
    // Pointing at a planet raises only its caption's opacity: same place, same size.
    const target = await page.evaluate(() => { const p = window.syn3h.shell.galaxy.screen.find(s => s.visible && s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight && s.radius > 4); return { id: p.id, x: p.x, y: p.y } })
    const before = (await measure()).find(c => c.id === target.id)
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y }] })
    else await page.mouse.move(target.x, target.y)
    await page.waitForTimeout(500)
    const pointed = await page.evaluate(() => document.querySelector('.galaxy-label.is-pointed')?.dataset.world)
    const after = (await measure()).find(c => c.id === pointed)
    assert.ok(after, `${name}: pointing near ${target.id} points at a world with a caption`)
    const was = pointed === target.id ? before : after
    assert.ok(after.opacity > 0.97, `${name}: pointing brings the ${pointed} caption to full strength (${after.opacity.toFixed(2)})`)
    assert.ok(Math.abs(after.width - was.width) < 0.5 && Math.abs(after.height - was.height) < 0.5, `${name}: pointing does not resize the ${pointed} caption`)
    check([after], 'while pointed at')
    await page.screenshot({ path: `${out}/point-${name}.png` })
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    else await page.mouse.move(2, 2)
    await page.evaluate(id => document.querySelector(`.galaxy-label[data-world="${id}"]`).focus(), target.id)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/focus-${name}.png` })
    if (!phone) {
      // Occlusion, constructed: the galaxy's layout is held, two planets are placed so the
      // nearer one's disc covers half of the farther one's caption, and the canvas is hidden
      // so only caption pixels show. Inside the nearer disc no caption pixel may show; outside
      // it the caption must; and the nearer caption is stacked above the farther one.
      const geometry = await page.evaluate(() => {
        const g = window.syn3h.shell.galaxy, layout = g.options.onLayout
        g.options.onLayout = () => {}
        const chips = [...document.querySelectorAll('.galaxy-label')], [a, b] = chips.map(c => c.dataset.world)
        const far = { id: a, x: 400, y: 300, radius: 24, visible: true, depth: 20 }, near = { id: b, x: 400 - 60, y: 345, radius: 30, visible: true, depth: 10 }
        const rest = chips.slice(2).map(c => ({ id: c.dataset.world, x: -500, y: -500, radius: 5, visible: false, depth: 50 }))
        layout([far, near, ...rest])
        document.querySelector('.galaxy-canvas').style.visibility = 'hidden'; document.body.style.background = '#000'
        for (const el of document.querySelectorAll('.lobby-brand, .galaxy-links, .lobby-gear-dock, .shell-version')) el.style.visibility = 'hidden'
        const r = document.querySelector(`.galaxy-label[data-world="${a}"]`).getBoundingClientRect()
        const za = Number(getComputedStyle(document.querySelector(`.galaxy-label[data-world="${a}"]`)).zIndex), zb = Number(getComputedStyle(document.querySelector(`.galaxy-label[data-world="${b}"]`)).zIndex)
        return { box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, near, za, zb }
      })
      assert.ok(geometry.zb > geometry.za, `${name}: the nearer planet's caption is stacked above the farther one's`)
      await page.waitForTimeout(500)
      const shot = await page.screenshot({ clip: { x: geometry.box.left, y: geometry.box.top, width: geometry.box.right - geometry.box.left, height: geometry.box.bottom - geometry.box.top }, scale: 'css' })
      await page.screenshot({ path: `${out}/occlusion-${name}.png`, clip: { x: geometry.box.left - 40, y: geometry.box.top - 60, width: geometry.box.right - geometry.box.left + 80, height: 120 } })
      const { inside, outside } = await page.evaluate(async ({ data, box, near }) => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
        const px = ctx.getImageData(0, 0, c.width, c.height).data, sx = img.width / (box.right - box.left)
        let inside = 0, outside = 0
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          const v = px[(y * img.width + x) * 4], cx = box.left + x / sx, cy = box.top + y / sx, d = Math.hypot(cx - near.x, cy - near.y) - near.radius
          if (d < -1.5) inside = Math.max(inside, v); else if (d > 1.5) outside = Math.max(outside, v)
        }
        return { inside, outside }
      }, { data: shot.toString('base64'), box: geometry.box, near: geometry.near })
      assert.ok(inside < 24, `${name}: no caption pixel shows inside the nearer planet's disc (brightest ${inside})`)
      assert.ok(outside > 80, `${name}: the uncovered part of the caption still shows (brightest ${outside})`)
    }
    assert.deepEqual(errors, [])
    console.log(`${name}: captions under their planets, settled and dragged; pointing at ${pointed} lifts ${was.opacity.toFixed(2)} to ${after.opacity.toFixed(2)} PASS`)
    await context.close()
  }
} finally { await browser.close() }
