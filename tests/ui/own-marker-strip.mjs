/**
 * Evidence for judging your own "it" marker against the middle of your view (not a test): the
 * owner, 19 November 2026, "it completely blocks whatever I'm aiming at at certain angles".
 * You are made "it"; the camera stands behind your car, as the chase camera does, at two
 * distances and a sweep of pitches; each frame shows the clear circle (hud.ownMarkerClear)
 * outlined in red round the centre, with the marker's lift and opacity under it.
 *
 *   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/own-marker-strip.mjs [out dir]
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const out = process.argv[2] ?? '/tmp/own-marker'
await mkdir(`${out}/raw`, { recursive: true })
const PITCHES = [-25, -10, 0, 8, 16, 30]
const DISTANCES = [8, 25]
const errors = [], summary = []
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [device, view] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const context = await browser.newContext(view)
    await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(`${device}: ${e.message}`))
    await page.goto(`${base}?planet=alpine&seed=7&autoplay=1&room=own-marker-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.shell?.playing && window.miraNet?.marker, null, { timeout: 120000 })
    await page.evaluate(() => {
      document.exitPointerLock?.()
      const s = window.mira, n = window.miraNet, p = s.params
      p.set('gfx.auto', false); p.set('daydream.seconds', 0); p.set('bots.count', 0); p.set('sun.dayLength', 0); p.set('sun.timeOfDay', 14)
      for (const node of document.body.children) if (node.tagName !== 'CANVAS' && node.tagName !== 'SCRIPT') node.style.visibility = 'hidden'
      // The camera: behind the car at `back` metres, `up` above, looking `pitch` degrees above
      // level. Placed just before the marker updates, so it solves against the camera drawn.
      const placeCam = () => {
        const c = window.__cam
        if (!c) return
        const v = s.player.object.position, cam = s.game.camera, h = (window.__heading ??= Math.atan2(cam.position.x - v.x, cam.position.z - v.z))
        cam.position.set(v.x + Math.sin(h) * c.back, v.y + c.up, v.z + Math.cos(h) * c.back)
        const r = c.pitch * Math.PI / 180
        cam.lookAt(cam.position.x - Math.sin(h) * Math.cos(r), cam.position.y + Math.sin(r), cam.position.z - Math.cos(h) * Math.cos(r))
        cam.updateMatrixWorld()
      }
      // You are "it", whatever the room says: the marker reads target and local each frame.
      const marker = n.marker, update = marker.update.bind(marker)
      marker.update = (dt, alpha) => { marker.target = marker.local = s.player; placeCam(); update(dt, alpha) }
      // The clear circle, outlined over the canvas.
      const ring = document.createElement('div')
      ring.style.cssText = 'position:fixed;left:50%;top:50%;border:2px solid rgba(255,40,40,.9);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:99'
      document.documentElement.appendChild(ring)
      window.__ring = ring
      // And again after everything else, so nothing later in the frame moves it.
      s.game.add({ update: placeCam })
    })
    await page.waitForTimeout(3000)
    for (const back of DISTANCES) for (const [i, pitch] of PITCHES.entries()) {
      await page.evaluate(([back, pitch]) => {
        window.__cam = { back, up: back * 0.35, pitch }
        const r = window.mira.params.get('hud.ownMarkerClear').value * innerHeight * 2
        window.__ring.style.width = window.__ring.style.height = `${r}px`
      }, [back, pitch])
      await page.waitForTimeout(600)
      const m = await page.evaluate(() => {
        const n = window.miraNet, mk = n.marker, s = window.mira
        const at = mk.mesh.position.clone().project(s.game.camera)
        return { lift: mk.mesh.position.y - s.player.object.position.y, opacity: mk.fade.value, beam: mk.beam.value, visible: mk.mesh.visible, screenY: at.y / 2 }
      })
      await writeFile(`${out}/raw/${device}-${back}-${i}.png`, await page.screenshot())
      summary.push(`${device} ${back} m, pitch ${pitch}: lift ${m.lift.toFixed(2)} m, opacity ${m.opacity.toFixed(2)}, beam ${m.beam.toFixed(2)}, marker centre ${(m.screenY * 100).toFixed(1)}% of height above the middle`)
      await writeFile(`${out}/raw/${device}-${back}-${i}.json`, JSON.stringify({ pitch, ...m }))
    }
    // One sheet per device: a row per distance, a frame per pitch.
    const rows = []
    for (const back of DISTANCES) {
      const cells = []
      for (const [i] of PITCHES.entries()) {
        const m = JSON.parse(await readFile(`${out}/raw/${device}-${back}-${i}.json`, 'utf8'))
        cells.push(`<figure><img src="data:image/png;base64,${(await readFile(`${out}/raw/${device}-${back}-${i}.png`)).toString('base64')}"><figcaption>pitch ${m.pitch}°: lift ${m.lift.toFixed(1)} m, opacity ${m.opacity.toFixed(2)}, beam ${m.beam.toFixed(2)}</figcaption></figure>`)
      }
      rows.push(`<div style="display:flex;align-items:center"><b style="width:70px;padding-left:8px">${back} m</b>${cells.join('')}</div>`)
    }
    const sheet = await browser.newPage({ viewport: { width: 1900, height: 600 } })
    await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px system-ui"><h3 style="margin:8px">${device}: your own "it" marker against the clear circle (red), by camera pitch and distance</h3>${rows.join('')}<style>figure{margin:3px}img{width:${device === 'phone' ? 140 : 290}px;display:block}figcaption{font-size:11px;text-align:center}</style></body>`)
    await sheet.screenshot({ path: `${out}/${device}.png`, fullPage: true })
    await sheet.close()
    await context.close()
  }
} finally { await browser.close() }
console.log(summary.join('\n'))
if (errors.length) { console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`); process.exit(1) }
console.log('OWN MARKER STRIP OK')
