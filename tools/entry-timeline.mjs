/**
 * Entry and exit frame timeline: every frame from the tap on a planet until ten seconds after
 * the player can drive, then from leaving the world until the galaxy has settled.
 *
 *   tools/heavy.sh node tools/entry-timeline.mjs URL [options]
 *
 * Options:
 *   --phone          390 x 844 CSS pixels, DPR 3, touch, 4x CPU throttling: a stand-in for a
 *                    phone, not a phone (the GPU is still this Mac's)
 *   --cpu N          CPU throttling factor (default 1, or 4 with --phone)
 *   --headed         a visible window instead of headless Chrome
 *   --profile        record a CPU profile and print the stacks of the slowest frames
 *   --planet ID      the world to drop into (default: the first one that is not current)
 *   --runs N         repeat the whole entry and exit (default 1)
 *   --level N        quality level 0 to 5 as a saved player choice (pinned, automation off);
 *                    default: whatever the game picks for this browser
 *
 * Uses the room server Vite starts. Prints one table per run; nothing is written to disk.
 * Long frames are attributed from Long Animation Frame entries (scripts that ran in them),
 * `syn3h:` user-timing measures overlapping them and, with --profile, the heaviest stacks.
 */
import { chromium } from 'playwright-core'
import { loadavg } from 'node:os'

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const url = args.find((a, i) => !a.startsWith('--') && !['--cpu', '--planet', '--runs', '--level'].includes(args[i - 1])) ?? 'http://127.0.0.1:5291/'
const phone = flag('phone'), cpu = Number(opt('cpu', phone ? 4 : 1)), runs = Number(opt('runs', 1)), profile = flag('profile')
const AFTER_DRIVE_MS = 10000, AFTER_EXIT_MS = 8000

const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })

/** Runs in the page: records every animation frame, long animation frames and the drive moment. */
function install() {
  const rec = window.__timeline = { frames: [], loaf: [], drivable: 0, settled: 0 }
  let last = 0
  const tick = now => {
    if (last) { const g = window.syn3h.game, m = g.performance, c = g.renderer.domElement; rec.frames.push({ at: last, ms: now - last, draws: m.drawCalls, tris: m.triangles, size: `${c.width}x${c.height}`, pr: g.renderer.getPixelRatio?.(), fresh: m.pipelinesFresh, live: m.pipelinesLive }) }
    last = now
    if (!rec.drivable && rec.clicked && window.syn3h.shell.playing) rec.drivable = now
    // Post-processing rebuilds (new passes, targets and pipelines) are worth naming.
    const chain = window.syn3h.game.postChain
    if (chain && chain.builds !== rec.postBuilds) { if (rec.postBuilds !== undefined) (rec.postChanges ??= []).push({ at: now, tier: chain.tier }); rec.postBuilds = chain.builds }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // Which materials the renderer builds (node graph to shader) and when: the slow part of a
  // first draw. Wraps the renderer's own node manager for this page only.
  const nodes = window.syn3h.game.renderer._nodes
  rec.builds = []
  for (const name of ['getForRender']) {
    const original = nodes[name].bind(nodes)
    nodes[name] = (renderObject, ...rest) => {
      const fresh = !nodes.get(renderObject).nodeBuilderState
      const t = performance.now(), out = original(renderObject, ...rest), ms = performance.now() - t
      if (fresh && ms > 1) {
        const o = renderObject.object, m = renderObject.material; let p = o, path = []; while (p && path.length < 4) { if (p.name) path.push(p.name); p = p.parent }
        // A bot's own build (its vehicle, or one leaving): arrivals are judged on these, not on
        // world content first drawn in the same seconds.
        const bots = window.syn3h.bots, own = new Set([...(bots?.vehicles ?? []), ...(bots?.leaving?.keys?.() ?? [])].map(v => v.object))
        let q = o, bot = false; while (q) { if (own.has(q)) { bot = true; break } q = q.parent }
        rec.builds.push({ at: t, ms, bot, what: `${m.type}${m.name ? ` "${m.name}"` : ''} on ${o.type}${path.length ? ` ${path.join('<')}` : ''}` })
      }
      return out
    }
  }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) rec.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, render: e.renderStart, style: e.styleAndLayoutStart,
        scripts: e.scripts.map(s => ({ start: s.startTime, duration: s.duration, invoker: s.invoker, fn: s.sourceFunctionName, src: (s.sourceURL || '').replace(/^.*\/(src|node_modules)\//, '$1/') + (s.sourceCharPosition >= 0 ? `@${s.sourceCharPosition}` : ''), forced: s.forcedStyleAndLayoutDuration })) })
    }).observe({ type: 'long-animation-frame', buffered: false })
  } catch { rec.noLoaf = true }
}

/** A named function the profile can find, to align its clock with performance.now(). */
function anchor() {
  // eslint-disable-next-line no-unused-vars
  return (function syn3hProfileAnchor() { const start = performance.now(); let x = 0; while (performance.now() - start < 6) x += Math.sqrt(x + 1); return start })()
}

const summarise = (frames, from, to) => {
  const set = frames.filter(f => f.at >= from && f.at < to)
  const ms = set.map(f => f.ms)
  return { set, count: set.length, worst: Math.max(0, ...ms), over33: ms.filter(m => m > 33.4).length, over50: ms.filter(m => m > 50).length, over100: ms.filter(m => m > 100).length, median: ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)] ?? 0 }
}

