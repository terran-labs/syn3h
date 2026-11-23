/**
 * Real-browser check of bounded graphics startup and device-loss recovery.
 *
 *   tools/heavy.sh node tools/startup-fallback-check.mjs URL [chrome|webkit|both] [shot dir]
 *
 * Cases: healthy start, a stalled adapter probe, a stalled device request (the renderer's
 * own init stalls), a real WebGL context loss and a simulated WebGPU device loss. Prints one
 * JSON line per case and exits non zero if any case fails.
 */
import { chromium, webkit } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5210/'
const which = process.argv[3] ?? 'both'
const shots = process.argv[4] ?? '/tmp/startup-fallback'
await mkdir(shots, { recursive: true })
const sep = base.includes('?') ? '&' : '?'
const stallAdapter = () => { if (navigator.gpu) navigator.gpu.requestAdapter = () => new Promise(() => {}) }
const stallDevice = () => {
  if (!navigator.gpu) return
  const request = navigator.gpu.requestAdapter.bind(navigator.gpu)
  // The quality probe passes powerPreference; three passes featureLevel. Stall only three's device.
  navigator.gpu.requestAdapter = async options => { const a = await request(options); if (a && options?.featureLevel) a.requestDevice = () => new Promise(() => {}); return a }
}
const cases = [
  // The ?diag=1 overlay this case also read (a `details pre`) moved into the quality controller on
  // 15 November (ddc6ee9a); a healthy start is the right backend and no fallback.
  { name: 'healthy', query: 'diag=1', expect: s => s.backend === (s.gpu ? 'webgpu' : 'webgl') && !s.fallbackReason },
  { name: 'stalled adapter probe', query: 'gpudeadline=1500', init: stallAdapter, expect: s => s.backend === 'webgl' && /probe stalled/.test(s.fallbackReason ?? '') },
  { name: 'stalled device request', query: 'gpudeadline=1500', init: stallDevice, needsGpu: true, expect: s => s.backend === 'webgl' && /longer than 1500 ms/.test(s.fallbackReason ?? '') && s.canvases === 1 },
  { name: 'WebGL context lost', query: 'webgl=1', lose: 'webgl', expect: s => s.notice?.includes('WebGL context was lost') && s.reloadButton },
  { name: 'WebGPU device lost (simulated callback)', query: '', lose: 'webgpu', needsGpu: true, expect: s => s.notice?.includes('graphics device was lost') && s.reloadButton },
]
let failed = 0
for (const name of which === 'both' ? ['chrome', 'webkit'] : [which]) {
  const browser = name === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  try {
    for (const c of cases) {
      const context = await browser.newContext({ viewport: { width: 1194, height: 834 } })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
      if (c.init) await page.addInitScript(c.init)
      const started = Date.now()
      await page.goto(`${base}${sep}room=fallback-${Date.now()}${c.query ? `&${c.query}` : ''}`)
      const ok = await page.waitForFunction(() => window.mira?.game?.tick > 5, null, { timeout: 60000 }).then(() => true, () => false)
      const gpu = await page.evaluate(() => !!navigator.gpu)
      if (c.needsGpu && !gpu) { console.log(JSON.stringify({ browser: name, case: c.name, skipped: 'no navigator.gpu' })); await context.close(); continue }
      if (c.lose === 'webgl') await page.evaluate(() => window.mira.game.renderer.backend.gl.getExtension('WEBGL_lose_context').loseContext())
      if (c.lose === 'webgpu') await page.evaluate(() => window.mira.game.renderer.onDeviceLost({ api: 'WebGPU', message: 'simulated by startup-fallback-check', reason: 'unknown' }))
      if (c.lose) await page.waitForTimeout(500)
      const s = await page.evaluate(() => ({
        backend: window.mira?.game?.backend, gpu: !!navigator.gpu, fallbackReason: window.miraStartup?.fallbackReason,
        deviceLost: window.miraStartup?.deviceLost, canvases: document.querySelectorAll('canvas#game').length,
        notice: document.getElementById('mira-device-lost')?.textContent, reloadButton: !!document.querySelector('#mira-device-lost button'),
        overlay: document.querySelector('details pre')?.textContent?.slice(0, 4000) ?? '',
        firstDraw: window.mira?.game?.performance?.firstFrameMs,
      }))
      const shot = `${shots}/${name}-${c.name.replace(/\W+/g, '-')}.png`
      await page.screenshot({ path: shot })
      const pass = ok && c.expect(s) && !errors.length
      if (!pass) failed++
      console.log(JSON.stringify({ browser: name, case: c.name, pass, ms: Date.now() - started, backend: s.backend, fallbackReason: s.fallbackReason, deviceLost: s.deviceLost, notice: s.notice, firstDraw: s.firstDraw && Math.round(s.firstDraw), errors, shot }))
      await context.close()
    }
  } finally { await browser.close() }
}
if (failed) { console.log(`FALLBACK CHECK FAILED: ${failed}`); process.exit(1) }
console.log('FALLBACK CHECK OK')
