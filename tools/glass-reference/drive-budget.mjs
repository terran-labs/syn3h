// Against the local Vite game. Supply the origin and either webgpu or webgl.
// Only the budget's frame intervals are synthetic. Both composites draw on
// the real backend and its program creation hooks remain active throughout.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const [origin, backend] = process.argv.slice(2)
assert(['webgpu', 'webgl'].includes(backend))
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const url = new URL('/', origin)
  url.search = '?glass=inline&gfx=3&planet=alpine&seed=19' + (backend === 'webgl' ? '&webgl=1' : '')
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.shell.galaxy?.live)
  await page.evaluate(() => {
    window.syn3h.params.set('bots.count', 0)
    window.syn3h.bots.daydream.setBlocker(() => true)
    window.syn3h.game.quality.setAuto(false)
    window.syn3h.game.quality.setLevel(3)
    window.syn3h.shell.play(true)
  })
  await page.waitForFunction(() => document.documentElement.dataset.driveGlass === 'on' &&
    !window.syn3h.shell.transitioning && document.querySelector('.gs-item[data-glass-surface="shader"]'),
    undefined, { timeout: 90000 })
  const result = await page.evaluate(async () => {
    const { game } = window.syn3h
    const chain = game.postChain, glass = chain.glass
    const backend = game.renderer.backend, before = chain.builds
    const counters = { createRenderPipeline: 0, createNodeBuilder: 0 }
    for (const key of Object.keys(counters)) {
      const original = backend[key]
      backend[key] = function (...args) { counters[key]++; return original.apply(this, args) }
    }
    let clock = performance.now(), interval = 50
    const sample = glass.budget.sample.bind(glass.budget)
    glass.budget.interrupt()
    glass.budget.sample = () => sample(clock += interval)
    async function until(state) {
      const deadline = performance.now() + 60000
      while (document.documentElement.dataset.driveGlass !== state || glass.showing !== (state === 'on')) {
        if (performance.now() > deadline) throw Error('Timed out waiting for ' + state + ': ' + glass.diagnosticLine())
        await new Promise(requestAnimationFrame)
      }
      return { line: glass.diagnosticLine(), owned: !!document.querySelector('.gs-item[data-glass-surface="shader"]') }
    }
    const shed = await until('shed')
    interval = 16
    const recovered = await until('on')
    return { shed, recovered, backend: game.backend, graphs: chain.builds - before, ...counters }
  })
  console.log(JSON.stringify(result))
  assert.match(result.backend.toLowerCase(), backend === 'webgpu' ? /webgpu/ : /webgl/)
  assert.match(result.shed.line, /% of frames over 20.5 ms/)
  assert.match(result.recovered.line, /five calm seconds/)
  assert.equal(result.shed.owned, false)
  assert.equal(result.recovered.owned, true)
  assert.deepEqual([result.graphs, result.createRenderPipeline, result.createNodeBuilder], [0, 0, 0])
} finally { await browser.close() }