function profileIndex(prof, offsetMs) {
  const byId = new Map(prof.nodes.map(n => [n.id, n]))
  const parent = new Map()
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const times = []
  let t = prof.startTime
  for (let i = 0; i < prof.samples.length; i++) { t += prof.timeDeltas[i]; times.push(t / 1000 + offsetMs) }
  const name = n => { const f = n.callFrame; const file = f.url.replace(/^.*\/(src|node_modules|deps)\//, '$1/').replace(/\?.*$/, ''); return `${f.functionName || '(anon)'}${file ? ` ${file}:${f.lineNumber + 1}` : ''}` }
  const stack = id => { const out = []; for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const n = byId.get(cur); if (n.callFrame.functionName !== '(root)') out.push(name(n)) } return out }
  return { busy(from, to) {
    let ms = 0
    for (let i = 1; i < times.length; i++) if (times[i] >= from && times[i] <= to) { const n = byId.get(prof.samples[i]).callFrame.functionName; if (n !== '(idle)') ms += times[i] - times[i - 1] }
    return ms
  }, heaviest(from, to, top = 3) {
    const self = new Map(), interval = new Map()
    for (let i = 1; i < times.length; i++) {
      if (times[i] < from || times[i] > to) continue
      const d = times[i] - times[i - 1], id = prof.samples[i]
      self.set(id, (self.get(id) ?? 0) + d); interval.set('total', (interval.get('total') ?? 0) + d)
    }
    // Group by the deepest frame of our own code, so one stage shows as one line.
    const ours = new Map()
    for (const [id, ms] of self) {
      const s = stack(id), own = s.findIndex(line => line.includes('src/')) , key = (own >= 0 ? s.slice(own, own + 6) : s.slice(0, 6)).join(' < ')
      const leaf = s[0] ?? '(idle)'
      const row = ours.get(key) ?? { ms: 0, leaves: new Map() }
      row.ms += ms; row.leaves.set(leaf, (row.leaves.get(leaf) ?? 0) + ms); ours.set(key, row)
    }
    return [...ours].sort((a, b) => b[1].ms - a[1].ms).slice(0, top).map(([key, row]) => ({ ms: row.ms, stack: key, leaf: [...row.leaves].sort((a, b) => b[1] - a[1])[0][0] }))
  } }
}

async function run(index) {
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const level = opt('level', null)
  if (level !== null) await context.addInitScript(q => { try { localStorage.setItem('syn3h.quality.v2', JSON.stringify({ level: q, auto: false, pinned: true, overrides: {} })) } catch {} }, Number(level))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  // Console errors and warnings, by phase: WebGPU validation errors arrive here (three logs the
  // device's uncaptured errors, Chrome logs its own "WebGPU" warnings).
  let phase = 'lobby'
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /webgpu|validation|invalid/i.test(m.text()))) consoleErrors.push({ phase, type: m.type(), text: m.text() }) })
  const cdp = await context.newCDPSession(page)
  const room = `entry-${Date.now()}-${index}`
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}room=${room}`, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.syn3h?.shell && document.documentElement.dataset.boot !== 'loading' && window.syn3h.shell.galaxy?.live, null, { timeout: 180000, polling: 100 })
  await page.waitForTimeout(4000)
  const info = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null)
    const current = window.syn3h.planets.currentPlanet().id
    return { backend: window.syn3h.game.backend, adapter: adapter ? `${adapter.info?.vendor} ${adapter.info?.architecture} ${adapter.info?.description ?? ''}`.trim() : 'none', current,
      worlds: [...document.querySelectorAll('.galaxy-label[data-world]')].map(c => c.dataset.world), quality: window.syn3h.game.quality?.getPerformanceSnapshot?.()?.level }
  })
  const target = opt('planet', info.worlds.find(w => w !== info.current && w !== 'custom' && !w.includes('~')))
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.evaluate(install)
  if (process.env.INJECT_CSS) await page.addStyleTag({ content: process.env.INJECT_CSS })
  let offset = 0
  if (profile) {
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start')
  }
  const anchorAt = await page.evaluate(anchor)
  await page.waitForTimeout(500)
  const clicked = await page.evaluate(id => { const r = window.__timeline; r.clicked = performance.now(); document.querySelector(`.galaxy-label[data-world="${id}"]`).click(); return r.clicked }, target)
  phase = 'entry'
  await page.waitForFunction(() => window.__timeline.drivable > 0, null, { timeout: 60000, polling: 50 })
  phase = 'driving (bot arrivals)'
  await page.waitForTimeout(AFTER_DRIVE_MS)
  phase = 'exit'
  // Leaving: "Leave world", confirmed.
  const left = await page.evaluate(() => { const r = window.__timeline, shell = window.syn3h.shell; r.left = performance.now(); shell.askExit(); shell.answerExit(true); return r.left })
  const settled = await page.waitForFunction(() => !window.syn3h.shell.dropping && !window.syn3h.shell.playing, null, { timeout: 30000, polling: 50 }).then(() => page.evaluate(() => performance.now())).catch(() => NaN)
  await page.waitForTimeout(AFTER_EXIT_MS)
  const rec = await page.evaluate(() => {
    const r = window.__timeline
    r.measures = performance.getEntriesByType('measure').filter(m => m.name.startsWith('syn3h:') && m.startTime >= r.clicked - 10).map(m => ({ name: m.name, start: m.startTime, duration: m.duration }))
    r.stats = { bots: window.syn3h.bots.vehicles.length, backend: window.syn3h.game.backend }
    r.pacing = (window.syn3h.bots.pacer?.log ?? []).filter(l => l.at >= r.clicked)
    return r
  })
  let index2 = null
  if (profile) {
    const { profile: prof } = await cdp.send('Profiler.stop')
    const byId = new Map(prof.nodes.map(n => [n.id, n]))
    let t = prof.startTime, hit = -1
    for (let i = 0; i < prof.samples.length; i++) { t += prof.timeDeltas[i]; if (byId.get(prof.samples[i]).callFrame.functionName === 'syn3hProfileAnchor') { hit = t; break } }
    if (hit >= 0) { offset = anchorAt - hit / 1000; index2 = profileIndex(prof, offset) } else console.log('profile anchor not found: no stacks')
  }
  await context.close()

  const byPhase = new Map()
  for (const e of consoleErrors) { const k = `${e.phase}\u0001${e.type}\u0001${e.text.slice(0, 1500)}`; byPhase.set(k, (byPhase.get(k) ?? 0) + 1) }
  console.log(`console errors: ${consoleErrors.length} (${['lobby', 'entry', 'driving (bot arrivals)', 'exit'].map(p => `${p} ${consoleErrors.filter(e => e.phase === p).length}`).join(', ')})`)
  for (const [k, n] of byPhase) { const [ph, type, text] = k.split('\u0001'); console.log(`  x${n} [${ph}] ${type}: ${text.replace(/\s+/g, ' ')}`) }
  const entry = summarise(rec.frames, clicked, rec.drivable + AFTER_DRIVE_MS)
  const transition = summarise(rec.frames, clicked, rec.drivable)
  const exit = summarise(rec.frames, left, left + AFTER_EXIT_MS)
  const busyOf = f => index2 ? index2.busy(f.at, f.at + f.ms) : NaN
  for (const s of [entry, exit, transition]) { const b = s.set.map(busyOf); s.busyWorst = Math.max(0, ...b); s.busy33 = b.filter(x => x > 33).length; s.busy50 = b.filter(x => x > 50).length }
  const fmt = (name, s, extra = '') => `| ${name} | ${s.count} | ${s.median.toFixed(1)} | ${s.worst.toFixed(0)} | ${s.over33} | ${s.over50} | ${s.over100} | ${index2 ? `${s.busyWorst.toFixed(0)} / ${s.busy33} / ${s.busy50}` : 'n/a'} | ${extra} |`
  console.log(`\n### ${phone ? `phone stand-in, ${cpu}x CPU` : `desktop${cpu > 1 ? ` ${cpu}x CPU` : ''}`}, ${flag('headed') ? 'headed' : 'headless'}, run ${index + 1}: ${info.current} -> ${target}`)
  console.log(`backend ${info.backend}, adapter ${info.adapter}, load ${loadavg()[0].toFixed(1)}, bots at end ${rec.stats.bots}${rec.noLoaf ? ', no LoAF' : ''}${errors.length ? `, page errors: ${errors.join(' | ').slice(0, 300)}` : ''}`)
  console.log('| Span | Frames | Median ms | Worst ms | >33 | >50 | >100 | Main thread busy: worst / >33 / >50 | |\n|---|---:|---:|---:|---:|---:|---:|---|---|')
  console.log(fmt('click to drivable', transition, `${(rec.drivable - clicked).toFixed(0)} ms to drivable`))
  console.log(fmt('click to drivable + 10 s', entry))
  console.log(fmt(`leave + ${AFTER_EXIT_MS / 1000} s`, exit, `${(settled - left).toFixed(0)} ms to lobby`))
  const sum = (a, b) => rec.builds.filter(x => x.at >= a && x.at < b).reduce((t, x) => t + x.ms, 0)
  for (const c of rec.postChanges ?? []) console.log(`post chain rebuilt at ${c.at < left ? `click+${(c.at - clicked).toFixed(0)}` : `leave+${(c.at - left).toFixed(0)}`} (drivable${c.at >= rec.drivable ? '+' : ''}${(c.at - rec.drivable).toFixed(0)}), tier ${c.tier}`)
  if (flag('landing')) for (const f of rec.frames.filter(f => f.at > rec.drivable - 150 && f.at < rec.drivable + 250)) console.log(`  drivable${f.at >= rec.drivable ? '+' : ''}${(f.at - rec.drivable).toFixed(0)} ${f.ms.toFixed(0)} ms draws ${f.draws} tris ${f.tris} ${f.size} pr ${f.pr} pipelines ${f.live}/${f.fresh}`)
  if (flag('builds')) for (const b of rec.builds.filter(x => x.at >= clicked && x.at < left)) console.log(`  build at click+${(b.at - clicked).toFixed(0)} ${b.ms.toFixed(1)} ms: ${b.what}`)
  console.log(`shader builds: entry ${sum(clicked, rec.drivable + AFTER_DRIVE_MS).toFixed(0)} ms in ${rec.builds.filter(x => x.at >= clicked && x.at < left).length} materials; exit ${sum(left, left + AFTER_EXIT_MS).toFixed(0)} ms`)
  for (const l of rec.pacing ?? []) {
    // An arrival's own frames: the worst in the 1.5 s after it was asked for (build, first draw, cloud).
    const after = l.action === 'add' ? rec.frames.filter(f => f.at >= l.at && f.at < l.at + 1500) : []
    const worst = after.length ? Math.max(...after.map(f => f.ms)) : null
    const builds = l.action === 'add' ? rec.builds.filter(b => b.at >= l.at && b.at < l.at + 1500) : []
    const ms = list => list.reduce((t, b) => t + b.ms, 0).toFixed(0)
    console.log(`  bot ${l.action} at drivable+${(l.at - rec.drivable).toFixed(0)} with ${l.have}${l.p90 ? `: p90 ${l.p90.toFixed(1)} ms, mean ${l.meanMs.toFixed(1)} ms, target ${l.targetMs.toFixed(1)} ms` : ''}${worst !== null ? `; worst frame in the next 1.5 s ${worst.toFixed(0)} ms, ${after.filter(f => f.ms > 33).length} over 33; builds then: the bot's ${ms(builds.filter(b => b.bot))} ms, other ${ms(builds.filter(b => !b.bot))} ms` : ''}`)
  }
  const long = [...entry.set.map(f => ({ ...f, span: 'entry' })), ...exit.set.map(f => ({ ...f, span: 'exit' }))].map(f => ({ ...f, busy: busyOf(f) })).filter(f => f.ms > 50 || (index2 && f.busy > 25)).sort((a, b) => index2 ? b.busy - a.busy : b.ms - a.ms)
  for (const f of long) {
    const from = f.at, to = f.at + f.ms
    const rel = f.span === 'entry' ? `click+${(from - clicked).toFixed(0)}` : `leave+${(from - left).toFixed(0)}`
    console.log(`\n- ${f.span} frame ${f.ms.toFixed(0)} ms${index2 ? ` (main thread busy ${f.busy.toFixed(0)} ms)` : ''} at ${rel} ms${f.span === 'entry' && from > rec.drivable ? ` (drivable+${(from - rec.drivable).toFixed(0)})` : ''}`)
    const measures = rec.measures.filter(m => m.start < to && m.start + m.duration > from && m.duration > 2)
    const builds = rec.builds.filter(b => b.at >= from - 1 && b.at < to)
    if (builds.length) { const by = new Map(); for (const b of builds) { const r = by.get(b.what) ?? [0, 0]; r[0] += b.ms; r[1]++; by.set(b.what, r) }; console.log(`  shader builds ${builds.reduce((a, b) => a + b.ms, 0).toFixed(0)} ms: ${[...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 6).map(([w, [ms, n]]) => `${w} x${n} ${ms.toFixed(0)}`).join('; ')}`) }
    if (measures.length) console.log(`  marks: ${measures.map(m => `${m.name.slice(6)} ${m.duration.toFixed(0)}`).join(', ')}`)
    const loaf = rec.loaf.filter(l => l.start < to && l.start + l.duration > from)
    for (const l of loaf) for (const s of l.scripts.filter(s => s.duration > 5).sort((a, b) => b.duration - a.duration).slice(0, 3)) console.log(`  script ${s.duration.toFixed(0)} ms: ${s.invoker} ${s.fn || ''} ${s.src}`)
    for (const l of loaf) { const scripts = l.scripts.reduce((a, s) => a + s.duration, 0); if (l.duration - scripts > 30) console.log(`  outside scripts ${(l.duration - scripts).toFixed(0)} ms (render/style/GPU submit${l.render ? `, render starts +${(l.render - l.start).toFixed(0)}` : ''})`) }
    if (index2) for (const h of index2.heaviest(from, to)) console.log(`  stack ${h.ms.toFixed(0)} ms: ${h.leaf}\n      in ${h.stack}`)
  }
}

try { for (let i = 0; i < runs; i++) await run(i) } finally { await browser.close() }
