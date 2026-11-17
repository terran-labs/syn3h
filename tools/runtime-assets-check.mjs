#!/usr/bin/env node
/**
 * Runtime asset gate for the owner's rule of 15 November 2026: "Binary assets in the codebase
 * are okay. Binary assets that get loaded into the running game are unacceptable."
 *
 * tools/check-shipped-assets.mjs looks at the files in dist. This script looks at what the
 * running game actually loads: it builds the tree, serves the production build with a local
 * room server, plays a scripted session in headless Chrome and records
 *
 *   - every network response (URL, resource type, content type, bytes), and
 *   - every run-time decode of inlined or generated binaries, through an init script that
 *     wraps fetch and XHR of data: and blob: URLs, URL.createObjectURL,
 *     decodeAudioData, createImageBitmap, image and media src assignments, FontFace,
 *     Worker and the WebAssembly compile and instantiate entry points.
 *
 * It exits 1 when any audio, image, video, model or font is loaded or decoded that is not on
 * ALLOWLIST below. WebAssembly is classed as code, and exactly one file of it is accepted: the
 * physics engine, fetched from its own hashed URL. Any other WebAssembly file, or WebAssembly
 * compiled from bytes held in the page (a binary inlined in a script), fails the gate.
 * SVG is a vector text format, not a bitmap: reported, never a failure. Images the game
 * draws itself (canvas toBlob, toDataURL, convertToBlob) are marked generated and pass.
 *
 *   tools/heavy.sh node tools/runtime-assets-check.mjs                  # this tree
 *   tools/heavy.sh node tools/runtime-assets-check.mjs --root ../other  # another tree
 *     --out report.json   where to write the JSON report (default /tmp/syn3h-asset-gate/report.json)
 *     --no-build          serve the existing dist instead of running vite build
 *     --drive 6           seconds of driving
 *
 * Exit codes: 0 clean, 1 forbidden assets loaded, 2 the session could not run.
 * Run it through tools/heavy.sh: it builds and drives a browser.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/**
 * What the running game may load. Each entry: the kind, a pattern tested against the URL path
 * (network) or the decode's source descriptor, why it is accepted, and whether the exception
 * is permanent or dated. Anything audio, image, video, model or font that matches no entry
 * fails the gate.
 */
export const ALLOWLIST = [
  // Permanent. The owner accepted the Barlow faces as the UI type (only the weights the CSS
  // uses; a declared face the page never renders is never downloaded, so this gate only
  // ever sees used weights). Licence: public/fonts/OFL-Barlow.txt.
  { kind: 'font', pattern: /^\/fonts\/barlow-(400|500|600)-latin\.woff2$/, why: 'Barlow UI text faces, owner accepted', term: 'permanent' },
  { kind: 'font', pattern: /^\/fonts\/barlow-condensed-(500|600)-latin\.woff2$/, why: 'Barlow Condensed headings, owner accepted', term: 'permanent' },
  // No model of any kind: every vehicle is generated in code (16 November 2026), so a model
  // request in ordinary play is a failure.
  // Permanent. Desktop Chrome itself fetches the apple-touch-icon named by the <link> tag in
  // index.html (resource type "other": the browser, not game code). The owner's brief accepts
  // icon link tags. It still costs that visitor 42 KB, so it stays visible in the report.
  // Permanent. Code, not an asset: the Rapier physics engine, shipped as its own hashed file
  // so it is not parsed as text inside the main script (tools/rapier-wasm.mjs).
  { kind: 'wasm', pattern: /^\/assets\/rapier_wasm3d_bg-[\w-]+\.wasm$/, why: 'Rapier physics engine, code, loaded from its own file', term: 'permanent' },
  { kind: 'image', type: 'other', pattern: /^\/brand\/(apple-touch-icon|icon-192|icon-512)\.png$/, why: 'install icon fetched by the browser from the index.html link tag, not by the game', term: 'permanent' },
]

/** Kinds that fail the gate unless allowed. */
export const BINARY_KINDS = new Set(['audio', 'image', 'video', 'model', 'font'])

