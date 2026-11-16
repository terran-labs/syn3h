// SOURCE ONLY, UNRUN. Capability gate; no projectile or About-modal acceptance.
// Requires a separately reviewed dedicated supervisor and an explicit runtime slot.
// The supervisor sets this environment before Node starts, and owns stderr as a pipe.
// Assert before importing Playwright; DEBUG_FILE would bypass that pipe.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

async function main() {
if (process.env.DEBUG !== 'pw:protocol' || process.env.DEBUG_FILE !== undefined ||
    process.env.DEBUG_COLORS !== '0' || process.env.DEBUG_HIDE_DATE !== '1' ||
    process.env.MAX_LOG_LENGTH !== '1048576') throw new Error('reviewed redacted protocol transport required')
const { chromium } = await import('playwright-core')
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST)
const deadline = Date.now() + 480000
const budget = cap => { const ms = Math.min(cap, deadline - Date.now()); assert.ok(ms > 0, '480s absolute deadline'); return ms }
async function bounded(promise, cap = 10000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bounded operation expired')), budget(cap)) })]) }
  finally { clearTimeout(timer) }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const world = 'alpine.1518~bots.count=0,bungee.length=300'
const room = `ux-about-capability-${randomUUID()}`
// Chrome is freshly launched and owned by the external supervisor. No Playwright
// launch, newContext or focus-disabling command is used in this fixture.
const modulePaths = ['src/main.ts', 'src/core/Game.ts', 'src/core/Input.ts', 'src/core/ChaseCamera.ts',
  'src/ui/Shell.ts', 'src/weapons/Gear.ts', 'src/weapons/bungee/Bungee.ts', 'src/weapons/aim.ts', 'src/net/index.ts']
const inventory = ['index.html', ...modulePaths, 'src/ui/shell.css', 'src/world/planets.ts',
  'src/weapons/bungee/params.ts', 'vite.config.ts', 'server/dev.ts', 'package.json', 'package-lock.json',
  'tests/ui/in-play-about-two-peer.mjs', 'tests/ui/in-play-about-two-peer-plan.md']
const report = { failureOrder: [], firstFailure: null, source: expected, status: 'in_progress', scope: 'two-process native-control capability only',
  arrangement: { executable: 'supervisor-pinned Chrome', headless: true, processes: 2, defaultContextsPerProcess: 1, pagesPerContext: 1, noDefaults: true },
  room, world, peers: [], actions: [], errors: [], captureComplete: false,
  limits: ['Local browser clocks are independent; action IDs correlate ordered observations, not simultaneous snapshots.',
    'RAF reads ordinary game.tick advancement; it does not observe every fixed step or an event-turn first step.',
    'Remote cord inventory is read-only TypeScript-private observation. No product fields are written.',
    'No projectile is fired and About is not opened. No modal cancellation or survival verdict.',
    'Headless native input does not establish physical-device, OS visibility or delayed pointer-lock behavior.'] }
const peers = [], pending = [], sources = new Map()
let primary, sequence = 0, identity
await bounded(mkdir(out, { recursive: true }))
async function persist() { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000) }
const failureIds = new WeakMap()
let failureSequence = 0
const knownPhases = new Set(['raw_source', 'action', 'response', 'page_error', 'socket_closed', 'hmr',
  'main', 'partial raw-source receipt', 'partial action receipt', 'before-close partial receipt',
  'final response drain', 'final clean checkout', 'final receipt'])
for (const name of ['A', 'B']) for (const suffix of ['final observer', 'identity session detach',
  'page close', 'context close', 'browser close']) knownPhases.add(`${name} ${suffix}`)
