/**
 * Bloom check: does it work, how does it look, and does it switch off cleanly.
 *
 *   tools/heavy.sh node tools/bloom-check.mjs URL [chrome|webkit|both] [out dir] [effects]
 *
 * effects is the query that switches the stack on, default 'bloom=0.5'; for the whole stack
 * use 'bloom=0.5&shafts=0.6&grade=0.5&vignette=0.4'. Times are noon, a low sun (18.6 h, the
 * camera turned to face it, for shafts) and midnight.
 *
 * For each browser and backend (WebGPU, then WebGL 2 with ?webgl=1): day and night, bloom off
 * and on, screenshots plus two numbers per shot: mean brightness and the share of pixels that
 * are nearly white (all channels above 250), the measure of the old night bleaching bug. Then
 * the lifecycle: dropping to graphics level 1 must release the pipeline and render the plain
 * path; returning to 2 must rebuild it. Exits non zero on any page error or failed check.
 */
import { chromium, webkit } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'

const base = process.argv[2] ?? 'http://127.0.0.1:5213/'
const which = process.argv[3] ?? 'both'
const out = process.argv[4] ?? '/tmp/bloom-check'
const effects = process.argv[5] ?? 'bloom=0.5'
const tag = effects.replace(/[^a-z0-9.]+/gi, '-')
await mkdir(out, { recursive: true })
const sep = base.includes('?') ? '&' : '?'
const results = []
let failed = 0

async function stats(browser, png) {
  // Decode the screenshot in a blank page; no image library needed.
  const page = await browser.newPage()
  try {
    return await page.evaluate(async b64 => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      let sum = 0, white = 0
      for (let i = 0; i < data.length; i += 4) { sum += (data[i] + data[i + 1] + data[i + 2]) / 3; if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) white++ }
      const n = data.length / 4
      return { mean: +(sum / n).toFixed(2), whitePct: +(100 * white / n).toFixed(3) }
    }, png.toString('base64'))
  } finally { await page.close() }
}

for (const name of which === 'both' ? ['chrome', 'webkit'] : [which]) {
  const browser = name === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  try {
    for (const backend of ['webgpu', 'webgl']) {
      for (const time of ['day', 'low', 'night']) {
        for (const on of [false, true]) {
          const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
          const page = await context.newPage()
          const errors = []
          page.on('pageerror', e => errors.push(e.message))
          page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
          await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
          const query = [`room=bloom-${Date.now()}`, 'autoplay=1', 'gfx=2', on ? effects : '', backend === 'webgl' ? 'webgl=1' : ''].filter(Boolean).join('&')
          await page.goto(`${base}${sep}${query}`)
          await page.waitForFunction(() => window.syn3h?.game?.tick > 30, null, { timeout: 60000 }).catch(e => errors.push(e.message))
          await page.evaluate(async time => {
            const s = window.syn3h; s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', { day: 12, low: 18.6, night: 0 }[time])
            s.game.quality.frame = () => {}
            if (time !== 'low') return
            // Turn the vehicle (and so the chase camera) to face the sun: the heading whose
            // projected sun is nearest the middle of the screen.
            const sky = s.game.scene.children.find(o => 'sunDirection' in o), d = sky.sunDirection.value, p = s.player.body.translation()
            let best = 0, bestScore = Infinity
            for (let i = 0; i < 16; i++) {
              const h = i * Math.PI / 8
              s.player.teleport({ x: p.x, y: p.y + 0.5, z: p.z }, h)
              await new Promise(r => setTimeout(r, 250))
              const cam = s.game.camera, v = d.clone().multiplyScalar(cam.far * 0.5).add(cam.position).project(cam)
              const front = d.clone().applyMatrix4(cam.matrixWorldInverse.clone().setPosition(0, 0, 0)).z < 0
              const score = front ? Math.abs(v.x) : Infinity
              if (score < bestScore) { bestScore = score; best = h }
            }
            s.player.teleport({ x: p.x, y: p.y + 0.5, z: p.z }, best)
          }, time)
          // Let auto exposure settle after the time change.
          await page.waitForTimeout(3000)
          const state = await page.evaluate(() => ({ backend: window.syn3h.game.backend, level: window.syn3h.params.get('gfx.level').value, deviceLevel: window.syn3h.game.quality.deviceLevel, bloomActive: !!window.syn3h.game.post?.active, bloomObject: window.syn3h.game.post !== null, effects: window.syn3h.game.post?.effects?.join(','), textures: window.syn3h.game.renderer.info.memory.textures, exposure: window.syn3h.game.renderer.toneMappingExposure, toneMapping: window.syn3h.game.renderer.toneMapping, curve: window.syn3h.params.get('world.curve')?.value, firstRender: window.syn3hStartup?.phases.find(p => p.name.startsWith('frame 1 render call'))?.ms }))
          const file = `${out}/${name}-${backend}-${time}-${on ? tag : 'off'}.png`
          const png = await page.screenshot({ path: file })
          const image = await stats(browser, png)
          let lifecycle
          if (on) {
            lifecycle = await page.evaluate(async () => {
              const s = window.syn3h, g = s.game
              // Wait for real frames, not wall time: a loaded machine may draw few.
              const wait = async () => { const t = g.tick; await new Promise(r => setTimeout(r, 300)); while (g.tick < t + 10) await new Promise(r => requestAnimationFrame(r)) }
              const before = { active: g.post.active, builds: g.post.builds, textures: g.renderer.info.memory.textures }
              s.params.set('gfx.level', 1); await wait()
              const dropped = { active: g.post.active, builds: g.post.builds, textures: g.renderer.info.memory.textures }
              s.params.set('gfx.level', 2); await wait()
              const back = { active: g.post.active, builds: g.post.builds }
              const ids = ['gfx.bloom', 'gfx.shafts', 'gfx.grade', 'gfx.vignette'], saved = ids.map(id => s.params.get(id).value)
              for (const id of ids) s.params.set(id, 0)
              await wait()
              const zero = { active: g.post.active }
              ids.forEach((id, i) => s.params.set(id, saved[i])); await wait()
              return { before, dropped, back, zero, again: g.post.active }
            })
          }
          const expectActive = on && state.deviceLevel === 2
          const lifecycleOk = !on || !expectActive || (lifecycle.before.active && !lifecycle.dropped.active && lifecycle.back.active && lifecycle.back.builds === lifecycle.before.builds + 1 && !lifecycle.zero.active && lifecycle.again)
          const pass = !errors.length && state.bloomActive === expectActive && (on || !state.bloomObject) && lifecycleOk && state.backend === backend
          if (!pass) failed++
          const row = { browser: name, backend, time, effects: on ? effects : 'off', pass, load: +loadavg()[0].toFixed(2), ...state, ...image, lifecycle, errors: errors.slice(0, 5), file }
          results.push(row)
          console.log(JSON.stringify(row))
          await context.close()
        }
      }
    }
  } finally { await browser.close() }
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
if (failed) { console.log(`BLOOM CHECK FAILED: ${failed}`); process.exit(1) }
console.log('BLOOM CHECK OK')