/** Classify by MIME type first, then by file extension. */
export function classify(mime = '', path = '') {
  const m = mime.toLowerCase().split(';')[0].trim()
  const p = path.toLowerCase().split(/[?#]/)[0]
  if (m === 'image/svg+xml' || /\.svg$/.test(p)) return 'vector'
  if (m === 'application/wasm' || /\.wasm$/.test(p)) return 'wasm'
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|weba|mid|midi)$/.test(p)) return 'audio'
  if (m.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/.test(p)) return 'video'
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|ico|avif|tga|tiff?|ktx2?|hdr|exr|dds|basis)$/.test(p)) return 'image'
  if (m.startsWith('model/') || /\.(glb|gltf|bin|fbx|obj|usdz|drc)$/.test(p)) return 'model'
  if (m.startsWith('font/') || /font|woff/.test(m) || /\.(woff2?|ttf|otf|eot)$/.test(p)) return 'font'
  if (m.includes('javascript') || /\.m?js$/.test(p)) return 'script'
  if (m === 'text/css' || /\.css$/.test(p)) return 'style'
  if (m === 'text/html') return 'document'
  if (m.includes('json') || /\.json$|\.webmanifest$/.test(p)) return 'data'
  return m ? 'other' : 'unknown'
}

/** The allowlist entry that accepts this record, or null. */
export function allowed(record) {
  return ALLOWLIST.find((a) => a.kind === record.kind && (!a.type || a.type === record.type) && a.pattern.test(record.path ?? '')) ?? null
}

/** Records that fail the gate. */
export function violations(records) {
  return records.filter((r) => (BINARY_KINDS.has(r.kind) && !r.generated && !allowed(r)) || wasmViolation(r))
}

/**
 * WebAssembly must come from the one allowed URL. Instantiating an already compiled module is
 * the second half of that load and carries no bytes. Bytes compiled from a buffer were held in
 * the page, which is how a binary inlined in a script shows up.
 */
/**
 * A stream compiled from a Response the page built itself has no URL: the loading view's byte
 * counter (tools/rapier-wasm.mjs) re-wraps the engine's fetch to count it. Give such a decode
 * the path of the allowed WebAssembly fetch whose bytes it carries, so it is judged by where
 * those bytes came from. Bytes that match no allowed fetch stay pathless and still fail.
 */
export function attributeStreams(decodes, network) {
  for (const d of decodes) {
    if (d.kind !== 'wasm' || d.source !== 'stream' || d.path) continue
    const from = network.find((r) => r.kind === 'wasm' && r.bytes === d.bytes && allowed(r))
    if (from) { d.path = from.path; d.attributedBy = 'bytes of the allowed fetch' }
  }
  return decodes
}

export function wasmViolation(record) {
  if (record.kind !== 'wasm' || record.source === 'module') return false
  return record.source === 'buffer' || !allowed(record)
}

// ---------------------------------------------------------------------------------------------
// In-page instrumentation. Runs before any page script. Records go to Node through a binding;
// a queue covers the moment before the binding exists.