for (const name of ['A', 'B']) knownPhases.add(`failure snapshot ${name}`)
function failure(phase, error, sourceCode, sourcePath) {
  const key = error && (typeof error === 'object' || typeof error === 'function') ? error : null
  if (key && failureIds.has(key)) return failureIds.get(key)
  // Never inspect error name/message/stack, assertion actual/expected or custom getters.
  const entry = { id: ++failureSequence, phase: knownPhases.has(phase) ? phase : 'unknown_phase',
    code: failureSequence <= 128 ? 'operation_failed' : 'failure_record_overflow' }
  if (phase === 'raw_source' && inventory.includes(sourcePath)) {
    entry.path = sourcePath
    if (['fetch', 'read_body', 'persist_response', 'http_status', 'direct_bytes', 'js_export', 'js_decode', 'js_source'].includes(sourceCode)) entry.operation = sourceCode
  }
  if (key) failureIds.set(key, entry)
  report.firstFailure ??= entry
  if (report.failureOrder.length < 129) report.failureOrder.push(entry)
  return entry
}
function addError(phase, error) {
  const entry = failure(phase, error)
  if (report.errors.length < 129) report.errors.push(entry)
  return entry
}
const observe = (phase, fn) => (...args) => {
  try { return fn(...args) } catch (error) { addError(phase, error) }
}
async function attempt(label, fn) {
  try { return await fn() } catch (error) { addError(label, error); return undefined }
}
async function drain() {
  for (let cursor = 0; cursor < pending.length;) {
    const end = pending.length
    await bounded(Promise.allSettled(pending.slice(cursor, end)))
    cursor = end
  }
}
function cleanSource() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
}
function verifySourceRepresentation(path, bytes, local, mark = () => {}) {
  const text = bytes.toString('utf8')
  if (path === 'tests/ui/in-play-about-two-peer-plan.md' || path === 'package.json' || path === 'package-lock.json') {
    mark('direct_bytes')
    assert.ok(bytes.equals(local), 'direct bytes')
    assert.equal(hash(bytes), hash(local), 'direct hash')
    return
  }
  mark('js_export')
  const literal = text.match(/^export default ("(?:[^"\\]|\\.)*")/m)
  assert.ok(literal, `raw export ${path}`)
  mark('js_decode')
  const decoded = JSON.parse(literal[1])
  mark('js_source')
  assert.equal(decoded, local.toString(), path)
}

async function sourceProof(stage) {
  cleanSource()
  const rows = []; report[stage] = rows
  for (const path of inventory) {
    const local = await bounded(readFile(new URL(`../../${path}`, import.meta.url)))
    sources.set(path, local.toString())
    const row = { path, localSha256: hash(local) }; rows.push(row)
    // HTML needs explicit import semantics. Browser navigation proof is separate.
    const url = new URL(`/${path}?raw${path === 'index.html' ? '&import' : ''}`, origin)
    let sourceCode = 'fetch'
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(budget(10000)) })
      Object.assign(row, { url: url.href, status: response.status,
        headerHashes: Object.fromEntries(['content-type', 'content-length', 'etag'].map(k => [k, response.headers.has(k) ? hash(response.headers.get(k)) : null])) })
      sourceCode = 'read_body'
      const bytes = Buffer.from(await bounded(response.arrayBuffer()))
      Object.assign(row, { bytes: bytes.length, sha256: hash(bytes),
        representation: (path === 'tests/ui/in-play-about-two-peer-plan.md' || path === 'package.json' || path === 'package-lock.json') ? 'direct_bytes' : 'js_raw_export' })
      sourceCode = 'persist_response'
      await persist()
      sourceCode = 'http_status'
      assert.equal(response.status, 200, path)
      verifySourceRepresentation(path, bytes, local, code => { sourceCode = code })
    } catch (error) {
      row.error = failure('raw_source', error, sourceCode, path)
      await attempt('partial raw-source receipt', persist)
      throw error
    }
  }
  return rows.map(({ path, localSha256 }) => ({ path, localSha256 }))
}

