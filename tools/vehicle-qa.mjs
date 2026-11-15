/** Run 24 real-browser driving cases. Usage: node tools/vehicle-qa.mjs [base URL] [output directory].
 * Each case starts in a fresh context, selects quality, waits for the spawn to settle,
 * then drives for 20 seconds. No room traffic. Results retain actual quality and simulation
 * duration because automatic quality reduction and slow rendering must remain visible.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const base = process.argv[2] ?? 'http://localhost:5186/'
const output = process.argv[3] ?? '/tmp/syn3h-vehicle-qa'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = [], sheets = {}
try {
  for (const kind of ['buggy', 'jet', 'hovercraft']) for (const seed of [1, 42, 2024]) for (const quality of [0, 2]) {
    const label = `${kind}-seed${seed}-gfx${quality}`, errors = [], pictures = []
    const context = await browser.newContext({ viewport: { width: 800, height: 450 } })
    await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    const url = new URL(base); url.search = new URLSearchParams({ autoplay: '1', vehicle: kind, seed: String(seed) }).toString()
    const result = { kind, seed, quality, url: url.href, errors }
    try {
      await page.goto(url.href)
      await page.waitForFunction(() => window.syn3h?.game?.tick > 10, null, { timeout: 60000 })
      await page.evaluate(q => { const s = window.syn3h; s.shell.play(); s.params.set('gfx.level', q); s.params.set('bots.count', 0); document.activeElement?.blur?.() }, quality)
      await page.waitForTimeout(1500)
      await page.evaluate(kind => {
        const s = window.syn3h, samples = []
        const start = performance.now(), simStart = s.game.time
        const sample = () => {
          const p = s.player.body.translation(), v = s.player.body.linvel()
          samples.push({ ms: performance.now()-start, sim: s.game.time-simStart, position: { ...p }, quaternion: { ...s.player.body.rotation() }, speed: Math.hypot(v.x,v.y,v.z), height: p.y-s.terrain.heightAt(p.x,p.z), grounded: s.player.wheelsGrounded, quality: s.params.get('gfx.level').value })
        }
        const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
        sample(); key(kind === 'jet' ? 'KeyR' : 'KeyW', true)
        const timers = kind === 'jet' ? [] : [setTimeout(() => key('KeyA', true), 7000), setTimeout(() => key('KeyA', false), 8500), setTimeout(() => key('KeyD', true), 12000), setTimeout(() => key('KeyD', false), 13500)]
        const timer = setInterval(sample, 100)
        window.qa = { samples, start, stop() { sample(); clearInterval(timer); timers.forEach(clearTimeout); for (const k of ['KeyW','KeyR','KeyA','KeyD']) key(k,false); return { samples, size: s.terrain.size, backend: s.game.backend } } }
      }, kind)
      for (const ms of [0, 10000, 20000]) {
        const delay = await page.evaluate(ms => Math.max(0, ms-(performance.now()-window.qa.start)), ms)
        if (delay) await page.waitForTimeout(delay)
        const png = await page.screenshot({ path: join(output, `${label}-${ms}.png`) })
        pictures.push({ label: `${label} / ${ms/1000}s`, image: png.toString('base64') })
      }
      const trace = await page.evaluate(() => window.qa.stop())
      Object.assign(result, trace)
      const first = trace.samples[0], last = trace.samples.at(-1)
      result.checks = {
        cleanLoad: errors.length === 0,
        groundedSpawn: first.grounded > 0 || Math.abs(first.height) < 5,
        moves: Math.hypot(last.position.x-first.position.x,last.position.y-first.position.y,last.position.z-first.position.z) > 3,
        stable: trace.samples.every(s => Number.isFinite(s.speed) && s.speed < 500 && s.height > -5 && Object.values(s.position).every(v => Number.isFinite(v) && Math.abs(v) < trace.size*4)),
      }
    } catch (error) { errors.push(String(error)); result.checks = { cleanLoad: false, groundedSpawn: false, moves: false, stable: false } }
    results.push(result); (sheets[kind] ??= []).push(...pictures)
    await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
    console.log(label, JSON.stringify(result.checks), errors.length ? errors : '')
    await context.close()
  }
  const page = await browser.newPage()
  for (const [kind, entries] of Object.entries(sheets)) {
    const data = await page.evaluate(async entries => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = Math.ceil(entries.length/3)*202
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#151219'; ctx.fillRect(0,0,canvas.width,canvas.height)
      for (let i=0;i<entries.length;i++) {
        const entry = entries[i], image = new Image(); image.src = `data:image/png;base64,${entry.image}`; await image.decode()
        const x=i%3*320,y=Math.floor(i/3)*202; ctx.drawImage(image,x,y,320,180);ctx.fillStyle='#fff';ctx.font='11px monospace';ctx.fillText(entry.label,x+4,y+195)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    }, entries)
    await writeFile(join(output, `${kind}-contact-sheet.png`), Buffer.from(data,'base64'))
  }
} finally { await browser.close() }
console.log(`Results and four contact sheets: ${output}`)
if (results.some(r => Object.values(r.checks).some(v => !v))) process.exitCode = 1