const INSTRUMENT = String.raw`(() => {
  if (window.__assetGateInstalled) return; window.__assetGateInstalled = true
  const queue = []
  const send = (r) => { r.at = Math.round(performance.now()); const f = window.__assetGateRecord; if (f) { while (queue.length) f(queue.shift()); f(r) } else queue.push(r) }
  setInterval(() => { const f = window.__assetGateRecord; if (f) while (queue.length) f(queue.shift()) }, 250)
  const caller = () => { const s = (new Error().stack || '').split('\n').slice(3).find((l) => !l.includes('__assetGate')) || ''; return s.trim().replace(/^at /, '').replace(location.origin, '').slice(0, 140) }
  const short = (u) => { u = String(u); return u.startsWith('data:') ? u.slice(0, 48) + (u.length > 48 ? '...' : '') : u.replace(location.origin, '') }
  const dataMime = (u) => /^data:([^;,]*)/.exec(u)?.[1] || ''
  const dataBytes = (u) => { const i = u.indexOf(','); if (i < 0) return 0; const body = u.slice(i + 1); return /;base64,/.test(u.slice(0, i + 8)) ? Math.floor(body.length * 3 / 4) : decodeURIComponent(body).length }
  // Things the game generated itself: canvas exports. Their later decodes are not shipped assets.
  const madeBlobs = new WeakSet(), madeUrls = new Set()
  const cToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = function (cb, ...a) { return cToBlob.call(this, (b) => { if (b) madeBlobs.add(b); cb(b) }, ...a) }
  const cToDataURL = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = function (...a) { const u = cToDataURL.apply(this, a); madeUrls.add(u); return u }
  if (window.OffscreenCanvas) { const conv = OffscreenCanvas.prototype.convertToBlob; OffscreenCanvas.prototype.convertToBlob = function (...a) { return conv.apply(this, a).then((b) => { madeBlobs.add(b); return b }) } }
  const blobUrls = new Map()
  const origCreate = URL.createObjectURL
  URL.createObjectURL = function (obj) {
    const url = origCreate.call(this, obj)
    if (obj instanceof Blob) {
      const generated = madeBlobs.has(obj)
      blobUrls.set(url, { mime: obj.type, bytes: obj.size, generated })
      send({ api: 'URL.createObjectURL', mime: obj.type, bytes: obj.size, source: 'blob', generated, caller: caller() })
    } else send({ api: 'URL.createObjectURL', mime: 'mediasource', bytes: 0, source: 'mediasource', caller: caller() })
    return url
  }
  const describe = (u) => {
    u = String(u)
    if (u.startsWith('data:')) return { source: 'data', mime: dataMime(u), bytes: dataBytes(u), generated: madeUrls.has(u) }
    if (u.startsWith('blob:')) { const b = blobUrls.get(u) || {}; return { source: 'blob', mime: b.mime || '', bytes: b.bytes || 0, generated: !!b.generated } }
    return { source: 'url', mime: '', bytes: 0, path: new URL(u, location.href).pathname }
  }
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url
    const p = origFetch.call(this, input, init)
    if (u && (u.startsWith('data:') || u.startsWith('blob:'))) {
      const d = describe(u)
      p.then((r) => send({ api: 'fetch', url: short(u), ...d, mime: d.mime || r.headers.get('content-type') || '', caller: caller() })).catch(() => {})
    }
    return p
  }
  const xOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (m, u, ...a) { u = String(u); if (u.startsWith('data:') || u.startsWith('blob:')) send({ api: 'XMLHttpRequest', url: short(u), ...describe(u), caller: caller() }); return xOpen.call(this, m, u, ...a) }
  const Base = window.BaseAudioContext || window.AudioContext
  if (Base) { const dec = Base.prototype.decodeAudioData; Base.prototype.decodeAudioData = function (buf, ...a) { send({ api: 'decodeAudioData', mime: 'audio/*', bytes: buf ? buf.byteLength : 0, source: 'buffer', caller: caller() }); return dec.call(this, buf, ...a) } }
  const origBitmap = window.createImageBitmap
  window.createImageBitmap = function (src, ...a) {
    let r
    if (src instanceof Blob) r = { mime: src.type || 'image/*', bytes: src.size, source: 'blob', generated: madeBlobs.has(src) }
    else if (src instanceof HTMLImageElement) r = { ...describe(src.currentSrc || src.src), mime: describe(src.currentSrc || src.src).mime || 'image/*' }
    else r = { mime: 'pixels', bytes: 0, source: src && src.constructor ? src.constructor.name : 'unknown', generated: true }
    send({ api: 'createImageBitmap', ...r, caller: caller() })
    return origBitmap.call(this, src, ...a)
  }
  const hookSrc = (proto, api, fallback) => {
    const d = Object.getOwnPropertyDescriptor(proto, 'src'); if (!d || !d.set) return
    Object.defineProperty(proto, 'src', { ...d, set(v) { if (v) { const r = describe(v); send({ api, url: short(v), ...r, mime: r.mime || fallback, caller: caller() }) } return d.set.call(this, v) } })
  }
  hookSrc(HTMLImageElement.prototype, 'img.src', '')
  hookSrc(HTMLMediaElement.prototype, 'media.src', '')
  if (window.HTMLSourceElement) hookSrc(HTMLSourceElement.prototype, 'source.src', '')
  const setAttr = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (n, v) { if ((n === 'src' || n === 'href') && (this instanceof HTMLImageElement || this instanceof HTMLMediaElement || this instanceof SVGImageElement)) { const r = describe(v); send({ api: this.tagName.toLowerCase() + '.setAttribute', url: short(v), ...r, caller: caller() }) } return setAttr.call(this, n, v) }
  if (window.FontFace) {
    const F = window.FontFace
    window.FontFace = function (family, source, desc) {
      let r
      if (typeof source === 'string') { const m = /url\(\s*['"]?([^'")]+)/.exec(source); r = m ? describe(m[1]) : { source: 'local', mime: 'font/*', bytes: 0 } }
      else r = { source: 'buffer', mime: 'font/*', bytes: source ? source.byteLength : 0 }
      send({ api: 'FontFace', family, ...r, mime: r.mime || 'font/*', caller: caller() })
      return new F(family, source, desc)
    }
    window.FontFace.prototype = F.prototype
  }
  const W = WebAssembly, len = (b) => (b && (b.byteLength ?? b.length)) || 0
  const wrapW = (name) => { const f = W[name]; if (!f) return; W[name] = function (src, ...a) {
    if (src instanceof W.Module) send({ api: 'WebAssembly.' + name, mime: 'application/wasm', bytes: 0, source: 'module', caller: caller() })
    else if (src instanceof Response) { const copy = src.clone(); copy.arrayBuffer().then((b) => send({ api: 'WebAssembly.' + name, mime: 'application/wasm', bytes: b.byteLength, source: 'stream', url: short(copy.url), path: copy.url ? new URL(copy.url).pathname : '', caller: caller() })).catch(() => {}) }
    else if (src && typeof src.then === 'function') Promise.resolve(src).then((res) => res.clone().arrayBuffer().then((b) => send({ api: 'WebAssembly.' + name, mime: 'application/wasm', bytes: b.byteLength, source: 'stream', url: short(res.url), path: res.url ? new URL(res.url).pathname : '', caller: caller() }))).catch(() => {})
    else send({ api: 'WebAssembly.' + name, mime: 'application/wasm', bytes: len(src), source: 'buffer', caller: caller() })
    return f.call(this, src, ...a) } }
  for (const n of ['instantiate', 'compile', 'instantiateStreaming', 'compileStreaming']) wrapW(n)
  const M = W.Module
  W.Module = function (bytes) { send({ api: 'new WebAssembly.Module', mime: 'application/wasm', bytes: len(bytes), source: 'buffer', caller: caller() }); return new M(bytes) }
  W.Module.prototype = M.prototype; Object.setPrototypeOf(W.Module, M)
  for (const k of ['exports', 'imports', 'customSections']) W.Module[k] = M[k]
  // new Audio(url) sets the source inside the constructor, not through the src setter.
  if (window.Audio) { const A = window.Audio; window.Audio = function (u) { if (u) { const r = describe(u); send({ api: 'new Audio', url: short(u), ...r, mime: r.mime || 'audio/*', caller: caller() }) } return u === undefined ? new A() : new A(u) }; window.Audio.prototype = A.prototype }
  if (window.Worker) { const Wk = window.Worker; window.Worker = function (u, o) { send({ api: 'Worker', url: short(u), ...describe(u), mime: 'text/javascript', caller: caller() }); return new Wk(u, o) }; window.Worker.prototype = Wk.prototype }
})()`