// Installed before navigation on BOTH pages. All mutations below belong to the
// fixture's own observer. Product state and native lifecycle remain untouched.
function installObservation() {
  const events = [], faults = [], expectedCords = new Map()
  let activeIdentity = null
  let actionId = 'before-entry', armed = false, stopped = false, dropped = 0, raf = 0
  let frames = 0, advances = 0, lastTick = null
  const cord = c => c && ({ owner: c.owner, flying: !!c.hook, to: c.to,
    at: c.at ? [c.at.x, c.at.y, c.at.z] : null, normal: [c.normal.x, c.normal.y, c.normal.z] })
  const read = () => {
    const s = window.syn3h, n = window.syn3hNet, g = s?.game
    return { time: performance.now(), actionId, hidden: document.hidden, hasFocus: document.hasFocus(),
      visibility: document.visibilityState, lock: document.pointerLockElement === g?.canvas ? 'canvas' : document.pointerLockElement ? 'other' : 'none',
      tick: g?.tick ?? null, gameTime: g?.time ?? null, playing: s?.shell?.playing ?? false,
      paused: s?.pause?.paused ?? null, reason: s?.pause?.reason ?? null, suspended: g?.input?.suspended ?? null,
      room: s?.shell?.room ?? null, connected: n?.connected ?? false, id: n?.id ?? null, host: n?.game?.host ?? null,
      roster: n ? [...n.players.keys()].sort((a, b) => a - b) : [],
      botCount: s?.params?.get('bots.count')?.value ?? null, seed: s?.params?.get('world.seed')?.value ?? null,
      reach: s?.params?.get('bungee.length')?.value ?? null, gear: n?.gear?.current ?? null,
      fire: g?.input?.state?.fire ?? null, shots: n?.stats?.shotsFired ?? null,
      launched: n?.bungee?.stats.launched ?? null,
      // Read-only private map: canonical owner/anchor identity, not aggregate count.
      cords: n ? [...n.bungee.cords.values()].map(cord).sort((a, b) => a.owner - b.owner) : [],
      activeElement: document.activeElement?.tagName ?? null }
  }
  const fault = reason => { if (!faults.some(f => f.reason === reason)) faults.push({ reason, ...read() }) }
  function check(s) {
    if (!armed) return
    if (s.hidden || !s.hasFocus || s.paused || s.suspended || !s.playing || !s.connected) fault('required active peer lost')
    if (activeIdentity && (s.id !== activeIdentity.id || s.room !== activeIdentity.room ||
      JSON.stringify(s.roster) !== JSON.stringify(activeIdentity.roster))) fault('session identity changed')
    for (const [owner, wanted] of expectedCords) {
      const actual = s.cords.find(c => c.owner === owner)
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) fault(`retained cord changed: ${owner}`)
    }
  }
  function observe(event) {
    // Only true window blur/focus, not descendant control focus changes.
    if ((event.type === 'blur' || event.type === 'focus') && event.target !== window) return
    const s = read()
    if (events.length >= 512) dropped++
    else events.push({ type: event.type, trusted: event.isTrusted, ...s })
    if (armed && ['blur', 'pagehide', 'pointerlockerror'].includes(event.type)) fault(event.type)
    check(s)
    queueMicrotask(() => check(read()))
  }
  const bindings = [[window, 'blur'], [window, 'focus'], [window, 'pagehide'],
    [document, 'visibilitychange'], [document, 'pointerlockchange'], [document, 'pointerlockerror']]
  for (const [target, name] of bindings) target.addEventListener(name, observe, { capture: true, passive: true })
  function frame() {
    if (stopped) return
    frames++; const s = read()
    if (lastTick !== null && s.tick > lastTick) advances++
    lastTick = s.tick; check(s); raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  window.__twoPeerCapability = {
    mark(id) { actionId = id; return read() },
    arm() { activeIdentity = read(); armed = true; check(activeIdentity) },
    retain(c) { expectedCords.set(c.owner, structuredClone(c)); check(read()) },
    snapshot() { const state = read(); check(state); return { state, events: events.slice(), faults: faults.slice(), dropped, frames, advances, stopped } },
    close() { armed = false; stopped = true; cancelAnimationFrame(raf); for (const [target, name] of bindings) target.removeEventListener(name, observe, true) },
  }
}
const actionId = () => report.actions.at(-1)?.id ?? 'entry'
const evaluate = (peer, fn, arg) => bounded(peer.page.evaluate(fn, arg))
const ready = (peer, fn, arg) => bounded(peer.page.waitForFunction(fn, arg, { timeout: budget(15000) }), 15000)
async function sample(peer, actionId) {
  const observation = await evaluate(peer, id => { window.__twoPeerCapability.mark(id); return window.__twoPeerCapability.snapshot() }, actionId)
  peer.record.latest = observation
  return { peer: peer.name, ...observation }
}
function assertActive(observation) {
  const s = observation.state
  assert.equal(observation.dropped, 0, `${observation.peer}: event drops`)
  assert.deepEqual(observation.faults, [], `${observation.peer}: sticky lifecycle/cord fault`)
  assert.equal(s.hidden, false); assert.equal(s.hasFocus, true)
  assert.equal(s.paused, false); assert.equal(s.suspended, false)
  assert.equal(s.playing, true); assert.equal(s.connected, true)
  assert.equal(s.room, room)
  assert.equal(s.botCount, 0); assert.equal(s.seed, 1518); assert.equal(s.reach, 300)
  if (identity) { assert.equal(s.id, identity[observation.peer]); assert.deepEqual(s.roster, Object.values(identity).sort((a, b) => a - b)) }
  assert.equal(s.shots, 0, 'capability fixture never fires a projectile')
}
async function checkpoint(label, action = async () => {}) {
  const row = { id: `${++sequence}:${label}`, status: 'in_progress', before: [], after: [] }
  report.actions.push(row); await persist()
  try {
    for (const peer of peers) { const s = await sample(peer, row.id); row.before.push(s); await persist(); assertActive(s) }
    await action(row)
    for (const peer of peers) {
      const afterAction = await sample(peer, row.id)
      ;(row.afterAction ??= []).push(afterAction); await persist(); assertActive(afterAction)
      await ready(peer, tick => syn3h.game.tick > tick, afterAction.state.tick)
      const s = await sample(peer, row.id); row.after.push(s); await persist(); assertActive(s)
      assert.ok(s.state.tick > afterAction.state.tick, `${peer.name} ordinary ticks advance`)
    }
    await drain(); assert.deepEqual(report.errors, [])
    row.status = 'passed'; await persist()
  } catch (error) {
    row.status = 'failed'; row.error = failure('action', error)
    for (const peer of peers) await attempt(`failure snapshot ${peer.name}`, async () => { row[`${peer.name}Failure`] = await sample(peer, row.id) })
    await attempt('partial action receipt', persist)
    throw error
  }
}
function watchResponses(peer) {
  const { page, record } = peer
  page.on('pageerror', observe('page_error', error => addError('page_error', error)))
  page.on('websocket', observe('response', ws => {
    const socketURL = new URL(ws.url())
    record.sockets.push({ urlSha256: hash(ws.url()), roomSocket: socketURL.pathname === '/ws',
      hostMatches: socketURL.host === new URL(origin).host, roomMatches: socketURL.searchParams.get('room') === room });
    if (new URL(ws.url()).pathname === '/ws') ws.on('close', () => { if (!record.closing) addError('socket_closed') })
    ws.on('framereceived', ({ payload }) => {
    try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) addError('hmr') } catch {}
  }) }))
  page.on('response', observe('response', response => {
    const path = new URL(response.url()).pathname.slice(1), document = response.request().resourceType() === 'document'
    if (!document && !modulePaths.includes(path)) return
    const row = { urlSha256: hash(response.url()), status: response.status(), path: document ? 'navigation_document' : path, document }; record.responses.push(row)
    pending.push((async () => {
      const bytes = await bounded(response.body())
      Object.assign(row, { bytes: bytes.length, sha256: hash(bytes) })
      await persist()
      assert.equal(new URL(response.url()).origin, new URL(origin).origin)
      assert.equal(response.status(), 200); assert.equal(response.fromServiceWorker(), false)
      assert.equal(response.request().redirectedFrom(), null)
      if (document) {
        assert.equal(response.request().isNavigationRequest(), true); assert.equal(response.frame(), page.mainFrame())
        assert.equal(response.url(), peer.url); assert.ok(bytes.toString().includes('/src/main.ts'))
      } else {
        assert.equal(response.request().resourceType(), 'script')
        const map = bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
        assert.ok(map, path)
        assert.ok(JSON.parse(Buffer.from(map[1], 'base64')).sourcesContent.includes(sources.get(path)), `executed source map ${path}`)
        row.sourceSha256 = hash(sources.get(path))
      }
      row.verified = true
    })().catch(error => { row.error = addError('response', error) }))
  }))
}
async function lock(peer) {
  await bounded(peer.page.bringToFront())
  assert.equal((await sample(peer, actionId())).state.lock, 'none', 'capture begins unlocked')
  // Shell's ordinary first-capture canvas click consumes this gesture before fire.
  await bounded(peer.page.locator('#game').click({ position: { x: 640, y: 450 }, timeout: budget(10000) }))
  await ready(peer, () => document.pointerLockElement === syn3h.game.canvas)
}
async function unlock(peer) {
  assert.equal((await sample(peer, actionId())).state.lock, 'canvas')
  await bounded(peer.page.keyboard.press('Escape'))
  await ready(peer, () => document.pointerLockElement === null && !syn3h.pause.paused && syn3h.shell.inspector.open &&
    !document.querySelector('.world-inspector').hidden && !document.querySelector('.world-inspector').inert)
}
async function retainGround(ownerPeer) {
  await ready(ownerPeer, () => syn3hNet.bungee.attached && syn3hNet.bungee.mine?.at && syn3hNet.bungee.mine.to === null)
  const ownerState = (await sample(ownerPeer, actionId())).state
  const wanted = ownerState.cords.find(c => c.owner === ownerState.id)
  assert.ok(wanted && !wanted.flying && wanted.at && wanted.to === null)
  for (const peer of peers) {
    await ready(peer, owner => { const c = syn3hNet.bungee.cords.get(owner); return c && !c.hook && c.at && c.to === null }, wanted.owner)
    const actual = (await sample(peer, actionId())).state.cords.find(c => c.owner === wanted.owner)
    // Bungee.send rounds wire coordinates/normals to centimetres; local storage
    // keeps full precision. Compare exactly to that protocol representation, then
    // retain each peer's own observed identity without a free numerical tolerance.
    const wire = { ...wanted, at: wanted.at.map(v => Math.round(v * 100) / 100),
      normal: wanted.normal.map(v => Math.round(v * 100) / 100) }
    assert.deepEqual(actual, peer === ownerPeer ? wanted : wire, 'canonical owner/anchor at source wire precision')
    await evaluate(peer, c => window.__twoPeerCapability.retain(c), actual)
  }
  return wanted
}
async function attach(peer) {
  await checkpoint(`${peer.name}:one-ground-attachment`, async row => {
    await lock(peer)
    await bounded(peer.page.keyboard.press('Digit4'))
    await ready(peer, () => syn3hNet.gear.current === 'bungee')
    await bounded(peer.page.mouse.move(640, 770, { steps: 12 }))
    row.aim = await evaluate(peer, async () => {
      const { aimFrom } = await import('/src/weapons/aim.ts')
      const { BUNGEE_MUZZLE_UP, BUNGEE_MUZZLE_AHEAD } = await import('/src/weapons/bungee/Bungee.ts')
      const g = syn3h.game, aim = aimFrom(g, syn3h.player.body, 300, BUNGEE_MUZZLE_UP, BUNGEE_MUZZLE_AHEAD, .12, true)
      return { time: performance.now(), point: aim.point?.toArray() ?? null, handle: aim.handle,
        distance: aim.point?.distanceTo(aim.o) ?? null, origin: aim.o.toArray(), direction: aim.d.toArray(),
        reach: syn3h.params.get('bungee.length').value, fire: g.input.state.fire,
        stats: { ...syn3hNet.bungee.stats }, lock: document.pointerLockElement === g.canvas }
    })
    await persist()
    assert.equal(row.aim.lock, true); assert.equal(row.aim.reach, 300); assert.equal(row.aim.fire, false)
    assert.ok(row.aim.point && row.aim.handle === null && row.aim.distance > 5 && row.aim.distance <= 300, 'one declared native aim must hit ground')
    assert.equal(row.aim.stats.launched, 0, 'no earlier launch or retry')
    await bounded(peer.page.keyboard.down('KeyL'))
    // No second attempt if aim/attachment fails. Cleanup closes the owned browser.
    row.cord = await retainGround(peer)
    await bounded(peer.page.keyboard.up('KeyL'))
    assert.equal((await sample(peer, row.id)).state.launched, 1)
    await unlock(peer)
  })
}

