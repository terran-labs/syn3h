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
 * compiles it by streaming, never from bytes decoded in the page. With the first two requests
 * failed (phone and desktop) the veil shows the retry line and the game starts by itself, the
 * retries bypassing the cache and the engine instantiated once. With every request failed the
 * veil, still up and with no error card, shows the final message and Try again after five
 * tries; with the file reachable again Try again starts the game without a reload.
 * Screenshots of each in the shot directory.
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
  // The cache mode of each request for the engine: a retry must bypass the HTTP cache.
  w.__wasmFetches = []
  const get = w.fetch.bind(w)
  w.fetch = (input, init) => { if (/\.wasm(\?|$)/.test(String(input?.url ?? input))) w.__wasmFetches.push(init?.cache ?? 'default'); return get(input, init) }
  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = callback => raf(time => { w.__frames++; callback(time) })
}
const sep = base.includes('?') ? '&' : '?'
const SIZES = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, desktop: { viewport: { width: 1280, height: 800 } } }
const WASM = /\.wasm(\?|$)/
const started = page => page.waitForFunction(() => window.mira?.game?.tick > 5, null, { timeout: 90000 }).then(() => true, () => false)
const instantiations = s => s.filter(c => c.api === 'instantiate' || c.api === 'instantiateStreaming').length
for (const name of which === 'both' ? ['chrome', 'webkit'] : [which]) {
  const browser = name === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  try {
    // healthy: one request, streamed. flaky: the first two requests fail, and it recovers by
    // itself. blocked: every request fails, the veil offers Try again, which recovers.
    const cases = [['healthy', 'desktop'], ['flaky', 'phone'], ['flaky', 'desktop'], ['blocked', 'phone'], ['blocked', 'desktop']]
    for (const [kind, size] of cases) {
      const context = await browser.newContext(SIZES[size])
      const page = await context.newPage(), errors = [], responses = [], requests = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('request', r => { if (WASM.test(r.url())) requests.push(r.url()) })
      page.on('response', r => { if (WASM.test(r.url())) responses.push({ status: r.status(), type: r.headers()['content-type'] ?? '', path: new URL(r.url()).pathname }) })
      await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
      await page.addInitScript(watch)
      let failures = kind === 'flaky' ? 2 : kind === 'blocked' ? Infinity : 0
      await page.route(WASM, route => { if (failures > 0) { failures--; return route.abort() } return route.continue() })
      const t0 = Date.now(), tag = `${name}-${size}-${kind}`
      await page.goto(`${base}${sep}room=physics-${Date.now()}`)
      const veil = () => page.evaluate(() => ({ boot: document.documentElement.dataset.boot, retry: document.documentElement.dataset.bootRetry ?? null, line: document.querySelector('.boot-status')?.textContent ?? null, lineOpacity: getComputedStyle(document.querySelector('.boot-status')).opacity, button: document.querySelector('.boot-retry')?.textContent ?? null, fatal: getComputedStyle(document.getElementById('fatal')).display }))
      if (kind === 'healthy') {
        const ok = await started(page)
        const s = await page.evaluate(() => ({ wasm: window.__wasm, backend: window.mira?.game?.backend, fatal: getComputedStyle(document.getElementById('fatal')).display,
          phases: (window.miraStartup?.phases ?? []).filter(p => /physics|quality initialise|renderer\.init|fetch and run|game\.start/.test(p.name)).map(p => ({ name: p.name, startMs: Math.round(p.startMs), ms: Math.round(p.ms) })),
          firstDrawMs: window.mira?.game?.performance?.firstFrameMs ?? null }))
        await page.screenshot({ path: `${shots}/${tag}.png` })
        const streamed = s.wasm.filter(c => c.api === 'compileStreaming' && c.from === 'response').length === 1
        const fromBytes = s.wasm.filter(c => c.from === 'bytes' && c.bytes > 100000)
        report({ browser: name, size, case: 'healthy start', loadMs: Date.now() - t0, responses, compiles: s.wasm, backend: s.backend, phases: s.phases, firstDrawMs: s.firstDrawMs, errors },
          ok && streamed && fromBytes.length === 0 && responses.length === 1 && responses[0].status === 200 && /^application\/wasm\b/.test(responses[0].type) && s.fatal === 'none' && !errors.length)
      } else if (kind === 'flaky') {
        // The retry line, shown on the veil while it waits to try again.
        const sawLine = await page.waitForFunction(() => document.documentElement.dataset.bootRetry === 'retrying', null, { timeout: 30000 }).then(() => true, () => false)
        await page.waitForTimeout(450) // the line's 0.4 s fade
        const during = await veil()
        await page.screenshot({ path: `${shots}/${tag}-retrying.png` })
        const ok = await started(page)
        const after = await page.evaluate(() => ({ wasm: window.__wasm, fetches: window.__wasmFetches, retry: document.documentElement.dataset.bootRetry ?? null, fatal: getComputedStyle(document.getElementById('fatal')).display }))
        report({ browser: name, size, case: 'first two downloads fail', loadMs: Date.now() - t0, during, requests: requests.length, cacheModes: after.fetches, responses, instantiations: instantiations(after.wasm), errors },
          sawLine && /did not download\. Trying again/.test(during.line ?? '') && Number(during.lineOpacity) > 0.9 && during.button === null && during.fatal === 'none' && during.boot !== 'done'
          && ok && requests.length === 3 && after.fetches.join() === 'default,reload,reload' && instantiations(after.wasm) === 1 && after.retry === null && after.fatal === 'none' && !errors.length)
      } else {
        // Five tries with their waits: the final message and Try again, the veil still up, no error card.
        const shown = await page.waitForSelector('.boot-retry', { timeout: 90000 }).then(() => true, () => false)
        await page.waitForTimeout(450)
        const final = await veil(), tries = requests.length
        await page.screenshot({ path: `${shots}/${tag}-final.png` })
        failures = 0
        await page.click('.boot-retry')
        const ok = await started(page)
        const after = await page.evaluate(() => ({ wasm: window.__wasm, fatal: getComputedStyle(document.getElementById('fatal')).display }))
        report({ browser: name, size, case: 'every download fails, then Try again', final, triesBeforeFinal: tries, requests: requests.length, instantiations: instantiations(after.wasm), recovered: ok, errors },
          shown && /could not be downloaded/.test(final.line ?? '') && final.button === 'Try again' && final.retry === 'failed' && final.boot !== 'done' && final.fatal === 'none'
          && tries === 5 && ok && requests.length === 6 && instantiations(after.wasm) === 1 && after.fatal === 'none' && !errors.length)
      }
      await context.close()
    }
  } finally { await browser.close() }
}
process.exit(failed ? 1 : 0)