// ---------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()

async function main() {
  const args = process.argv.slice(2)
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
  const root = resolve(opt('--root', join(here, '..')))
  const out = resolve(opt('--out', '/tmp/syn3h-asset-gate/report.json'))
  const driveSeconds = Number(opt('--drive', '6'))
  const build = !args.includes('--no-build')

  const freePort = () => new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
  const children = []
  function start(cmd, argv, env, label) {
    const child = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', (d) => { log += d }); child.stderr.on('data', (d) => { log += d })
    child.label = label; child.log = () => log
    children.push(child)
    return child
  }
  function stopAll() { for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM') }
  process.on('exit', stopAll)
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopAll(); process.exit(130) })

  async function waitFor(url, ms) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.status < 500) return } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error(`timed out waiting for ${url}`)
  }
  const run = (cmd, argv, env = {}) => new Promise((ok, fail) => {
    const child = start(cmd, argv, env, 'build')
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${argv.join(' ')} exited ${code}\n${child.log().slice(-3000)}`))))
  })

  const vite = join(root, 'node_modules/.bin/vite'), tsx = join(root, 'node_modules/.bin/tsx')
  const steps = [], network = [], decodes = []
  let fonts = null
  const step = async (name, fn) => {
    const t0 = Date.now()
    try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) }) } catch (e) { steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e.message ?? e).split('\n')[0] }) }
  }

  let fatal = null, commit = ''
  try {
    commit = await new Promise((ok) => { const c = spawn('git', ['-C', root, 'rev-parse', '--short', 'HEAD']); let s = ''; c.stdout.on('data', (d) => { s += d }); c.on('exit', () => ok(s.trim())) })
    if (build) { console.log(`building ${root} (${commit})...`); await run(vite, ['build', '--logLevel', 'warn']) }
    if (!existsSync(join(root, 'dist/index.html'))) throw new Error(`no build at ${root}/dist`)
    const roomPort = await freePort(), webPort = await freePort()
    start(tsx, ['server/dev.ts'], { PORT: String(roomPort) }, 'room')
    // vite preview inherits server.proxy, which sends /ws and /presence to SYN3H_ROOM_PORT.
    start(vite, ['preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { SYN3H_ROOM_PORT: String(roomPort), SYN3H_NO_ROOM_SERVER: '1' }, 'preview')
    const base = `http://127.0.0.1:${webPort}/`
    await waitFor(`http://127.0.0.1:${roomPort}/status`, 30000)
    await waitFor(base, 30000)

    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
      await context.exposeBinding('__assetGateRecord', (_source, r) => {
        const path = r.path ?? ''
        decodes.push({ ...r, path, kind: r.generated ? 'generated' : classify(r.mime, path || r.url || '') })
      })
      await context.addInitScript(INSTRUMENT)
      const pending = []
      context.on('response', (res) => pending.push((async () => {
        const req = res.request(), url = new URL(res.url())
        if (url.protocol === 'data:' || url.protocol === 'blob:') return
        let body = null
        try { body = await res.body() } catch { /* redirects and aborted loads have none */ }
        let sizes = {}
        try { sizes = await req.sizes() } catch { /* not always available */ }
        const mime = (await res.headerValue('content-type').catch(() => '')) ?? ''
        network.push({
          url: url.origin === new URL(base).origin ? url.pathname + url.search : url.href, path: url.pathname, status: res.status(), type: req.resourceType(), mime,
          bytes: body ? body.length : 0, gzip: body ? gzipSync(body).length : 0, transfer: sizes.responseBodySize ?? null, kind: classify(mime || '', url.pathname),
          // A repeat served from the memory cache: no bytes moved, no headers. Counted once in totals.
          cached: (sizes.responseBodySize ?? 1) === 0 && !mime && Boolean(body?.length),
        })
      })()))
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`) })
      const evaluate = (fn, arg) => page.evaluate(fn, arg)

      await step('load and reach the lobby', async () => {
        await page.goto(`${base}?room=asset-gate-${Date.now()}`, { waitUntil: 'load', timeout: 60000 })
        await page.waitForFunction(() => window.syn3h?.shell && window.syn3h.game?.tick > 25 && (document.documentElement.dataset.boot ?? 'done') === 'done', null, { timeout: 120000 })
        await page.waitForTimeout(4000)
      })
      await step('open the vehicle panel and preview every vehicle', async () => {
        await evaluate(() => window.syn3h.shell.showPanel('vehicle'))
        await page.waitForTimeout(2500)
        const kinds = await evaluate(() => [...document.querySelectorAll('[name="vehicle"]')].map((r) => ({ value: r.value, checked: r.checked })))
        for (const k of kinds) {
          await evaluate((v) => { const r = document.querySelector(`[name="vehicle"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })) }, k.value)
          await page.waitForTimeout(2500)
        }
        const first = kinds.find((k) => k.checked) ?? kinds[0]
        if (first) await evaluate((v) => { const r = document.querySelector(`[name="vehicle"][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })) }, first.value)
        return kinds.map((k) => k.value).join(', ')
      })
      await step('drop into the world', async () => {
        await page.mouse.click(5, 5) // a real gesture, so audio unlocks the way it does for a player
        await evaluate(() => window.syn3h.shell.play())
        await page.waitForFunction(() => document.querySelector('.syn3h-shell')?.classList.contains('is-playing') && !window.syn3h.shell.dropping, null, { timeout: 60000 })
        await page.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 }).catch(() => {})
        await page.waitForTimeout(1500)
        return { connected: await evaluate(() => Boolean(window.syn3hNet?.connected)) }
      })
      await step('drive', async () => {
        const t0 = await evaluate(() => window.syn3h.game.tick)
        await page.keyboard.down('KeyW')
        await page.waitForTimeout(driveSeconds * 500)
        await page.keyboard.down('KeyA'); await page.waitForTimeout(1000); await page.keyboard.up('KeyA')
        await page.keyboard.down('KeyD'); await page.waitForTimeout(1000); await page.keyboard.up('KeyD')
        await page.waitForTimeout(Math.max(0, driveSeconds * 500 - 2000))
        await page.keyboard.up('KeyW')
        return { ticks: (await evaluate(() => window.syn3h.game.tick)) - t0 }
      })
      await step('change gear and use each tool', async () => {
        const list = await evaluate(() => {
          for (const id of ['laser.allowed', 'bungee.allowed', 'yoink.allowed', 'bigRed.allowed', 'pester.allowed']) if (window.syn3h.params.get(id)) window.syn3h.params.set(id, true)
          return window.syn3hNet?.gear?.list?.() ?? []
        })
        if (!list.length) throw new Error('no gear rack on window.syn3hNet.gear')
        for (const id of list) {
          await evaluate((g) => window.syn3hNet.gear.select(g), id)
          await page.waitForTimeout(300)
          await page.keyboard.down('KeyL'); await page.waitForTimeout(1200); await page.keyboard.up('KeyL')
          await page.keyboard.down('KeyV'); await page.waitForTimeout(400); await page.keyboard.up('KeyV')
          await page.waitForTimeout(500)
        }
        await page.keyboard.press('KeyT')
        return list.join(', ')
      })
      await step('return to the lobby and visit each panel', async () => {
        await evaluate(() => window.syn3h.shell.openMenu())
        await page.waitForTimeout(2500)
        const panels = await evaluate(() => [...document.querySelectorAll('.lobby-panels [data-panel]')].map((s) => s.dataset.panel))
        for (const id of panels) { await evaluate((p) => window.syn3h.shell.showPanel(p), id); await page.waitForTimeout(900) }
        await evaluate(() => window.syn3h.shell.showPanel('index'))
        await page.waitForTimeout(1500)
        return panels.join(', ')
      })
      await step('sweep styles and images for inlined binaries', async () => {
        const found = await evaluate(() => {
          const found = new Map(), add = (u, api, rule, bytes) => { const k = u.slice(0, 80); if (!found.has(k) || api !== 'stylesheet rule') found.set(k, { url: k.replace(location.origin, ''), api, rule, bytes }) }
          const size = (u) => { const i = u.indexOf(','); return u.startsWith('data:') && i > 0 ? (/;base64$/.test(u.slice(0, i)) ? Math.floor((u.length - i - 1) * 3 / 4) : u.length - i - 1) : 0 }
          for (const sheet of document.styleSheets) { let rules = []; try { rules = [...sheet.cssRules] } catch { continue } for (const r of rules) for (const m of r.cssText.matchAll(/url\("?(data:[^")]+|blob:[^")]+)/g)) add(m[1], 'stylesheet rule', (r.selectorText || r.cssText).slice(0, 60), size(m[1])) }
          for (const el of document.querySelectorAll('*')) { const bg = getComputedStyle(el).backgroundImage; for (const m of bg.matchAll(/url\("?([^")]+)/g)) add(m[1], 'rendered background', el.className?.baseVal ?? el.className, size(m[1])) }
          for (const img of document.images) add(img.currentSrc || img.src, 'rendered img', img.className, size(img.currentSrc || img.src))
          return [...found.values()]
        })
        for (const { url: u, api, rule, bytes } of found) {
          const mime = u.startsWith('data:') ? /^data:([^;,]*)/.exec(u)?.[1] ?? '' : ''
          const path = u.startsWith('/') ? u.split('?')[0] : ''
          decodes.push({ api, url: u, path, mime, bytes, source: u.startsWith('data:') ? 'data' : u.startsWith('blob:') ? 'blob' : 'url', kind: classify(mime, path || u), caller: `selector ${rule}` })
        }
        return found.length
      })
      await step('font faces and the weights the page renders', async () => {
        // Every element, including those in hidden panels: computed style resolves either way.
        fonts = await evaluate(() => {
          const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/"/g, ''), weight: f.weight, status: f.status }))
          const used = {}
          for (const el of document.querySelectorAll('body *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
            const cs = getComputedStyle(el), family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
            const key = `${family} ${cs.fontWeight}`, u = used[key] ??= { count: 0, rendered: 0, samples: [] }
            u.count++; if (el.getClientRects().length) u.rendered++
            const name = `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`
            if (u.samples.length < 6 && !u.samples.includes(name)) u.samples.push(name)
          }
          return { faces, used }
        })
        return `${fonts.faces.filter((f) => f.status === 'loaded').length} faces loaded`
      })
      await page.waitForTimeout(500)
      await Promise.all(pending)
      steps.push({ name: 'page errors', ok: errors.length === 0, detail: errors.slice(0, 20) })
      await context.close()
    } finally { await browser.close() }
  } catch (e) { fatal = String(e.stack ?? e) }
  stopAll()

  // ---------------------------------------------------------------------------------------------
  // Report.

  attributeStreams(decodes, network)
  for (const r of [...network, ...decodes]) { const a = allowed(r); if (a) r.allowedBy = `${a.why} (${a.term})` }
  const bad = [...violations(network).map((r) => ({ from: 'network', ...r })), ...violations(decodes).map((r) => ({ from: 'decode', ...r }))]
  const quiet = new Set(['script', 'style', 'document'])
  const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0)
  const report = {
    root, commit, at: new Date().toISOString(), fatal, steps,
    totals: { responses: network.length, cachedRepeats: network.filter((r) => r.cached).length, bytes: sum(network.filter((r) => !r.cached), 'bytes'), gzip: sum(network.filter((r) => !r.cached), 'gzip'), byKind: Object.fromEntries([...new Set(network.map((r) => r.kind))].map((k) => [k, { count: network.filter((r) => r.kind === k).length, bytes: sum(network.filter((r) => r.kind === k), 'bytes') }])) },
    wasm: decodes.filter((d) => d.kind === 'wasm').map(({ api, bytes, source, caller }) => ({ api, bytes, source, caller })),
    fonts, violations: bad, network, decodes,
    allowlist: ALLOWLIST.map((a) => ({ kind: a.kind, pattern: String(a.pattern), why: a.why, term: a.term })),
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))

  const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
  console.log(`\nRuntime assets: ${root} at ${commit}`)
  for (const s of steps) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.error ? `: ${s.error}` : ''}${s.detail && typeof s.detail !== 'object' ? ` (${s.detail})` : s.detail && !Array.isArray(s.detail) ? ` ${JSON.stringify(s.detail)}` : Array.isArray(s.detail) && s.detail.length ? `\n         ${s.detail.join('\n         ')}` : ''}`)
  const shown = network.filter((r) => !quiet.has(r.kind))
  console.log('\nResponses other than script, style and document:')
  const repeats = (r) => shown.filter((x) => x.url === r.url).length
  console.table(shown.filter((r, i) => shown.findIndex((x) => x.url === r.url) === i).map((r) => ({ url: r.url.slice(0, 70), times: repeats(r), type: r.type, mime: r.mime.slice(0, 28), kind: r.kind, bytes: r.bytes, gzip: r.gzip, verdict: !BINARY_KINDS.has(r.kind) ? 'not binary' : r.allowedBy ? `allowed: ${r.allowedBy.slice(0, 40)}` : 'FORBIDDEN' })))
  console.log('Run-time decodes:')
  console.table(decodes.map((d) => ({ api: d.api, source: d.source, url: (d.url || d.path || '').slice(0, 50), mime: (d.mime || '').slice(0, 24), kind: d.kind, bytes: d.bytes, verdict: !BINARY_KINDS.has(d.kind) ? 'not binary' : d.allowedBy ? 'allowed' : 'FORBIDDEN', caller: (d.caller || '').slice(0, 60) })))
  console.log(`Totals: ${network.length} responses (${report.totals.cachedRepeats} memory cache repeats), ${kb(report.totals.bytes)} raw, ${kb(report.totals.gzip)} gzip. WebAssembly: ${report.wasm.map((w) => `${w.api} ${kb(w.bytes)}`).join(', ') || 'none seen'}`)
  console.log(`Report: ${out}`)
  if (fatal) { console.error(`\nThe session could not run:\n${fatal}`); for (const c of children) if (c.label !== 'build') console.error(`--- ${c.label} log tail ---\n${c.log().slice(-1500)}`); process.exit(2) }
  if (bad.length) {
    console.error(`\nRUNTIME ASSETS FAILED: ${bad.length} binary loads or decodes are not on the allowlist:`)
    for (const b of bad) console.error(`  ${b.from} ${b.kind} ${b.url || b.path || b.api} ${b.mime} ${kb(b.bytes)}${b.caller ? ` from ${b.caller}` : ''}`)
    process.exit(1)
  }
  if (steps.some((s) => !s.ok && s.name !== 'page errors')) { console.error('\nNo forbidden asset seen, but a session step failed, so coverage is incomplete.'); process.exit(2) }
  console.log('\nRuntime assets OK: nothing binary loaded outside the allowlist.')
}