try {
  const launch = JSON.parse(await bounded(readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8')))
  assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
  assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1'); assert.ok(launch.roomPort !== 8787 && launch.roomPid && launch.vitePid)
  assert.equal(launch.capabilityArrangement, 'two-fresh-chrome-default-contexts-noDefaults')
  report.launch = { launcherSha256: launch.launcherSha256, roomPid: launch.roomPid, vitePid: launch.vitePid }
  const before = await sourceProof('sourceBefore'); await persist()
  assert.equal(launch.protocolRecorder?.transport, 'parent-stderr-pipe-before-import')
  assert.equal(launch.protocolRecorder?.rawDiskOrUI, false)
  assert.equal(launch.browsers?.length, 2)
  assert.notEqual(launch.browsers[0].pid, launch.browsers[1].pid)
  assert.notEqual(launch.browsers[0].port, launch.browsers[1].port)
  assert.notEqual(launch.browsers[0].profile, launch.browsers[1].profile)
  for (const name of ['A', 'B']) {
    const owned = launch.browsers.find(b => b.name === name)
    assert.ok(owned?.pid > 0 && owned.start && owned.freshProfile === true && owned.noPriorPlaywright === true)
    assert.equal(owned.endpoint, `http://127.0.0.1:${owned.port}`)
    assert.ok(owned.port !== launch.roomPort && owned.port !== launch.vitePort && owned.port !== 8787)
    const peer = { name, record: { name, responses: [], sockets: [],
      browserProcess: { pid: owned.pid, start: owned.start, port: owned.port, profile: owned.profile } } }
    peers.push(peer); report.peers.push(peer.record); await persist()
    peer.browser = await chromium.connectOverCDP(owned.endpoint, { noDefaults: true, timeout: budget(15000) })
    assert.equal(peer.browser.contexts().length, 1, 'one existing default context')
    peer.context = peer.browser.contexts()[0]
    assert.equal(peer.context.pages().length, 1, 'one pre-created blank page')
    peer.page = peer.context.pages()[0]
    assert.equal(peer.page.url(), 'about:blank', 'no prior game navigation')
    peer.page.setDefaultTimeout(10000)
    await bounded(peer.page.setViewportSize({ width: 1280, height: 900 }))
    await bounded(peer.context.addInitScript(installObservation))
    // Read-only target identity, used by the parent to match sanitized attachment
    // events to BOTH peers. This session never sends a focus-emulation command.
    peer.identitySession = await bounded(peer.context.newCDPSession(peer.page))
    const info = await bounded(peer.identitySession.send('Target.getTargetInfo'))
    assert.equal(info.targetInfo.type, 'page'); assert.equal(info.targetInfo.url, 'about:blank')
    assert.match(info.targetInfo.targetId, /^[A-Za-z0-9_.:-]{1,160}$/)
    peer.record.targetAlias = hash(info.targetInfo.targetId)
    const url = new URL(origin); url.searchParams.set('room', room); url.searchParams.set('world', world); peer.url = url.href
    assert.equal(peer.browser.contexts().length, 1)
    assert.equal(peer.context.pages().length, 1)
    watchResponses(peer)
  }
  assert.notEqual(peers[0].record.targetAlias, peers[1].record.targetAlias)
  // Observers exist on both contexts before either game entry.
  for (const peer of peers) {
    await peer.page.goto(peer.url, { timeout: budget(60000) })
    await ready(peer, () => window.syn3h?.shell?.galaxy?.live)
    await bounded(peer.page.locator('.galaxy-label.is-current').click())
    await ready(peer, () => window.syn3hNet?.connected && syn3h.shell.playing && !syn3h.shell.dropping)
    if ((await sample(peer, 'entry')).state.lock === 'canvas') await unlock(peer)
  }
  for (const peer of peers) await ready(peer, () => syn3hNet.players.size === 2)
  identity = Object.fromEntries(await Promise.all(peers.map(async p => [p.name, (await sample(p, 'identity')).state.id])))
  assert.ok(identity.A > 0 && identity.B > 0 && identity.A !== identity.B)
  report.identity = identity
  await drain(); assert.deepEqual(report.errors, [])
  for (const peer of peers) {
    const roomSockets = peer.record.sockets.filter(socket => socket.roomSocket)
    assert.equal(roomSockets.length, 1, 'one real room connection per peer, no reconnect')
    assert.equal(roomSockets[0].roomMatches, true)
    assert.equal(roomSockets[0].hostMatches, true)
    assert.ok(peer.record.responses.some(r => r.document && r.verified), 'actual navigation document proof')
    for (const path of modulePaths) assert.ok(peer.record.responses.some(r => r.path === path && r.verified), `actual executed module ${path}`)
    peer.record.runtime = await evaluate(peer, () => ({ game: syn3h.game.constructor.name, shell: syn3h.shell.constructor.name,
      input: syn3h.game.input.constructor.name, bungee: syn3hNet.bungee.constructor.name, gear: syn3hNet.gear.constructor.name }))
    assert.deepEqual(peer.record.runtime, { game: 'Game', shell: 'Shell', input: 'Input', bungee: 'Bungee', gear: 'GearRack' })
    await evaluate(peer, () => window.__twoPeerCapability.arm())
  }
  await checkpoint('both-active-before-control')
  for (const peer of [peers[0], peers[1], peers[0]]) await checkpoint(`${peer.name}:dry-native-control`, async () => {
    await lock(peer); await unlock(peer)
    for (const p of peers) assert.equal((await sample(p, actionId())).state.launched, 0)
  })
  await attach(peers[0]); await attach(peers[1])
  await checkpoint('B:future-fire-control-position-without-fire', async row => {
    const peer = peers[1]
    await lock(peer); await bounded(peer.page.keyboard.press('Digit1'))
    await ready(peer, () => syn3hNet.gear.current === 'beam')
    await bounded(peer.page.mouse.move(640, 450, { steps: 12 }))
    row.BReady = await sample(peer, row.id); assert.equal(row.BReady.state.lock, 'canvas')
    assert.equal(row.BReady.state.fire, false)
    // A future shot would occur here. This fixture sends no down/shot.
    await unlock(peer)
  })
  await checkpoint('A:future-About-control-position-without-open', async row => {
    const peer = peers[0]; await bounded(peer.page.bringToFront())
    assert.equal((await sample(peer, row.id)).state.lock, 'none')
    const session = peer.page.locator('.rail-players')
    if (!await bounded(session.evaluate(el => el.open))) await bounded(session.locator('summary').click())
    const entry = peer.page.locator('.rail-about'); await bounded(entry.hover())
    row.target = await bounded(entry.evaluate(el => ({ enabled: !el.disabled, rect: el.getBoundingClientRect().toJSON(),
      hit: el.contains(document.elementFromPoint(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2,
        el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2)) })))
    assert.equal(row.target.enabled, true); assert.equal(row.target.hit, true)
    assert.ok(row.target.rect.width >= 44 && row.target.rect.height >= 44)
    assert.equal(await evaluate(peer, () => document.querySelector('.in-play-about').open), false)
  })
  await checkpoint('final-retained-identities')
  report.sourceAfter = await sourceProof('rawSourceAfter')
  assert.deepEqual(report.sourceAfter, before)
  report.status = 'checks_passed_pending_closure'
} catch (error) { primary = error; report.status = 'failed'; report.caughtFailure = failure('main', error); report.primaryError = report.firstFailure }
finally {
  for (const peer of peers) {
    if (peer.page) await attempt(`${peer.name} final observer`, async () => {
      peer.record.finalObservation = await sample(peer, 'final-boundary')
      assert.equal(peer.record.finalObservation.dropped, 0)
      if (!primary) assertActive({ peer: peer.name, ...peer.record.finalObservation })
      await evaluate(peer, () => window.__twoPeerCapability.close())
    })
  }
  await attempt('before-close partial receipt', persist)
  // Stop browser producers, then drain the dynamically growing response queue.
  // Failure of any close is nonpass; the external identity supervisor remains required.
  for (const peer of [...peers].reverse()) {
    peer.record.closing = true
    if (peer.identitySession) await attempt(`${peer.name} identity session detach`, () => bounded(peer.identitySession.detach(), 10000))
    if (peer.page) await attempt(`${peer.name} page close`, () => bounded(peer.page.close(), 10000))
    if (peer.context) await attempt(`${peer.name} context close`, () => bounded(peer.context.close(), 10000))
    if (peer.browser) await attempt(`${peer.name} browser close`, () => bounded(peer.browser.close(), 10000))
    if (peer.browser) peer.record.connectionClosed = !peer.browser.isConnected()
    // CDP connection/context closure is not proof of Chrome exit. The supervisor
    // owns both direct Popen handles, start identities and debugging listeners.
    peer.record.processClosure = 'requires independent supervisor receipt'

  }
  await attempt('final response drain', drain)
  await attempt('final clean checkout', async () => cleanSource())
  report.captureComplete = !primary && report.errors.length === 0
  if (report.captureComplete) report.status = 'capability_checks_passed_pending_protocol_and_process_closure'
  else report.status = 'failed'
  await attempt('final receipt', persist)
}
if (primary || report.errors.length || !report.captureComplete) process.exitCode = 1
}
// Task-local boundary only. No unhandledRejection/uncaughtException interception.
main().catch(() => { process.exitCode = 1 })
