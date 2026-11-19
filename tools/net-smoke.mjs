/**
 * End-to-end multiplayer check. Needs the dev server, which also starts the room server on
 * 8787 (or run them apart: `SYN3H_NO_ROOM_SERVER=1 npx vite ...` plus `npm run server`):
 *
 *   npx vite --port 5183 --strictPort
 *   node tools/net-smoke.mjs [http://localhost:5183/]
 *
 * Also works against a production build (`npx wrangler dev`), including real bot-manager checks.
 *
 * Opens two headless Chrome pages in one fresh room and checks, in order:
 *  1. both connect and see each other
 *  2. driving A moves A's remote vehicle on B, and B's copy tracks A's real position
 *  3. a shared slider moved on A arrives on B, clamped by the server
 *  4. ramming: A drives into B, a ram is detected, and "it" passes from A to B
 *  5. laser tag: B (now it) shoots A; A's client detects the hit and B scores
 *  6. sounds: spawns, shots, hits and rams reach the audio hooks
 *  7. identity: A's vehicle kind and colours reach B; B shows a name tag for A
 *  8. hidden tab: B hides, keeps a heartbeat, and A shows B as paused, not lost
 *  9. bots: A (host) owns a bot, B sees it, both list it for audio, and B's laser hit on it is
 *     judged by A
 * 10. world seed: A changes it, B regenerates and stays on the ground; a late joiner with a
 *     different ?seed= gets the room's seed
 * 11. King of the Hill: A switches the mode, the host's zone reaches everyone, A alone on the
 *     rim scores, B joins it and the hill is contested, B sinks into the lava lake and is
 *     stuck (still visible to A), then is lifted back to its pad
 * Exits non zero on any failure or page error.
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { MAX_STEP_RETRIES, isBrowserCrash, isTransportConsoleError, retryDecision, uncleanSince } from './lib/smoke-retry.mjs'
// First: it turns on Playwright's browser log channel before playwright-core loads.
import { chromeTail, nameNextLaunch, prepareChromeLogs } from './lib/chrome-log.mjs'
import { chromium } from 'playwright-core'
import { browserEnv } from './lib/safe-env.mjs'
import { createShotEvidence, createShotDecision } from './shot-evidence.mjs'

// Opt-in only. Reserve a caller-owned fresh directory before opening a browser.
const evidenceDir = process.env.SYN3H_SHOT_EVIDENCE_DIR
const evidenceEnabled = evidenceDir !== undefined
if (evidenceEnabled) {
  if (!evidenceDir || !isAbsolute(evidenceDir)) throw new Error('SYN3H_SHOT_EVIDENCE_DIR must be an absolute fresh directory')
  mkdirSync(evidenceDir) // Non-recursive and exclusive: existing output is never reused.
}
const base = process.argv[2] ?? 'http://localhost:5183/'
// Full timestamp plus random suffix avoids revisiting a persisted fixture room.
const room = `smoke${Date.now()}-${randomBytes(6).toString('hex')}`
if (room.length > 32 || !/^[a-z0-9_-]+$/.test(room)) throw new Error('Invalid smoke room identity')
console.log('NET SMOKE RUN', JSON.stringify({ base, room }))
const diagnosticPath = `/tmp/syn3h-net-smoke-${room}.json`
const clients = []
/** Pages whose browser process crashed: the machine failed, not the game (see isBrowserCrash). */
const crashedPages = []
/** Console errors that are failed WebSocket connections to the room: counted beside the drops. */
const transportErrors = []
const shot = '/tmp/syn3h-net-smoke.png'

// One browser process per page: a crashed page takes down only itself, not every client in the
// check (reliability plan, section 3). Each is launched in open() and closed at the end.
const browsers = []
/**
 * Why a page crashed, kept for the next crash anywhere in the release path: each page's Chrome
 * logs to stderr, kept per page in a capped file, with crash dumps beside it, outside the repo
 * (SYN3H_SMOKE_CHROME_LOGS, default /tmp/syn3h-smoke-chrome; the ten newest runs are kept). On a
 * crash the smoke prints that page's last stderr and console lines and its last memory sample.
 */
const chromeLogRoot = process.env.SYN3H_SMOKE_CHROME_LOGS || '/tmp/syn3h-smoke-chrome'
const chromeLogDir = prepareChromeLogs(chromeLogRoot, room)
const pageTrace = new Map()
const traceFor = (name) => { if (!pageTrace.has(name)) pageTrace.set(name, { console: [], memory: null }); return pageTrace.get(name) }
const launch = (name) => (nameNextLaunch(name), chromium.launch({
  channel: 'chrome',
  headless: true,
  // No credentials in a browser's environment: a crash dump would record them (lib/safe-env.mjs).
  env: browserEnv(),
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist',
    // Keep every page running at full rate even though only one can be focused.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-logging=stderr', '--v=0', `--crash-dumps-dir=${join(chromeLogDir, 'dumps')}`],
}))
/**
 * The check proves networking and rules, not rendering: pages run at the Low level, pinned
 * before load so no automatic step moves it. Low is the lowest level whose budget still allows
 * the four default bots that "default bots join and replicate" asks for (Minimal allows 2).
 * The viewport stays 960x540: at 640x360 the HUD readouts cover the middle of the screen, and
 * the labels keep clear of them by design, so "B shows a name tag for A" would see no tag.
 */
