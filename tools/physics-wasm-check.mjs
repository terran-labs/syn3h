/**
 * Production-build check that the physics engine's WebAssembly ships and loads as its own file.
 *
 *   tools/heavy.sh node tools/physics-wasm-check.mjs URL DIST [chrome|webkit|both] [shot dir]
 *
 * URL serves the built game (vite preview, wrangler dev or the stable server); DIST is the
 * build directory it serves. Static part: no script in DIST carries a base64 run of 100 KB or
 * more, there is exactly one Rapier .wasm of the package's size, and index.html starts its
 * download from the head.
 * In each browser: a healthy start fetches that file once, served as application/wasm, and
 * compiles it by streaming, never from bytes decoded in the page; with the file blocked the
 * page shows the reload message and button, the game is never started and no animation frame
 * loop is left running, and the button reloads into a working game.
 * Prints one JSON line per case and exits non zero if anything fails.
 */
import { chromium, webkit } from 'playwright-core'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const [base, dist, which = 'both', shots = '/tmp/physics-wasm-check'] = process.argv.slice(2)
if (!base || !dist) { console.error('usage: physics-wasm-check.mjs URL DIST [chrome|webkit|both] [shot dir]'); process.exit(2) }
await mkdir(shots, { recursive: true })
let failed = 0
const report = (row, pass) => { if (!pass) failed++; console.log(JSON.stringify({ pass, ...row })) }

// ---- Static: what the build contains ----
const assets = readdirSync(join(dist, 'assets'))
const scripts = assets.filter(f => f.endsWith('.js')).map(f => ({ file: f, text: readFileSync(join(dist, 'assets', f), 'utf8') }))
const inlined = scripts.filter(s => /[A-Za-z0-9+/=]{100000,}/.test(s.text)).map(s => s.file)
const wasm = assets.filter(f => f.endsWith('.wasm'))
const wasmBytes = wasm.map(f => statSync(join(dist, 'assets', f)).size)
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const head = html.slice(0, html.indexOf('</head>'))
const preload = wasm.length === 1 && head.includes(`window.__miraPhysicsWasm={url:"/assets/${wasm[0]}",response:fetch("/assets/${wasm[0]}")`) && !/rel="preload"[^>]+\.wasm/.test(html)
report({ case: 'build contents', scripts: scripts.map(s => ({ file: s.file, bytes: Buffer.byteLength(s.text) })), inlinedOver100KB: inlined, wasm, wasmBytes, earlyFetchInHead: preload },
  inlined.length === 0 && wasm.length === 1 && /^rapier_wasm3d_bg-[\w-]+\.wasm$/.test(wasm[0]) && wasmBytes[0] === 3082103 && preload)

// ---- In the browser ----
/** Records how WebAssembly is compiled and how many animation frame callbacks run. */
const watch = () => {
  const w = window; w.__wasm = []; w.__frames = 0
  const size = x => x instanceof ArrayBuffer || ArrayBuffer.isView(x) ? x.byteLength : 0
  const kind = x => x instanceof Response || (x && typeof x.then === 'function') ? 'response' : x instanceof WebAssembly.Module ? 'module' : 'bytes'
  for (const name of ['compileStreaming', 'instantiateStreaming', 'compile', 'instantiate']) {
    const original = WebAssembly[name]; if (typeof original !== 'function') continue
    WebAssembly[name] = function (source, ...rest) { w.__wasm.push({ api: name, from: kind(source), bytes: size(source) }); return original.call(WebAssembly, source, ...rest) }
  }
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = callback => raf(time => { w.__frames++; callback(time) })
}
const sep = base.includes('?') ? '&' : '?'
for (const name of which === 'both' ? ['chrome', 'webkit'] : [which]) {
  const browser = name === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  try {
    for (const blocked of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1194, height: 834 } })
      const page = await context.newPage(), errors = [], responses = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('response', r => { if (/\.wasm(\?|$)/.test(r.url())) responses.push({ status: r.status(), type: r.headers()['content-type'] ?? '', path: new URL(r.url()).pathname }) })
      await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
      await page.addInitScript(watch)
      if (blocked) await page.route(/\.wasm(\?|$)/, route => route.abort())
      const started = Date.now()
      await page.goto(`${base}${sep}room=physics-${Date.now()}`)
      if (!blocked) {
        const ok = await page.waitForFunction(() => window.mira?.game?.tick > 5, null, { timeout: 90000 }).then(() => true, () => false)
        const s = await page.evaluate(() => ({ wasm: window.__wasm, tick: window.mira?.game?.tick, backend: window.mira?.game?.backend, fatal: getComputedStyle(document.getElementById('fatal')).display,
          phases: (window.miraStartup?.phases ?? []).filter(p => /physics|quality initialise|renderer\.init|fetch and run|game\.start/.test(p.name)).map(p => ({ name: p.name, startMs: Math.round(p.startMs), ms: Math.round(p.ms) })),
          firstDrawMs: window.mira?.game?.performance?.firstFrameMs ?? null }))
        await page.screenshot({ path: `${shots}/${name}-healthy.png` })
        const streamed = s.wasm.filter(c => c.api === 'compileStreaming' && c.from === 'response').length === 1
        const fromBytes = s.wasm.filter(c => c.from === 'bytes' && c.bytes > 100000)
        report({ browser: name, case: 'healthy start', loadMs: Date.now() - started, responses, compiles: s.wasm, backend: s.backend, phases: s.phases, firstDrawMs: s.firstDrawMs, errors },
          ok && streamed && fromBytes.length === 0 && responses.length === 1 && responses[0].status === 200 && /^application\/wasm\b/.test(responses[0].type) && s.fatal === 'none' && !errors.length)
      } else {
        const shown = await page.waitForFunction(() => getComputedStyle(document.getElementById('fatal')).display !== 'none', null, { timeout: 90000 }).then(() => true, () => false)
        await page.waitForTimeout(500)
        const before = await page.evaluate(() => window.__frames)
        await page.waitForTimeout(1500)
        const s = await page.evaluate(() => ({ frames: window.__frames, text: document.getElementById('fatal').textContent, button: document.querySelector('#fatal button')?.textContent ?? null, game: typeof window.mira, shell: !!document.querySelector('.mira-shell') }))
        await page.screenshot({ path: `${shots}/${name}-blocked.png` })
        // The only way on is the button: with the file reachable again it reloads into a running game.
        await page.unroute(/\.wasm(\?|$)/)
        await page.click('#fatal button')
        const recovered = await page.waitForFunction(() => window.mira?.game?.tick > 5, null, { timeout: 90000 }).then(() => true, () => false)
        report({ browser: name, case: 'physics file blocked', message: s.text, button: s.button, framesDuring1500ms: s.frames - before, gameStarted: s.game !== 'undefined', lobbyBuilt: s.shell, reloadRecovered: recovered, errors },
          shown && /physics engine could not be loaded/i.test(s.text ?? '') && /reload/i.test(s.text ?? '') && s.button === 'Reload' && s.frames === before && s.game === 'undefined' && !s.shell && recovered)
      }
      await context.close()
    }
  } finally { await browser.close() }
}
process.exit(failed ? 1 : 0)