const SMOKE_QUALITY = { level: 1, auto: false, pinned: true, overrides: {} }
const SMOKE_VIEWPORT = { width: 960, height: 540 }
const errors = []
const handlerErrors = []
async function open(name, extra = '') {
  const browser = await launch(name)
  browsers.push(browser)
  const ctx = await browser.newContext({ viewport: SMOKE_VIEWPORT })
  await ctx.addInitScript((q) => localStorage.setItem('syn3h.quality.v2', JSON.stringify(q)), SMOKE_QUALITY)
  // A memory sample every 5 s, for the crash report below (Chrome's performance.memory).
  await ctx.addInitScript(() => setInterval(() => { const m = performance.memory; if (m) console.debug(`SMOKE-MEM ${Math.round(m.usedJSHeapSize / 1048576)} MB of ${Math.round(m.jsHeapSizeLimit / 1048576)} MB`) }, 5000))
  const page = await ctx.newPage()
  clients.push({ name, page })
  page.on('console', (m) => {
    const t = traceFor(name), text = String(m.text?.() ?? '')
    if (text.startsWith('SMOKE-MEM ')) { t.memory = text.slice(10); return }
    t.console.push(`${m.type?.()}: ${text.slice(0, 300)}`); if (t.console.length > 15) t.console.shift()
  })
  page.on('crash', () => {
    crashedPages.push(name)
    const t = traceFor(name)
    console.log(`NET SMOKE PAGE CRASH ${name} at ${new Date().toISOString()}: memory ${t.memory ?? 'unknown'}; Chrome log ${join(chromeLogDir, name + '.log')}, dumps ${join(chromeLogDir, 'dumps')}`)
    console.log(`NET SMOKE PAGE CRASH ${name} last Chrome stderr: ${JSON.stringify(chromeTail(name).slice(-20))}`)
    console.log(`NET SMOKE PAGE CRASH ${name} last console: ${JSON.stringify(t.console)}`)
  })
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const line = `${name} console: ${m.text()} at ${m.location().url}`
    // The browser's own report of a failed handshake to the room is the network, not the page.
    if (isTransportConsoleError(m.text(), base)) transportErrors.push(line)
    else errors.push(line)
  })
  page.on('response', (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.url()}`) })
  page.on('requestfailed', (r) => console.log(`REQUEST FAILED ${r.url()} ${r.failure()?.errorText}`))
  // A transport error, or a 5xx or 429 for the page itself, is retried twice (after 1 s, then
  // 3 s) and logged with its URL; any other answer is tested as it is.
  const address = `${base}?room=${room}&name=${name}&autoplay=1${extra}`
  for (const [attempt, delay] of [1000, 3000, null].entries()) {
    let problem = null
    try {
      const response = await page.goto(address, { waitUntil: 'load' })
      const status = response?.status() ?? 0
      if (status >= 500 || status === 429) problem = `HTTP ${status}`
    } catch (error) { problem = `transport error: ${String(error.message).split('\n')[0]}` }
    if (!problem) break
    if (delay === null) throw new Error(`${address} failed after three attempts: ${problem}`)
    console.log(`RETRY ${attempt + 1} of 2 for ${address} after ${problem}`)
    await new Promise((done) => setTimeout(done, delay))
  }
  // ?autoplay=1 joins the room but leaves the start screen's input suspension on, so press
  // Play as a person would (it is idempotent with autoplay's join).
  await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 30000 })
  await page.evaluate(() => { window.syn3h.shell.play(); document.activeElement?.blur?.() })
  return page
}

/** Failure-only, bounded snapshots. Never override bots or extend an assertion's wait. */
async function captureFailure() {
  const snapshots = await Promise.all(clients.map(async ({ name, page }) => {
    let timer
    try {
      const snapshot = await Promise.race([
        page.evaluate(() => {
          const s = window.syn3h, n = window.syn3hNet
          const param = id => s?.params?.get(id)?.value ?? null
          const roster = n?.players ? [...n.players.values()].map(p => ({ id: p.id, name: p.name, kind: p.kind, bot: Boolean(p.bot) })) : []
          return {
            at: Date.now(), url: location.href, readyState: document.readyState, hidden: document.hidden,
            requestedBots: param('bots.count'), effectiveBots: s?.bots?.vehicles?.length ?? null,
            botRosterCount: roster.filter(p => p.bot).length,
            // Why the host's bots changed: the pacer's decisions and the quality governor's bot steps.
            botPacing: s?.bots?.pacer ? { log: s.bots.pacer.log.slice(-12).map(l => `${(l.at / 1000).toFixed(1)}s ${l.action} at ${l.have} target ${l.targetMs.toFixed(0)}`), comfort: [...s.bots.pacer.comfort], allowed: s.bots.pacer.allowed, governorBotChanges: s.game?.quality?.governor?.botChanges ?? null, level: s.game?.quality?.governor?.level ?? null } : null,
            id: n?.id ?? null, isHost: n?.isHost ?? null, host: n?.game?.host ?? null, roster,
            playing: s?.shell?.playing ?? null, suspended: s?.game?.input?.suspended ?? null,
            tick: s?.game?.tick ?? null, gameTime: s?.game?.time ?? null, fps: s?.game?.fps ?? null,
            gfx: param('gfx.level'), backend: s?.game?.backend ?? null, performance: s?.game?.performance ?? null,
            worldSeed: param('world.seed'), mode: n?.game?.mode ?? null,
            network: { connected: n?.connected ?? null, welcomed: n?.welcomed ?? null,
              state: n?.conn?.state ?? null, socketState: n?.conn?.ws?.readyState ?? null,
              bufferedBytes: n?.conn?.ws?.bufferedAmount ?? null, retryAt: n?.conn?.retryAt ?? null,
              reconnects: n?.conn?.reconnects ?? null, closes: n?.conn?.closes ?? null, handlerErrors: n?.conn?.handlerErrors ?? null,
              clockSynced: n?.clock?.synced ?? null, rtt: n?.clock?.rtt ?? null, stats: n?.stats ?? null,
              remotes: n?.remotes ? [...n.remotes.entries()].map(([id, r]) => ({ id, responding: r.responding, paused: r.paused, mode: r.sample?.mode, newest: r.buffer?.newest?.t })) : [] },
            startup: window.syn3hStartup ?? null,
          }
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic snapshot timed out after 5s')), 5000) }),
      ])
      return { name, ...snapshot }
    } catch (e) { return { name, error: String(e?.message ?? e) } }
    finally { clearTimeout(timer) }
  }))
  const report = { base, room, results, errors, clients: snapshots }
  console.log('NET SMOKE FAILURE DIAGNOSTICS', JSON.stringify(report))
  try { writeFileSync(diagnosticPath, JSON.stringify(report, null, 2)); console.log('Diagnostic file', diagnosticPath) }
  catch (e) { console.error('Could not save diagnostic file', String(e)) }
}

/** Record calls to the networking audio hooks (main.ts may not pass real audio yet). */
const spyAudio = (page) => page.evaluate((factorySource) => {
  const calls = []
  window.__audioCalls = calls
  window.syn3hNet.ctx.audio = {
    play: (sound) => calls.push(sound),
    impact: (strength) => calls.push(`impact:${strength.toFixed(1)}`),
  }
  // Test-owned factory is identical to the one imported by the fake-clock tests.
  if (!factorySource) return
  const evidence = window.__shotEvidence = (0,eval)(`(${factorySource})`)()
  const n=window.syn3hNet
  n.conn.onText=evidence.wrapText(n.conn.onText)
  n.conn.send=evidence.wrapSend(n.conn.send,()=>n.id)
  n.ctx.audio.play=evidence.wrapAudio(n.ctx.audio.play)
}, evidenceEnabled ? createShotEvidence.toString() : null)
const audioCalls = (page) => evidenceEnabled
  ? page.evaluate(() => ({ calls: [...window.__audioCalls], evidence: window.__shotEvidence.snapshot('human') }))
  : page.evaluate(() => window.__audioCalls)

const results = []
const shotEvidencePath = evidenceEnabled ? join(evidenceDir, 'shot-evidence.json') : null
const evidenceWriteFailures = []
const evidenceCaptureFailures = []
let evidenceCaptureState = 'pending'
let finalCollectors = []
function evidenceComplete() {
  return evidenceCaptureState === 'complete' && evidenceWriteFailures.length === 0 && evidenceCaptureFailures.length === 0
}
function saveShotEvidence(stage,collectors=finalCollectors) {
  try {
    writeFileSync(shotEvidencePath,JSON.stringify({room,base,stage,evidenceWriteFailures,evidenceCaptureFailures,evidenceCaptureState,evidenceComplete:evidenceComplete(),collectors,
      frozenSamples:results.filter(r=>r.name.startsWith('matched ')).slice(0,2),
      failedVerdicts:results.filter(r=>!r.ok).map(r=>({name:r.name,ok:r.ok})).slice(0,64)},null,2))
  } catch(e) {
    const failure={stage,error:String(e)}; evidenceWriteFailures.push(failure)
    console.error('SHOT EVIDENCE WRITE FAILURE',JSON.stringify(failure))
  }
}
async function captureShotCollectors() {
  return Promise.all(clients.filter(c=>c.name==='Alice' || c.name==='Bob').slice(0,2).map(async ({name,page})=>{
    let timer
    try {
      return {name,...await Promise.race([
        page.evaluate(()=>({phases:['human','bot'].map(label=>{
          const s=window.__shotEvidence?.snapshot(label)
          if(!s)return null
          return {...s,emitted:s.emitted.slice(0,6),events:s.events.slice(0,128),truncated:s.events.length>128}
        })})),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Collector capture exceeded 1500ms')),1500)})
      ])}
    } catch(e) {return {name,error:String(e),partial:true}}
    finally {clearTimeout(timer)}
  }))
}
/** The running step's results, committed once the step settles (see step()). */
let current = null
function check(name, ok, detail) {
  const r = { name, ok: Boolean(ok), detail }
  if (current) current.push(r)
  else commit(r)
}
function commit(r) {
  results.push(r)
  if(evidenceEnabled && !r.ok) saveShotEvidence('failed-verdict')
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${JSON.stringify(r.detail)}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * Read state until `done(value)` holds or `ms` pass, and say how long it took. A check waits for
 * the state it asserts (a returning tab resumes) instead of sleeping a fixed time and reading
 * once: on a slow public route or a loaded machine the fixed time was the only thing that failed.
 */
async function settle(read, done, ms = 10000) {
  const start = Date.now()
  let value = await read()
  while (!done(value) && Date.now() - start < ms) { await wait(200); value = await read() }
  return { value, waitedMs: Date.now() - start }
}

// ---- Steps, and telling the network from the game -------------------------------------------
// The public address can drop a socket (1006) on a bad route. A step that fails may run once more
// only if a page's socket closed uncleanly while it ran; the rejoin rules are then checked as
// coverage of their own. No drop in the window, or a second failure, fails as before.
/** Page name to player id, as first welcomed: a dropped page must come back as the same player. */
const ids = new Map()
const closesOf = (page) => page.evaluate(() => ({ now: performance.now(), closes: window.syn3hNet?.conn?.closes ?? null })).catch(() => ({ now: 0, closes: null }))
const tally = { steps: 0, passed: 0, retries: 0, drops: [], legacy: false }
async function step(name, fn, { retryable = true } = {}) {
  tally.steps++
  for (let retried = false; ; retried = true) {
    const marks = await Promise.all(clients.map((c) => closesOf(c.page)))
    const supported = marks.every((m) => Array.isArray(m.closes))
    if (!supported) tally.legacy = true
    const hostBefore = await clients[0].page.evaluate(() => window.syn3hNet?.game?.host ?? null).catch(() => null)
    current = []
    let error = null
    try { await fn({ retried }) } catch (e) { error = e }
    const attempt = current
    current = null
    const after = await Promise.all(clients.map((c) => closesOf(c.page)))
    const drops = after.flatMap((m, i) => uncleanSince(m.closes, marks[i]?.now ?? 0).map((d) => ({ page: clients[i].name, ...d })))
    const failed = Boolean(error) || attempt.some((r) => !r.ok)
    if (drops.length) {
      tally.drops.push(...drops.map((d) => `${d.page} ${d.code}`))
      await rejoined(hostBefore)
    }
    const decision = retryDecision({ failed, drops, retried, retriesUsed: tally.retries, supported, retryable })
    if (decision === 'retry') {
      tally.retries++
      console.log(`RETRY ${name}: ${drops.map((d) => `${d.page} closed ${d.code}`).join(', ')} while it ran; failed: ${attempt.filter((r) => !r.ok).map((r) => r.name).join(', ') || String(error?.message ?? error)}`)
      continue
    }
    for (const r of attempt) commit(r)
    if (decision === 'unstable') commit({ name: 'network too unstable to verify', ok: false, detail: { step: name, retries: tally.retries, max: MAX_STEP_RETRIES, drops } })
    if (!failed) tally.passed++
    if (error) throw error
    return
  }
}
/** After a drop: every page back as the same player, the host unchanged, nobody listed twice. */
async function rejoined(hostBefore) {
  await Promise.all(clients.map((c) => c.page.waitForFunction(() => window.syn3hNet?.connected && window.syn3hNet.welcomed, null, { timeout: 30000 }).catch(() => {})))
  const views = await Promise.all(clients.map((c) => c.page.evaluate(() => ({ id: window.syn3hNet.id, host: window.syn3hNet.game.host, humans: [...window.syn3hNet.players.values()].filter((p) => !p.bot).map((p) => p.id) })).catch((e) => ({ error: String(e) }))))
  const ok = views.every((v, i) => !v.error && v.id === ids.get(clients[i].name) && v.host === hostBefore && v.humans.length === clients.length && new Set(v.humans).size === v.humans.length)
  commit({ name: 'after a dropped connection: same player ids, same host, nobody listed twice', ok, detail: { hostBefore, ids: Object.fromEntries(ids), views } })
}

try {
  const a = await open('Alice')
  await a.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  check('new room defaults to Explore', await a.evaluate(() => window.syn3hNet.game.mode === 2 && window.syn3hNet.game.it === 0))
  await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
  // The host keeps the bots it asked for whatever its frame rate (bots.keepCount, v26.11.1713):
  // on a loaded test machine the pacer otherwise judges the first bot costly and allows none
  // (v26.11.1803's dry run, 18 Nov: added at 8.5 s, removed at 12.6 s, allowed 0). The smoke
  // tests replication, not pacing, which has its own tests. Guarded for builds without it.
  await a.evaluate(() => { const p = window.syn3h.params; if (p.get('bots.keepCount')) p.set('bots.keepCount', true) })
  await spyAudio(a)
  const b = await open('Bob')
  const both = (fn, arg) => Promise.all([a.evaluate(fn, arg), b.evaluate(fn, arg)])
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.syn3hNet?.connected && [...window.syn3hNet.players.values()].filter(p => !p.bot).length === 2, null, { timeout: 30000 })))
  const [idA, idB] = await both(() => window.syn3hNet.id)
  ids.set('Alice', idA); ids.set('Bob', idB)
  const humanViews = await both(() => [...window.syn3hNet.players.values()].filter(p => !p.bot))
  check('both connected and see each other', idA && idB && idA !== idB && humanViews.every(ps => ps.length === 2 && ps.some(p => p.id === idA && p.name === 'Alice') && ps.some(p => p.id === idB && p.name === 'Bob')), { idA, idB, humanViews })
  // Bots arrive one at a time since v26.11.1708, slower on a loaded machine: allow 30 s, and say
  // plainly if none came rather than failing on a bare timeout.
  const botsCame = await Promise.all([a, b].map(p => p.waitForFunction(() => [...window.syn3hNet.players.values()].some(p => p.bot), null, { timeout: 30000 }).then(() => true, () => false)))
  if (!botsCame.every(Boolean)) throw new Error(`no bot arrived within 30 s (A ${botsCame[0]}, B ${botsCame[1]}): the pacer may be holding bots back on a slow machine; rerun`)
  const readBots = () => both(() => ({ requested: window.syn3h.params.get('bots.count').value, ids: [...window.syn3hNet.players.values()].filter(p => p.bot).map(p => p.id).sort(), effective: window.syn3h.bots.vehicles.length }))
  let defaultBots = await readBots()
  for (let i = 0; i < 50 && !(defaultBots[0].ids.length === defaultBots[0].effective && defaultBots[0].effective > 0 && JSON.stringify(defaultBots[0].ids) === JSON.stringify(defaultBots[1].ids)); i++) {
    await wait(200)
    defaultBots = await readBots()
  }
  check('default bots join and replicate', defaultBots.every(v => v.requested === 4 && v.ids.length > 0) && defaultBots[0].ids.length === defaultBots[0].effective && JSON.stringify(defaultBots[0].ids) === JSON.stringify(defaultBots[1].ids), defaultBots)
  // Preserve normal-default coverage above, then isolate the two-human scoring fixture.
  // Section 9 separately exercises the real manager and bot hit authority.
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await Promise.all([a, b].map(p => p.waitForFunction(() => ![...window.syn3hNet.players.values()].some(p => p.bot), null, { timeout: 10000 })))


  // B needs a few snapshots of A before A's remote vehicle exists there.
  await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), idA, { timeout: 10000 })
  await spyAudio(b)
  const remoteOfA = () => b.evaluate((id) => {
    const t = window.syn3hNet.remotes.get(id).vehicle.body.translation()
    return [t.x, t.y, t.z]
  }, idA)
  const realA = () => a.evaluate(() => { const t = window.syn3h.player.body.translation(); return [t.x, t.y, t.z] })
  const d2 = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2])

  // 2. Drive A forward and watch it on B.
  await step('drive', async () => {
  // Both pages share one headless Chrome, and a page that is still loading starves the other
  // of frames: wait until B's game is running before asking A to drive, and drive until A
  // has covered ground (up to 10 s), not for a fixed time that a busy machine can eat.
  await b.waitForFunction(() => window.syn3h.game.time > 1.5, null, { timeout: 30000 }).catch(() => {})
  const before = await remoteOfA()
  const realBefore = await realA()
  const startA = realBefore
  // What the vehicle is doing as the drive starts and each second of it, so a failure says
  // whether it was held in its arrival, airborne, in liquid, braking or not getting throttle.
  const driveState = () => a.evaluate(() => {
    const s = window.syn3h, v = s.player, p = v.body.translation(), l = v.body.linvel()
    return {
      held: s.materialize?.isHeld?.(v) ?? null, arriving: s.materialize?.isMaterializing?.(v) ?? null,
      wheels: v.wheelsGrounded, speed: +Math.hypot(l.x, l.z).toFixed(1), vy: +l.y.toFixed(1),
      throttle: v.input.y, brakes: v.input.brakes, special: v.input.special,
      surface: s.terrain.surfaceAt?.(p.x, p.z) ?? null,
      inLiquid: (s.terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity) > p.y - 0.3,
      aboveGround: +(p.y - s.terrain.heightAt(p.x, p.z)).toFixed(2),
    }
  })
  // A vehicle can move under input from the moment the game says it is drivable: its arrival
  // finished and its wheels down. Wait for that state (up to 20 s, timed), then time the drive.
  const drivableT0 = Date.now()
  const drivable = await a.waitForFunction(() => { const v = window.syn3h.player; return !window.syn3h.materialize?.isMaterializing?.(v) && v.wheelsGrounded > 0 }, null, { timeout: 20000 }).then(() => true, () => false)
  const driveStart = { drivable, waitedForDrivableMs: Date.now() - drivableT0, ...(await driveState()), world: await a.evaluate(() => ({ planet: syn3h.planets.currentPlanet().id, seed: syn3h.params.get('world.seed').value, spawn: syn3h.player.spawnSlot })) }
  const drivePerSecond = []
  await a.bringToFront()
  await a.keyboard.down('KeyW')
  const driveT0 = Date.now()
  while (Date.now() - driveT0 < 10000) {
    await wait(1000)
    const now = await driveState(), t = await realA()
    drivePerSecond.push({ s: Math.round((Date.now() - driveT0) / 1000), moved: +d2(startA, t).toFixed(1), ...now })
    if (d2(startA, t) > 12) break
  }
  await a.keyboard.up('KeyW')
  // The buggy coasts; compare once it has stopped and B's playback has caught up.
  await a.keyboard.down('ShiftLeft')
  await a.waitForFunction(() => { const v = window.syn3h.player.body.linvel(); return Math.hypot(v.x, v.z) < 0.3 }, null, { timeout: 8000 }).catch(() => {})
  await a.keyboard.up('ShiftLeft')
  // Two separate questions, so a slow buggy and a starved copy are told apart: did A itself
  // drive (read on A), and did B's copy of A follow (read on B). B's page is in the background
  // while A is driven, and under load its playback lags, so wait for the copy to move instead
  // of sleeping a fixed time: up to 10 s for the 3 m that 3 s of throttle exceeds tenfold.
  const truth = await realA()
  check('A itself drives', d2(realBefore, truth) > 10, { before: realBefore, after: truth, moved: +d2(realBefore, truth).toFixed(2), start: driveStart, perSecond: drivePerSecond })
  let after = await remoteOfA()
  for (let i = 0; i < 50 && !(d2(before, after) > 3 && d2(after, truth) < 2); i++) { await wait(200); after = await remoteOfA() }
  check('A moves on B', d2(before, after) > 3, { before, after, moved: +d2(before, after).toFixed(2) })
  check('B tracks A within 2 m once settled', d2(after, truth) < 2, { remote: after, real: truth, error: +d2(after, truth).toFixed(2) })
  })

  // Releases cut before the shared room clock existed have neither `seaTime` nor `onRoomClock`
  // on the network client: skip these two checks there instead of failing the release.
  await step('room clock', async () => {
  const hasRoomClock = await a.evaluate(() => typeof window.syn3hNet?.onRoomClock === 'function' && window.syn3hNet.seaTime !== undefined)
  if (!hasRoomClock) console.log('SKIP shared room clock checks: this build predates them')
  else {
    // The sea runs on the room's clock, so both screens show the same wave at the same moment;
    // the wind is handed the same clock through the same hook. Read through the network client
    // (importing the modules by path can give a second copy of them on a dev server). The sea
    // takes the room clock a moment after it syncs, calming the swell across the change.
    await Promise.all([a, b].map((p) => p.waitForFunction(() => Math.abs(window.syn3hNet.seaTime - window.syn3hNet.clock.now()) < 0.05, null, { timeout: 8000 }).catch(() => {})))
    const clocks = (page) => page.evaluate(() => {
      const n = window.syn3hNet
      let handed = null
      n.onRoomClock((now) => { handed = now() })
      return { sea: n.seaTime, room: n.clock.now(), game: window.syn3h.game.time, handed, at: Date.now() }
    })
    const [seaA, seaB] = await Promise.all([clocks(a), clocks(b)])
    // Each was read at its own instant; compare after allowing for that.
    const apart = Math.abs((seaA.sea - seaA.at / 1000) - (seaB.sea - seaB.at / 1000))
    check('the sea runs on the shared room clock on both screens', Math.abs(seaA.sea - seaA.room) < 0.05 && Math.abs(seaB.sea - seaB.room) < 0.05 && apart < 0.15 && Math.abs(seaA.sea - seaA.game) > 1,
      { apartSeconds: +apart.toFixed(3), aSeaMinusRoom: +(seaA.sea - seaA.room).toFixed(3), bSeaMinusRoom: +(seaB.sea - seaB.room).toFixed(3) })
    check('onRoomClock hands a later asker the room clock at once', seaA.handed !== null && Math.abs(seaA.handed - seaA.room) < 0.05 && seaB.handed !== null && Math.abs(seaB.handed - seaB.room) < 0.05,
      { aHandedMinusRoom: seaA.handed === null ? null : +(seaA.handed - seaA.room).toFixed(3), bHandedMinusRoom: seaB.handed === null ? null : +(seaB.handed - seaB.room).toFixed(3) })
  }

  })

  // 3. Shared slider, clamped by the server.
  await step('shared sliders', async () => {
  await a.evaluate(() => window.syn3h.params.set('laser.speed', 250))
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 500))
  // Wait for the values to arrive, up to 5 s: a fixed half second was sometimes too short on
  // a public address just after a deploy. The checks below still fail if they never do.
  await b.waitForFunction(() => window.syn3h.params.get('laser.speed').value === 250 && window.syn3h.params.get('world.gravity').value === 18.81, null, { timeout: 5000 }).catch(() => {})
  await a.waitForFunction(() => window.syn3h.params.get('world.gravity').value === 18.81, null, { timeout: 5000 }).catch(() => {})
  const [speedB, gravB, gravA] = await b.evaluate(() => [window.syn3h.params.get('laser.speed').value, window.syn3h.params.get('world.gravity').value]).then(async (r) => [...r, await a.evaluate(() => window.syn3h.params.get('world.gravity').value)])
  check('shared slider reaches B', speedB === 250, { speedB })
  check('server clamps a shared slider for everyone', gravB === 18.81 && gravA === 18.81, { gravA, gravB })
  await a.evaluate(() => window.syn3h.params.set('world.gravity', 9.81))
  })

  // 4 to 6 run as one step: the laser tag needs the "it" the ram passed, and the sounds both.
  // Every counter is read against the step's own start, so a second run proves the same thing.
  await step('tag', async ({ retried }) => {
  // The first run is the fixture: A is "it" and rams B, then B (now it) tags A. A second run
  // (after a dropped connection) starts from whoever the first run left as "it": that player
  // rams and the other tags back, the same rules with the roles taken from the room.
  // Reset scores after removing default bots, then verify Alice still holds it before the ram fixture.
  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  await b.waitForFunction(() => window.syn3hNet.game.mode === 1)
  await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
  if (!retried) await Promise.all([a, b].map(p => p.waitForFunction(id => window.syn3hNet.game.mode === 0 && window.syn3hNet.game.it === id, idA)))
  else await Promise.all([a, b].map(p => p.waitForFunction(ids => window.syn3hNet.game.mode === 0 && ids.includes(window.syn3hNet.game.it), [idA, idB])))
  const itStart = await a.evaluate(() => window.syn3hNet.game.it)
  const [H, V, idH, idV] = itStart === idB ? [b, a, idB, idA] : [a, b, idA, idB]
  const ramsBase = await both(() => window.syn3hNet.stats.rams)
  const hitsBase = await H.evaluate(() => window.syn3hNet.stats.hitsTaken)
  const callsBase = await Promise.all([H, V].map((p) => p.evaluate(() => window.__audioCalls.length)))
  // 4. Ram. The hunter (A on the first run) starts as "it". Park the other just ahead, then drive into it.
  const itBefore = itStart
  await H.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    window.syn3h.player.teleport(s.position, 0)
  })
  await V.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    s.position.z -= 7
    s.position.y = window.syn3h.terrain.heightAt(s.position.x, s.position.z) + 1.5
    window.syn3h.player.teleport(s.position, 0)
  })
  await wait(1500) // let both settle and the join cooldown expire
  await H.bringToFront()
  await H.keyboard.down('KeyW')
  await H.waitForFunction((base) => window.syn3hNet.stats.rams > base, ramsBase[H === a ? 0 : 1], { timeout: 8000 }).catch(() => {})
  await H.keyboard.up('KeyW')
  const rammed = await settle(async () => [...await both(() => window.syn3hNet.stats.rams), ...await both(() => window.syn3hNet.game.it)],
    ([rA, rB, iA, iB]) => rA - ramsBase[0] + rB - ramsBase[1] > 0 && iA === idV && iB === idV)
  const [ramsA, ramsB, itA, itB] = rammed.value
  check('ram detected', ramsA - ramsBase[0] + ramsB - ramsBase[1] > 0, { ramsA, ramsB, ramsBase, waitedMs: rammed.waitedMs })
  check('ramming passes "it" from A to B', (retried || itBefore === idA) && itA === idV && itB === idV, { itBefore, itA, itB, hunter: idH, waitedMs: rammed.waitedMs })

  // 5. Laser tag. Separate the two so no further contact passes "it" back, wait out the tag
  // cooldown, then the new "it" shoots at where it sees the hunter.
  await V.evaluate(() => {
    const a = window.syn3h.terrain.spawnPoint(0)
    const p = a.position.clone()
    p.z += 20
    p.y = window.syn3h.terrain.heightAt(p.x, p.z) + 1.5
    window.syn3h.player.teleport(p, 0)
  })
  await wait(3300)
  const scoreBefore = await H.evaluate((id) => { window.__shotEvidence?.begin('human',id,window.syn3hNet.id); return window.syn3hNet.game.scores[id] ?? 0 }, idV)
  for (let i = 0; i < 6; i++) {
    await V.evaluate((id) => {
      const n = window.syn3hNet
      window.__shotEvidence?.begin('human',n.id,id)
      const target = n.remotes.get(id).vehicle.body.translation()
      n.fire(undefined, target)
    }, idH)
    const hit = await H.waitForFunction((base) => window.syn3hNet.stats.hitsTaken > base, hitsBase, { timeout: 1500 }).then(() => true, () => false)
    if (hit) break
    await wait(400)
  }
  const scored = await settle(() => H.evaluate((id) => [window.syn3hNet.stats.hitsTaken, window.syn3hNet.game.scores[id] ?? 0], idV), ([h, sc]) => h > hitsBase && sc === scoreBefore + 1)
  const hitsA = scored.value[0]
  const scoreSample = evidenceEnabled ? await H.evaluate((id) => ({value:window.syn3hNet.game.scores[id] ?? 0, at:performance.now(), evidence:window.__shotEvidence.snapshot('human')}), idV) : null
  const scoreAfter = evidenceEnabled ? scoreSample.value : await H.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, idV)
  check('victim detects the laser hit', hitsA > hitsBase, { hitsA, hitsBase, waitedMs: scored.waitedMs })
  const itNow = await H.evaluate(() => window.syn3hNet.game.it)
  check('"it" scores for a laser tag', scoreAfter === scoreBefore + 1, { scoreBefore, scoreAfter, it: itNow })

  // 6. Sounds. A heard B arrive at the start; the ram and the shot are heard in this run.
  const calls = (x) => evidenceEnabled ? x.calls : x
  // B's 'hit' frame can arrive a moment after A's page shows the score: wait up to 2 s for it
  // rather than sampling once. The bug this still catches is the shooter never hearing its hit.
  const heardHit = await settle(() => audioCalls(V), (x) => calls(x).slice(callsBase[1]).includes('laserHit'), 2000)
  const [soundSampleH, soundSampleV, soundSampleA] = [await audioCalls(H), heardHit.value, await audioCalls(a)]
  const [soundsA, soundsB] = [calls(soundSampleH), calls(soundSampleV)]
  check('sounds: A heard B materialize and the ram', calls(soundSampleA).includes('materialize') && soundsA.slice(callsBase[0]).some((c) => c.startsWith('impact:')), { soundsA })
  check('sounds: B heard its shot and the hit', soundsB.slice(callsBase[1]).includes('laserShot') && soundsB.slice(callsBase[1]).includes('laserHit'), { soundsB })
  if (evidenceEnabled) {
    const soundSampleB = soundSampleV
    const humanOriginals = (current ?? results).filter(r => ['victim detects the laser hit','"it" scores for a laser tag','sounds: B heard its shot and the hit'].includes(r.name)).map(r=>r.ok)
    check('matched human shot evidence at original samples', createShotDecision().seal({originals:humanOriginals,local:scoreSample.evidence,remote:soundSampleB.evidence,score:scoreAfter,scoreBefore,requireScore:true}).ok, {scoreSample,soundSampleB})
  }
  })

  // 7. Identity and name tags.
  await step('identity', async () => {
  await a.evaluate(() => window.syn3hNet.setProfile({ kind: 'buggy-syn3h', colors: { body: '#FF2200', accent: '#00ffcc' } }))
  // Wait for the colour: the kind is already the default, so waiting on it alone returned at
  // once and read the old colours whenever the link had real latency.
  await b.waitForFunction((id) => window.syn3hNet.players.get(id)?.colors[0] === '#ff2200', idA, { timeout: 5000 }).catch(() => {})
  const infoA = await b.evaluate((id) => window.syn3hNet.players.get(id), idA)
  check('vehicle kind and colours reach B', infoA?.kind === 'buggy-syn3h' && infoA.colors[0] === '#ff2200' && infoA.colors[1] === '#00ffcc', infoA)
  // Put B behind A, looking at it, so A's tag is on B's screen.
  await a.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(0); window.syn3h.player.teleport(s.position, 0) })
  await b.evaluate(() => {
    const s = window.syn3h.terrain.spawnPoint(0)
    s.position.z += 14
    s.position.y = window.syn3h.terrain.heightAt(s.position.x, s.position.z) + 1.5
    window.syn3h.player.teleport(s.position, 0)
  })
  const tagged = await settle(() => b.evaluate(() => [...document.querySelectorAll('.syn3h-nametags div')].map((d) => ({ text: d.textContent, display: d.style.display, opacity: d.style.opacity }))),
    (tags) => tags.some((t) => t.text.startsWith('Alice') && t.display === 'block' && Number(t.opacity) > 0.5))
  const tag = tagged.value
  check('B shows a name tag for A', tag.some((t) => t.text.startsWith('Alice') && t.display === 'block' && Number(t.opacity) > 0.5), { tag, waitedMs: tagged.waitedMs })
  await b.screenshot({ path: shot })
  })

  // 8. Hidden tab heartbeat.
  await step('hidden tab', async () => {
  const beatsBase = await b.evaluate(() => window.syn3hNet.stats.heartbeats)
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hid = await settle(async () => ({
    ...await a.evaluate((id) => { const r = window.syn3hNet.remotes.get(id); return { paused: r.paused, responding: r.responding } }, idB),
    beats: await b.evaluate(() => window.syn3hNet.stats.heartbeats),
    hud: await a.evaluate(() => document.getElementById('hud').textContent),
  }), (v) => v.paused && v.responding && v.beats - beatsBase >= 2 && v.hud.includes('(paused)'))
  const { hud: hudPaused, ...hiddenView } = hid.value
  check('hidden tab shows as paused, not lost', hiddenView.paused && hiddenView.responding && hiddenView.beats - beatsBase >= 2 && hudPaused.includes('(paused)'), { ...hiddenView, beatsBase, waitedMs: hid.waitedMs })
  await b.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const resumed = await settle(() => a.evaluate((id) => window.syn3hNet.remotes.get(id).paused, idB), (paused) => paused === false)
  check('returning tab resumes', resumed.value === false, { paused: resumed.value, waitedMs: resumed.waitedMs })

  })

  // 9. Exercise the actual manager in both Vite and production, without module imports.
  await step('bots', async () => {
  // A second run starts with no bot, as the first does.
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 0, null, { timeout: 8000 }).catch(() => {})
  await a.evaluate(() => {
    const s = window.syn3h
    s.params.set('bots.canDrive', false); s.params.set('bots.canFire', false)
    // This step tests networking, not the frame rate: keep the one bot whatever a loaded
    // headless page measures (bots.keepCount), or the pacer may judge it away mid-step.
    if (s.params.get('bots.keepCount')) s.params.set('bots.keepCount', true)
    s.params.set('bots.count', 1)
    window.__bots = s.bots
  })
  const botMade = await a.waitForFunction(() => window.syn3h.bots.vehicles.length === 1, null, { timeout: 8000 }).then(() => true, () => false)
  check('host manager spawns a bot', botMade, {})
  const ownership = await both(() => window.syn3h.bots.remote)
  check('only the host bot manager drives', ownership[0] === false && ownership[1] === true, { ownership })
  if (botMade === true) {
    const BOT = 0xff00
    await b.waitForFunction((id) => window.syn3hNet.remotes.has(id), BOT, { timeout: 8000 }).catch(() => {})
    const seen = await settle(async () => [
      await b.evaluate((id) => { const r = window.syn3hNet.remotes.get(id); if (!r) return null; const t = r.vehicle.body.translation(); return [t.x, t.y, t.z] }, BOT),
      await a.evaluate(() => { const t = window.__bots.vehicles[0].body.translation(); return [t.x, t.y, t.z] }),
    ], ([view, real]) => view && d2(view, real) < 2)
    const [botView, botReal] = seen.value
    check('B sees the host\'s bot where it is', botView && d2(botView, botReal) < 2, { botView, botReal, waitedMs: seen.waitedMs })
    // Audio hears the other player and the bot on both sides (replica on B, own bot on A).
    const audible = await both(() => window.syn3hNet.audibleVehicles().length)
    check('audio gets the other player and the bot', audible[0] === 2 && audible[1] === 2, { audible })
    const judgedBefore = await a.evaluate(({shooter,victim}) => { window.__shotEvidence?.begin('bot',shooter,victim); return window.syn3hNet.stats.hitsJudged }, {shooter:idB,victim:BOT})
    for (let i = 0; i < 6; i++) {
      // Since v26.11.1708 the host's pacer or the quality governor can send a bot away when frames
      // look costly (a loaded test machine does). Wait for B to have it before each shot, and say
      // so plainly if it is gone, rather than reading a remote that is not there.
      const present = await b.waitForFunction((id) => !!window.syn3hNet.remotes.get(id)?.vehicle, BOT, { timeout: 5000 }).then(() => true, () => false)
      if (!present) throw new Error('the bot left (pacer or relief) before B could tag it; rerun')
      await b.evaluate((id) => {
        const n = window.syn3hNet
        window.__shotEvidence?.begin('bot',n.id,id)
        const target = n.remotes.get(id).vehicle.body.translation()
        n.fire(undefined, target)
      }, BOT)
      const ok = await a.waitForFunction((j) => window.syn3hNet.stats.hitsJudged > j, judgedBefore, { timeout: 2000 }).then(() => true, () => false)
      if (ok) break
      await wait(400)
    }
    await settle(async () => [await a.evaluate(() => window.syn3hNet.stats.hitsJudged), await b.evaluate(() => window.__audioCalls.filter((c) => c === 'laserHit').length)],
      ([judgedNow, hitsHeard]) => judgedNow > judgedBefore && hitsHeard >= 2)
    const judgedSample = evidenceEnabled ? await a.evaluate(() => ({value:window.syn3hNet.stats.hitsJudged,at:performance.now(),evidence:window.__shotEvidence.snapshot('bot')})) : null
    const judged = evidenceEnabled ? judgedSample.value : await a.evaluate(() => window.syn3hNet.stats.hitsJudged)
    const botSoundSample = evidenceEnabled ? await b.evaluate(() => ({value:window.__audioCalls.filter((c) => c === 'laserHit').length,at:performance.now(),evidence:window.__shotEvidence.snapshot('bot')})) : null
    const hitSeen = evidenceEnabled ? botSoundSample.value : await b.evaluate(() => window.__audioCalls.filter((c) => c === 'laserHit').length)
    const diag = { a: await a.evaluate(() => ({ lasers: window.syn3hNet.lasers.count, host: window.syn3hNet.isHost })), bFired: await b.evaluate(() => window.syn3hNet.stats.shotsFired) }
    check('host judges a laser hit on its bot', judged > judgedBefore && hitSeen >= 2, { judgedBefore, judged, hitSoundsOnB: hitSeen, ...diag })
    if (evidenceEnabled) check('matched bot shot evidence at original samples',createShotDecision().seal({originals:[(current ?? results).at(-1).ok],local:judgedSample.evidence,remote:botSoundSample.evidence}).ok,{judgedSample,botSoundSample})
  }
  await a.evaluate(() => window.syn3h.params.set('bots.count', 0))
  })

  // 10. World seed, and a late joiner who arrives with a different one. Opening a page cannot
  // be repeated, so this step never runs twice.
  await step('seed and a late joiner', async () => {
  await a.evaluate(() => window.syn3h.params.set('world.seed', 4242))
  const onGround = (page) => page.evaluate(() => {
    const p = window.syn3h.player.body.translation()
    return { seed: window.syn3h.params.get('world.seed').value, y: +p.y.toFixed(2), ground: +window.syn3h.terrain.heightAt(p.x, p.z).toFixed(2) }
  })
  const landed = (v) => v.seed === 4242 && v.y > v.ground - 1 && v.y < v.ground + 6
  const seedB = (await settle(() => onGround(b), landed)).value
  check('seed reaches B and B stays on the new ground', seedB.seed === 4242 && seedB.y > seedB.ground - 1 && seedB.y < seedB.ground + 6, seedB)
  const c = await open('Carol', '&seed=777')
  await c.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: 30000 })
  ids.set('Carol', await c.evaluate(() => window.syn3hNet.id))
  const seedC = (await settle(() => onGround(c), landed)).value
  check('late joiner gets the room seed and lands on that ground', seedC.seed === 4242 && seedC.y > seedC.ground - 1 && seedC.y < seedC.ground + 6, seedC)

  }, { retryable: false })

  // 11. King of the Hill. Spy on the shell's match display and inject a seeded bot namer, as
  // main.ts would pass them.
  await step('king of the hill', async () => {
  // A second run starts a fresh round: King of the Hill is entered from another mode.
  if (await a.evaluate(() => window.syn3hNet.game.mode === 1)) {
    await a.evaluate(() => window.syn3h.params.set('game.mode', 0))
    await b.waitForFunction(() => window.syn3hNet.game.mode === 0, null, { timeout: 8000 }).catch(() => {})
  }
  const stuckBase = await b.evaluate(() => window.syn3hNet.stats.stuck)
  await b.evaluate(() => {
    window.__match = []
    window.syn3hNet.ctx.setMatchState = (m) => window.__match.push(m)
    window.syn3hNet.ctx.names = (seed, kind) => `${kind}-${seed}`
  })
  await a.evaluate(() => window.syn3h.params.set('game.mode', 1))
  // Network state can arrive between frames; the marker updates on the next game step.
  await b.waitForFunction(() => window.syn3hNet.game.mode === 1 && window.syn3hNet.game.koth.zone && window.syn3hNet.hill.visible, null, { timeout: 8000 }).catch(() => {})
  const zone = await b.evaluate(() => window.syn3hNet.game.koth.zone)
  const markerShown = await b.evaluate(() => window.syn3hNet.hill.visible)
  check('mode switch reaches B with the host\'s zone', zone && markerShown, { zone, markerShown })
  if (zone) {
    /** Park a page's vehicle on the zone's mid line at an angle, on the ground. */
    const park = (page, angle) => page.evaluate(({ zone, angle }) => {
      const r = (zone.inner + zone.outer) / 2
      const x = zone.x + Math.cos(angle) * r
      const z = zone.z + Math.sin(angle) * r
      const THREE_V = window.syn3h.player.object.position.clone()
      THREE_V.set(x, window.syn3h.terrain.heightAt(x, z) + 1.2, z)
      window.syn3h.player.teleport(THREE_V, 0)
      const p = window.syn3h.player.body.translation()
      return { p: [p.x, p.y, p.z], lava: window.syn3h.terrain.liquidHeightAt?.(x, z) }
    }, { zone, angle })
    const score = (id) => a.evaluate((id) => window.syn3hNet.game.scores[id] ?? 0, id)
    const parkedA = await park(a, 0.3)
    await b.evaluate(() => { const s = window.syn3h.terrain.spawnPoint(1); window.syn3h.player.teleport(s.position, 0) })
    // Wait for the server's result, rather than starting a four-second timer while a
    // loaded browser may still be delivering the teleport. Keep the scoring threshold.
    const scoringStart = Date.now()
    await a.waitForFunction((id) => window.syn3hNet.game.koth.holder === id && (window.syn3hNet.game.scores[id] ?? 0) >= 2, idA, { timeout: 15000 }).catch(() => {})
    const [holder, scoreA] = [await a.evaluate(() => window.syn3hNet.game.koth.holder), await score(idA)]
    check('A alone on the hill holds it and scores', holder === idA && scoreA >= 2, { holder, scoreA, parkedA, elapsedMs: Date.now() - scoringStart })
    await b.waitForFunction(() => window.__match.at(-1)?.scores.some((x) => x.name === 'Alice' && x.score >= 2), null, { timeout: 5000 }).catch(() => {})
    const held = await b.evaluate(() => window.__match.at(-1))
    check('match display: A holds, scores in seconds, target 60', held?.mode === 'koth' && held.holderName === 'Alice' && !held.holderIsYou && held.target === 60 && held.scores.find((x) => x.name === 'Alice')?.score >= 2 && held.scores.some((x) => x.you), held)
    await b.screenshot({ path: '/tmp/syn3h-koth-far.png' })

    await park(b, 0.3 + 0.15)
    await settle(() => b.evaluate(() => window.syn3hNet.game.koth.contested), (c) => c === true)
    const s1 = await score(idA)
    // A measured window, not a wait for readiness: nobody may score while the hill is contested.
    await wait(2500)
    const s2 = await score(idA)
    const contested = await b.evaluate(() => window.syn3hNet.game.koth.contested)
    const hudB = await b.evaluate(() => document.getElementById('hud').textContent)
    check('B joins and the hill is contested, nobody scores', contested && s2 === s1 && hudB.includes('CONTESTED'), { contested, s1, s2 })
    const cont = await b.evaluate(() => ({ last: window.__match.at(-1), updates: window.__match.length, botName: window.syn3hNet.displayName(0xff00) }))
    check('match display: contested, few updates, seeded bot name', cont.last?.contested === true && cont.last.holderName === null && cont.updates < 40 && cont.botName.startsWith('bot-4242:65280'), cont)
    await b.screenshot({ path: '/tmp/syn3h-koth.png' })

    // Into the lava lake, if this terrain has one under the zone's centre.
    const lavaAt = await b.evaluate((zone) => window.syn3h.terrain.liquidHeightAt?.(zone.x, zone.z) ?? -Infinity, zone)
    if (Number.isFinite(lavaAt)) {
      await b.evaluate(({ zone, lavaAt }) => {
        const v = window.syn3h.player.object.position.clone()
        v.set(zone.x, lavaAt - 0.5, zone.z)
        window.syn3h.player.teleport(v, 0)
      }, { zone, lavaAt })
      const sunk = await settle(async () => ({
        outB: await a.evaluate((id) => window.syn3hNet.game.koth.out[id] ?? 0, idB),
        // B's own line, from its own physics (the room's echo is for everyone else).
        stuck: await b.evaluate(() => ({ count: window.syn3hNet.stats.stuck, visible: window.syn3h.player.object.visible, hud: document.getElementById('hud').textContent.match(/in the lava: off the hill[^\n]*/i)?.[0] ?? null })),
        visibleOnA: await a.evaluate((id) => window.syn3hNet.remotes.get(id)?.vehicle.object.visible === true, idB),
      }), (v) => v.stuck.count === stuckBase + 1 && v.stuck.visible && v.stuck.hud && v.outB > 0 && v.visibleOnA)
      const { outB, stuck, visibleOnA } = sunk.value
      check('lava sticks B: it sits out of the hill count but stays in the world', stuck.count === stuckBase + 1 && stuck.visible && stuck.hud && outB > 0 && visibleOnA, { stuck, outB, visibleOnA, waitedMs: sunk.waitedMs })
      // Nothing but physics moves a player (AGENTS.md): after the old return delay and more, B is
      // still where it sank, still off the hill, and its line still says so: a steady line, not a
      // flicker. The pad is far from the lake, so a return would show as metres moved.
      const sank = await b.evaluate(() => { const p = window.syn3h.player.body.translation(); return { x: p.x, z: p.z } })
      await wait(4000)
      const after = await b.evaluate((sank) => {
        const p = window.syn3h.player.body.translation()
        return { moved: +Math.hypot(p.x - sank.x, p.z - sank.z).toFixed(1), visible: window.syn3h.player.object.visible, hud: document.getElementById('hud').textContent.match(/in the lava: off the hill[^\n]*/i)?.[0] ?? null }
      }, sank)
      const stillOut = await a.evaluate((id) => window.syn3hNet.game.koth.out[id] ?? 0, idB)
      check('B stays in the lava, never moved to its pad, off the hill with a steady line', after.visible && after.moved < 8 && after.hud && stillOut > 0, { ...after, stillOut })
    } else {
      console.log('SKIP lava: no lava under the zone centre on this terrain')
    }
  }
  })

  const hud = await b.evaluate(() => document.getElementById('hud').textContent)
  console.log('B HUD:\n' + hud)
} catch (e) {
  check('no exception', false, { message: String(e?.message ?? e), stack: e?.stack })
} finally {
  try {
    if (evidenceEnabled) {
      saveShotEvidence('finally-start')
      try {
        finalCollectors = await captureShotCollectors()
        for(const name of ['Alice','Bob']) {
          const matches=finalCollectors.filter(c=>c.name===name)
          const c=matches[0]
          if(matches.length!==1 || c.error || c.partial || !Array.isArray(c.phases)) {
            evidenceCaptureFailures.push({name,error:c?.error??'Missing or invalid collector snapshot'}); continue
          }
          for(const label of ['human','bot']) {
            const phases=c.phases.filter(s=>s?.label===label)
            if(phases.length!==1 || phases[0].truncated || phases[0].overflow)
              evidenceCaptureFailures.push({name,label,error:'Missing, truncated or overflowed phase snapshot'})
          }
        }
        evidenceCaptureState = evidenceCaptureFailures.length ? 'failed' : 'complete'
      } catch(e) {
        evidenceCaptureState='failed'; evidenceCaptureFailures.push({error:String(e)})
      }
      saveShotEvidence('finally-collectors')
    }
    // The connection guards every message handler and counts what it catches
    // (Connection.handlerErrors): a caught throw would otherwise look like a missing effect, so any
    // count fails the run. Read while the pages are open; a page that cannot be read says so.
    for (const { name, page } of clients) {
      const counts = await page.evaluate(() => window.syn3hNet?.conn?.handlerErrors ?? {}).catch((e) => ({ unreadable: String(e).slice(0, 120) }))
      if (counts && (counts.unreadable || Object.values(counts).some((n) => n > 0))) handlerErrors.push({ name, counts })
    }
    if (errors.length || results.some(r => !r.ok)) await captureFailure().catch(e => console.error('Diagnostic capture failed', String(e)))
  } finally { await Promise.all(browsers.map((b) => b.close())) }
}

check('no message handler errors on any page', handlerErrors.length === 0, handlerErrors)
check('no page errors', errors.length === 0, errors)
const failed = results.filter((r) => !r.ok)
const evidenceFailed = evidenceEnabled && !evidenceComplete()
// release.sh checks the marker, not Node's exit code. Never print OK for incomplete evidence.
console.log(`NET SMOKE SUMMARY steps passed ${tally.passed}/${tally.steps}; drops ridden through ${tally.drops.length}${tally.drops.length ? ` (${tally.drops.join(', ')})` : ''}; connection errors ${transportErrors.length}${transportErrors.length ? ` (${transportErrors.map((t) => t.slice(0, 160)).join(' | ')})` : ''}; step retries ${tally.retries}/${MAX_STEP_RETRIES}${tally.legacy ? '; this build records no socket closes, so a dropped connection cannot be told from a game failure and no step was retried' : ''}`)
const crashed = crashedPages.length > 0 || failed.some((r) => isBrowserCrash(JSON.stringify(r.detail)))
// A crash is reported as what it is, never as a gameplay failure; tools/smoke-run.sh may restart once.
if (crashed) {
  console.log(`NET SMOKE BROWSER CRASHED (${crashedPages.join(', ') || 'a page'}): the browser running the check crashed; this is not a game or network failure`)
  process.exit(3)
}
console.log(failed.length ? `NET SMOKE FAILED (${failed.length})` : evidenceFailed ? 'NET SMOKE FAILED (incomplete shot evidence)' : `NET SMOKE OK, screenshot ${shot}`)
if (evidenceEnabled) console.log('SHOT EVIDENCE ACCEPTANCE',JSON.stringify({evidenceComplete:evidenceComplete(),evidenceCaptureState,evidenceCaptureFailures,evidenceWriteFailures}))
process.exit(failed.length || evidenceFailed ? 1 : 0)
