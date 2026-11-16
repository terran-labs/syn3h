// SOURCE-PREPARED, UNRUN. Separate allocation and dedicated app/room launcher required.
// Native Chrome mouse/keyboard; touch context is emulation, not physical hardware.
// The four-slice input gate remains a prerequisite, not replaced by this fixture.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST)
const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
assert.ok(launch.roomPort !== 8787 && launch.roomPid && launch.vitePid)
const deadline = Date.now() + 480000
const budget = cap => { const ms = Math.min(cap, deadline - Date.now()); assert.ok(ms > 0, 'absolute fixture deadline'); return ms }
const bounded = async (promise, cap = 10000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bounded operation expired')), budget(cap)) })]) }
  finally { clearTimeout(timer) }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { source: expected, extensionStatus: 'source-prepared-unrun', cases: [], errors: [], captureComplete: false, limits: ['No physical touch or gamepad-neutral proof', 'Held drive/touch at modal entry and close remain untested', 'Live Yoink modal cancellation remains untested', 'Own Grapple cancellation versus remote gear and launched-projectile survival remains untested', 'Prerequisite four-slice input coverage does not establish these modal-specific behaviors', 'No image assets added', 'Late pointer-lock promise race and real OS visibility require later native validation', 'Synthetic PauseState lifecycle transitions are not native OS visibility'] }
let browser, primary
const pages = [], pending = [], records = new Map()
await mkdir(out, { recursive: true })
async function persist() {
  try { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000) }
  catch (error) { report.errors.push(`Evidence write: ${error}`); throw error }
}
async function drain(jobs) {
  for (let cursor = 0; cursor < jobs.length;) {
    const end = jobs.length
    await bounded(Promise.allSettled(jobs.slice(cursor, end)))
    cursor = end
  }
}
async function provenance() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
  const result = []
  for (const path of ['src/ui/Shell.ts', 'src/ui/shell.css', 'src/ui/data/credits.ts', 'src/main.ts', 'src/core/Input.ts', 'src/weapons/Gear.ts', 'tests/ui/about-input-observers.mjs']) {
    const local = await readFile(new URL(path, new URL('../../', import.meta.url)))
    const response = await fetch(new URL(`/${path}?raw`, origin), { signal: AbortSignal.timeout(budget(10000)) })
    assert.equal(response.status, 200)
    const text = await bounded(response.text())
    const literal = text.match(/^export default ("(?:[^"\\]|\\.)*")/m)
    assert.ok(literal, path); assert.equal(JSON.parse(literal[1]), local.toString())
    result.push({ path, sha256: hash(local) })
  }
  return result
}
const state = page => page.evaluate(() => ({ url: location.href, id: syn3hNet.id, host: syn3hNet.isHost,
  connected: syn3hNet.connected, playing: syn3h.shell.playing, menu: syn3h.shell.menuOpen,
  paused: syn3h.pause.paused, reason: syn3h.pause.reason, tick: syn3h.game.tick,
  suspended: syn3h.game.input.suspended, locked: !!document.pointerLockElement,
  sent: syn3hNet.bigRed.stats.sent, fizzled: syn3hNet.bigRed.stats.fizzled }))
const ready = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: budget(15000) })
// Extensions are deliberately limited to the touch-emulated context. Native KeyW
// does not request pointer lock there, so the normal session entry stays reachable.
async function modalExtensions(page, record, entry, dialog) {
  record.extensions = { classification: { drive: 'native keyboard in touch-emulated Chrome',
    touch: 'synthetic touch PointerEvents through actual stick/TAG handlers',
    yoink: 'actual host bot staged once before acquisition; native KeyL and About clicks' }, results: [] }
  const keep = async item => { record.extensions.results.push(item); await persist() }
  const axes = () => page.evaluate(() => ({ tick: syn3h.game.tick, suspended: syn3h.game.input.suspended,
    axes: ['x', 'y', 'z', 'w'].map(key => syn3h.game.input.state[key]),
    external: ['x', 'y', 'z'].map(key => syn3h.game.input.external[key]), fire: syn3h.game.input.state.fire }))
  const neutral = value => { assert.deepEqual(value.axes, [0, 0, 0, 0]); assert.equal(value.fire, false) }
  const openWhileHeld = async kind => {
    await page.evaluate(kind => {
      window.guideHeldClick = null
      document.querySelector('.rail-about').addEventListener('click', event => {
        const state = { kind, trusted: event.isTrusted, tick: syn3h.game.tick,
          y: syn3h.game.input.state.y, externalY: syn3h.game.input.external.y,
          ready: syn3hNet.bigRed.ready, fire: syn3h.game.input.state.fire,
          suspended: syn3h.game.input.suspended }
        const held = kind === 'W' ? state.y !== 0 : kind === 'stick'
          ? state.externalY !== 0 && state.y !== 0 : state.ready && state.fire
        window.guideHeldClick = { ...state, valid: held && state.trusted && !state.suspended }
        if (!window.guideHeldClick.valid) throw Error(`${kind} hold absent in actual About click turn`)
      }, { capture: true, once: true, passive: true })
    }, kind)
    let clickFailure
    try { await entry.click() } catch (error) { clickFailure = error }
    // Persist the actual-turn scalar snapshot even when the native click failed.
    // This read cannot substitute a later held state for the recorded precondition.
    try {
      const snapshot = await page.evaluate(() => window.guideHeldClick)
      await keep({ phase: 'actual-about-click-precondition', kind, snapshot })
      assert.ok(snapshot, `${kind} About click snapshot missing`)
      assert.equal(snapshot.kind, kind); assert.equal(snapshot.valid, true, `${kind} hold ended before About click`)
    } catch (error) { if (!clickFailure) clickFailure = error }
    if (clickFailure) throw clickFailure
    await dialog.waitFor({ state: 'visible' })
  }

  await entry.focus(); await page.keyboard.down('KeyW')
  await ready(page, () => syn3h.game.input.state.y !== 0)
  const driveBefore = await axes(); await keep({ phase: 'drive-held-before-open', state: driveBefore })
  await openWhileHeld('W')
  const driveOpen = await axes(); neutral(driveOpen); assert.ok(driveOpen.suspended)
  await dialog.locator('.about-back').click()
  await ready(page, tick => syn3h.game.tick > tick, driveOpen.tick)
  const driveClosed = await axes(); neutral(driveClosed)
  await page.keyboard.up('KeyW'); await entry.focus(); await page.keyboard.down('KeyW')
  await ready(page, () => syn3h.game.input.state.y !== 0)
  const freshDrive = await axes(); await page.keyboard.up('KeyW')
  await ready(page, () => syn3h.game.input.state.y === 0)
  await keep({ phase: 'native-drive', driveBefore, driveOpen, driveClosed, freshDrive,
    limit: 'No physical key repeat or vehicle-motion assertion; inertia is not canceled input' })

  // Locate an actual exposed left-side canvas point, excluding the minimap. No
  // synthetic pointer target bypasses the real candidate-region test.
  const point = await page.evaluate(() => {
    const map = document.querySelector('.shell-minimap')?.getBoundingClientRect()
    for (const y of [innerHeight * .55, innerHeight * .4, innerHeight * .7]) for (const x of [8, innerWidth * .15]) {
      if (document.elementFromPoint(x, y) === syn3h.game.canvas &&
          !(map && x >= map.left && x <= map.right && y >= map.top && y <= map.bottom)) return { x, y }
    }
    throw Error('No exposed stick region; no synthetic overlay bypass')
  })
  const touchEvent = (type, id, target, x, y) => page.evaluate(({ type, id, target, x, y }) => {
    const element = target === 'tag' ? document.querySelector('.touch-fire') : syn3h.game.canvas
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch',
      pointerId: id, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, clientX: x, clientY: y }))
  }, { type, id, target, x, y })
  await touchEvent('pointerdown', 701, 'canvas', point.x, point.y)
  await touchEvent('pointermove', 701, 'canvas', point.x, point.y - 50)
  await ready(page, () => syn3h.game.input.external.y !== 0 && syn3h.game.input.state.y !== 0)
  const stickBefore = await axes(); await openWhileHeld('stick')
  const stickOpen = await axes(); neutral(stickOpen); assert.deepEqual(stickOpen.external, [0, 0, 0])
  await dialog.locator('.about-back').click()
  // Old held pointer movement must not restart a reset stick.
  await touchEvent('pointermove', 701, 'canvas', point.x, point.y - 60)
  await ready(page, tick => syn3h.game.tick > tick, stickOpen.tick)
  const stickClosed = await axes(); neutral(stickClosed)
  await touchEvent('pointerup', 701, 'canvas', point.x, point.y - 60)
  await touchEvent('pointerdown', 702, 'canvas', point.x, point.y)
  await touchEvent('pointermove', 702, 'canvas', point.x, point.y - 50)
  await ready(page, () => syn3h.game.input.state.y !== 0)
  const freshStick = await axes(); await touchEvent('pointerup', 702, 'canvas', point.x, point.y - 50)
  await ready(page, () => syn3h.game.input.state.y === 0)
  await keep({ phase: 'synthetic-stick', point, stickBefore, stickOpen, stickClosed, freshStick })

  await page.locator('.touch-fire').waitFor({ state: 'visible' })
  // Read-only evidence for the original 703 gesture. No extra down, repair or
  // cooldown wait: a failed precondition or original readiness timeout stays failed.
  let tagFailure
  try {
    const before703 = await bounded(page.evaluate(() => {
      const button = document.querySelector('.touch-fire'), touch = syn3h.shell.touch
      const input = syn3h.game.input, red = syn3hNet.bigRed
      const events = [], errors = [], listeners = []; let dropped = 0, closed = false
      const identity = node => node === window ? 'window' : node === document ? 'document'
        : node instanceof Element ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${node.className}` : null
      const snapshot = () => ({ at: performance.now(), tick: syn3h.game.tick, time: syn3h.game.time,
        // TS-private field is read only to distinguish actual enabled state from
        // visibility; no new product API or private owner/cooldown mutation.
        active: touch.active, available: touch.available, hidden: touch.element.hidden,
        suspended: input.suspended, gear: syn3hNet.gear.current,
        fire: input.state.fire, externalFire: input.external.fire,
        charge: red.charge, ready: red.ready, sent: red.stats.sent, fizzled: red.stats.fizzled,
        allowed: syn3h.params.get('bigRed.allowed').value,
        chargeSeconds: syn3h.params.get('bigRed.charge').value,
        cooldownSeconds: syn3h.params.get('bigRed.cooldown').value,
        connected: button.isConnected, heldClass: button.classList.contains('held'),
        captured703: button.hasPointerCapture(703), focus: identity(document.activeElement),
        visibility: document.visibilityState, documentFocused: document.hasFocus(),
        rect: button.getBoundingClientRect().toJSON(),
        ownerEligibility: 'Not publicly exposed; held class is not proof',
        cooldownDeadline: 'Not publicly exposed; duration is not remaining cooldown' })
      const save = (phase, event) => {
        if (closed) return
        if (events.length >= 128) { dropped++; return }
        try { events.push({ phase, event, state: snapshot() }) }
        catch (error) { if (errors.length < 8) errors.push(String(error)); else dropped++ }
      }
      const onEvent = event => {
        if (event.type.startsWith('pointer') || event.type === 'lostpointercapture' || event.type === 'gotpointercapture') {
          if (event.pointerId !== 703 && event.target !== button) return
        }
        const scalar = { type: event.type, trusted: event.isTrusted, target: identity(event.target),
          pointerId: event.pointerId, pointerType: event.pointerType, button: event.button,
          buttons: event.buttons, eventTime: event.timeStamp }
        save('capture', scalar)
        queueMicrotask(() => save('post-handler-microtask', scalar))
      }
      window.guideTag703 = { snapshot, save, events, errors, get dropped() { return dropped },
        stop() { closed = true; for (const [target, name] of listeners) target.removeEventListener(name, onEvent, true) } }
      for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'gotpointercapture', 'lostpointercapture', 'blur', 'focus']) {
        window.addEventListener(name, onEvent, { capture: true, passive: true }); listeners.push([window, name])
      }
      document.addEventListener('visibilitychange', onEvent, { capture: true, passive: true })
      listeners.push([document, 'visibilitychange'])
      save('before-dispatch', null)
      return snapshot()
    }))
    await keep({ phase: 'TAG703-precondition', state: before703 })
    assert.equal(before703.active, true); assert.equal(before703.suspended, false)
    assert.equal(before703.gear, 'red')
    await touchEvent('pointerdown', 703, 'tag', 0, 0)
    const after703 = await bounded(page.evaluate(() => {
      guideTag703.save('after-dispatch', null)
      return { events: guideTag703.events, errors: guideTag703.errors, dropped: guideTag703.dropped }
    }))
    await keep({ phase: 'TAG703-after-dispatch', evidence: after703 })
    await ready(page, () => syn3hNet.bigRed.ready && syn3h.game.input.state.fire)
  } catch (error) {
    tagFailure = error
  } finally {
    try {
      const evidence = await bounded(page.evaluate(failed => {
        const trace = window.guideTag703
        if (!trace) return { missing: true }
        try {
          trace.save(failed ? 'failure-or-timeout' : 'ready', null)
          return { events: trace.events, errors: trace.errors, dropped: trace.dropped }
        } finally { trace.stop(); delete window.guideTag703 }
      }, Boolean(tagFailure)))
      await keep({ phase: 'TAG703-evidence', evidence })
      assert.equal(evidence.missing, undefined, 'TAG703 evidence missing')
      assert.deepEqual(evidence.errors, []); assert.equal(evidence.dropped, 0)
    } catch (error) {
      report.errors.push(`TAG703 evidence: ${error}`)
      if (!tagFailure) tagFailure = error
    }
  }
  if (tagFailure) throw tagFailure
  const tagBefore = await page.evaluate(() => ({ ...syn3hNet.bigRed.stats }))
  await openWhileHeld('TAG')
  assert.equal((await axes()).fire, false)
  await dialog.locator('.about-back').click()
  const tagTick = (await axes()).tick
  await ready(page, tick => syn3h.game.tick > tick, tagTick)
  assert.equal((await axes()).fire, false)
  assert.deepEqual(await page.evaluate(() => ({ ...syn3hNet.bigRed.stats })), tagBefore)
  await touchEvent('pointerup', 703, 'tag', 0, 0)
  const cooldown = await page.evaluate(() => syn3h.game.time + syn3h.params.get('bigRed.cooldown').value + .1)
  await ready(page, time => syn3h.game.time >= time, cooldown)
  await touchEvent('pointerdown', 704, 'tag', 0, 0); await ready(page, () => syn3hNet.bigRed.ready)
  await touchEvent('pointerup', 704, 'tag', 0, 0)
  await ready(page, sent => syn3hNet.bigRed.stats.sent === sent + 1, tagBefore.sent)
  await keep({ phase: 'synthetic-held-TAG', before: tagBefore, afterFresh: await page.evaluate(() => ({ ...syn3hNet.bigRed.stats })) })

  // Normal public parameter setup, disclosed as staged. Original zero-bot cases
  // and their observer are finished before changing the roster.
  record.extensions.botRecipe = await page.evaluate(() => {
    const values = { 'bots.canDrive': false, 'bots.tagBeams': false, 'bots.fleet': 0, 'bots.count': 1 }
    const before = Object.fromEntries(Object.keys(values).map(id => [id, syn3h.params.get(id).value]))
    for (const [id, value] of Object.entries(values)) syn3h.params.set(id, value, 'local')
    return { before, applied: values }
  }); await persist()
  await ready(page, () => {
    const rows = [...syn3hNet.players.values()].filter(p => p.bot)
    if (!syn3hNet.isHost || syn3h.bots.vehicles.length !== 1 || rows.length !== 1) return false
    const vehicle = syn3hNet.vehicleOf(rows[0].id), systems = syn3h.game.systems, prior = window.guideCarryRoster
    if (!vehicle || !systems.includes(vehicle)) return false
    if (!prior || prior.vehicle !== vehicle || prior.id !== rows[0].id || prior.systems.length !== systems.length || prior.systems.some((s, i) => s !== systems[i])) {
      window.guideCarryRoster = { vehicle, id: rows[0].id, systems: [...systems], frame: syn3h.game.frames }; return false
    }
    return syn3h.game.frames >= prior.frame + 2
  })
  await page.evaluate(async () => {
    const { installAboutInputObservers } = await import('/tests/ui/about-input-observers.mjs')
    const prior = window.guideCarryRoster, systems = syn3h.game.systems
    if (!prior || prior.systems.length !== systems.length || prior.systems.some((s, i) => s !== systems[i]) ||
        syn3hNet.vehicleOf(prior.id) !== prior.vehicle) throw Error('Carry roster changed before observer installation')
    installAboutInputObservers()
  })
  const digit = await page.evaluate(() => syn3hNet.gear.list().indexOf('yoink') + 1)
  assert.ok(digit > 0); await entry.focus(); await page.keyboard.press(`Digit${digit}`)
  await ready(page, () => syn3hNet.gear.current === 'yoink' && !syn3h.game.input.state.fire)
  const acquire = async () => {
    const cooldown = await page.evaluate(() => syn3h.game.time + syn3h.params.get('yoink.cooldown').value + .1)
    await ready(page, time => syn3h.game.time >= time, cooldown)
    const staged = await page.evaluate(async () => {
      if (syn3hNet.yoink.holding !== null) throw Error('Cannot stage a carried target')
      const { aimFrom } = await import('/src/weapons/aim.ts')
      const target = window.guideCarryRoster, vehicle = syn3hNet.vehicleOf(target.id)
      if (vehicle !== target.vehicle) throw Error('Target changed')
      const aim = aimFrom(syn3h.game, syn3h.player.body, syn3h.params.get('yoink.range').value, .4, 2.4, 0, true)
      const position = aim.o.clone().addScaledVector(aim.d, 8)
      vehicle.body.setTranslation(position, true); vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true); vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      return { id: target.id, tick: syn3h.game.tick, position: position.toArray() }
    })
    await ready(page, staged => {
      const vehicle = syn3hNet.vehicleOf(staged.id), p = vehicle?.body.translation()
      return syn3h.game.tick >= staged.tick + 3 && p && vehicle.object.position.distanceTo(p) < 2
    }, staged)
    await entry.focus(); await page.keyboard.down('KeyL')
    await ready(page, id => syn3hNet.yoink.holding === id, staged.id)
    await keep({ phase: 'actual-acquisition', staged, acquired: await page.evaluate(() => aboutInputObserver.snapshot()) })
    return staged.id
  }
  const target = await acquire()
  await page.evaluate(target => aboutInputObserver.arm('guide-yoink-open', 'releaseCursor', target), target)
  // Check again in the actual native click turn, before Shell cancels the carry.
  await page.evaluate(target => {
    document.querySelector('.rail-about').addEventListener('click', () => {
      const state = aboutInputObserver.snapshot()
      window.guideCarryBeforeClick = state
      if (state.holding !== target || state.acquiredAt === null || (state.holdTime > 0 && state.time - state.acquiredAt >= state.holdTime - .5))
        throw Error('Carry expired before actual About entry')
    }, { capture: true, once: true })
  }, target)
  await entry.click(); await dialog.waitFor({ state: 'visible' })
  await ready(page, () => aboutInputObserver.records.some(r => r.label === 'guide-yoink-open' && (r.firstStep || r.lifecycleFailure)))
  const canceled = await page.evaluate(() => ({ preClick: window.guideCarryBeforeClick,
    event: aboutInputObserver.records.find(r => r.label === 'guide-yoink-open') }))
  await keep({ phase: 'live-yoink-modal-cancel', ...canceled })
  assert.equal(canceled.event.lifecycleFailure ?? null, null)
  assert.equal(canceled.preClick.holding, target)
  for (const phase of [canceled.event.immediate, canceled.event.stepEntry, canceled.event.firstStep]) {
    assert.equal(phase.holding, null); assert.equal(phase.yoink.flings, canceled.preClick.yoink.flings)
    assert.equal(phase.yoink.drops, canceled.preClick.yoink.drops + 1)
    assert.deepEqual(phase.yoinkSends.slice(canceled.preClick.yoinkSends.length).map(({ kind, target }) => ({ kind, target })), [{ kind: 'drop', target }])
  }
  await dialog.locator('.about-back').click(); assert.equal((await axes()).fire, false)
  await page.keyboard.up('KeyL')
  const freshTarget = await acquire()
  const freshBefore = await page.evaluate(target => aboutInputObserver.arm('guide-yoink-fresh-release', 'keyup', target), freshTarget)
  await page.keyboard.up('KeyL')
  await ready(page, () => aboutInputObserver.records.some(r => r.label === 'guide-yoink-fresh-release' && (r.firstStep || r.lifecycleFailure)))
  const fresh = await page.evaluate(() => aboutInputObserver.records.find(r => r.label === 'guide-yoink-fresh-release'))
  assert.equal(fresh.lifecycleFailure ?? null, null); assert.equal(fresh.firstStep.holding, null)
  assert.equal(fresh.firstStep.yoink.flings, freshBefore.yoink.flings + 1)
  assert.deepEqual(fresh.firstStep.yoinkSends.slice(freshBefore.yoinkSends.length).map(({ kind, target }) => ({ kind, target })), [{ kind: 'fling', target: freshTarget }])
  await keep({ phase: 'live-yoink-fresh-positive', fresh })
  record.extensions.diagnostics = await page.evaluate(() => aboutInputObserver.diagnostics())
  assert.deepEqual(record.extensions.diagnostics.lifecycleFailures, [])
  for (const key of ['droppedEvents', 'droppedLifecycle', 'droppedFailures']) assert.equal(record.extensions.diagnostics[key], 0)
  await page.evaluate(() => { aboutInputObserver.restore(); delete window.guideCarryRoster })
  await persist()
}
try {
  report.rawSourceProvenance = await provenance()
  await persist()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: budget(30000) })
  for (const touch of [false, true]) {
    const context = await bounded(browser.newContext({ hasTouch: touch, viewport: touch ? { width: 390, height: 640 } : { width: 1280, height: 900 }, serviceWorkers: 'block' }))
    const page = await bounded(context.newPage()); pages.push(page)
    for (const [object, names] of [[page, ['evaluate']], [page.keyboard, ['down', 'up', 'press']]]) {
      for (const name of names) { const original = object[name].bind(object); object[name] = (...args) => bounded(original(...args), 15000) }
    }
    page.setDefaultTimeout(10000)
    const sockets = [], images = [], documents = [], modules = [], casePending = []
    const record = { touchContext: touch, status: 'in_progress', stage: 'navigation', sockets, images, documents, modules, responseAttempts: [] }
    report.cases.push(record); records.set(page, record)
    const checkpoint = async (stage, values = {}) => { Object.assign(record, values, { stage }); await persist() }
    await checkpoint('navigation')
    page.on('websocket', ws => { sockets.push(ws.url()); ws.on('framereceived', ({ payload }) => {
      try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) report.errors.push('HMR changed source') } catch {}
    }) })
    page.on('pageerror', error => report.errors.push(String(error)))
    page.on('request', request => { if (request.resourceType() === 'image') images.push(request.url()) })
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (response.request().resourceType() !== 'document' && !['/src/ui/Shell.ts', '/tests/ui/about-input-observers.mjs'].includes(path)) return
      const attempt = { url: response.url(), status: response.status(), type: response.request().resourceType() }
      record.responseAttempts.push(attempt)
      const job = (async () => {
        assert.equal(new URL(response.url()).origin, new URL(origin).origin)
        assert.equal(response.status(), 200); assert.equal(response.fromServiceWorker(), false)
        assert.equal(response.request().redirectedFrom(), null)
        const bytes = await bounded(response.body())
        Object.assign(attempt, { bytes: bytes.length, sha256: hash(bytes) })
        if (path === '/src/ui/Shell.ts') {
          assert.equal(response.request().resourceType(), 'script')
          const map = bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
          assert.ok(map); assert.ok(JSON.parse(Buffer.from(map[1], 'base64')).sourcesContent.includes(await readFile(new URL('../../src/ui/Shell.ts', import.meta.url), 'utf8')))
          modules.push({ url: response.url(), sha256: hash(bytes), sourceSha256: hash(await readFile(new URL('../../src/ui/Shell.ts', import.meta.url))) })
        } else if (path === '/tests/ui/about-input-observers.mjs') {
          assert.equal(response.request().resourceType(), 'script')
          const source = await readFile(new URL('./about-input-observers.mjs', import.meta.url), 'utf8')
          assert.ok(bytes.toString().startsWith(source.trimEnd()), 'executed observer source')
          modules.push({ url: response.url(), sha256: hash(bytes), sourceSha256: hash(source) })
        } else {
          assert.ok(response.request().isNavigationRequest()); assert.equal(response.frame(), page.mainFrame())
          documents.push({ url: response.url(), sha256: hash(bytes), navigation: true })
        }
      })().catch(error => { attempt.error = String(error); record.evidenceError = String(error); report.errors.push(String(error)) })
      casePending.push(job); pending.push(job)
    })
    const url = new URL(origin); url.searchParams.set('room', `ux-guide-${touch}-${Date.now()}`)
    url.searchParams.set('world', 'alpine.1518~bots.count=0')
    await page.goto(url.href, { timeout: budget(60000) })
    await ready(page, () => window.syn3h?.shell?.galaxy?.live)
    await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
    await ready(page, () => window.syn3hNet?.connected && syn3h.shell.playing && !syn3h.shell.dropping)
    await drain(casePending)
    // Raw refetches are separate. These are the actual page navigation and script
    // responses, tied to the live Shell instance exercised by this case.
    assert.ok(documents.length > 0 && documents.some(item => item.url === url.href), 'case navigation document evidence')
    assert.ok(modules.length > 0, 'case Shell script/source-map evidence')
    const executedShell = await page.evaluate(() => ({ name: syn3h.shell.constructor.name,
      ownsDialog: syn3h.shell.element.contains(document.querySelector('.in-play-about')),
      open: typeof syn3h.shell.openAbout, close: typeof syn3h.shell.closeAbout }))
    assert.deepEqual(executedShell, { name: 'Shell', ownsDialog: true, open: 'function', close: 'function' })
    assert.deepEqual(report.errors, [])
    await checkpoint('entered-world', { executedShell })
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    if (touch) await page.locator('.inspector-toggle').click()
    const session = page.locator('.rail-players')
    if (!await session.evaluate(el => el.open)) await session.locator('summary').click()
    const entry = page.locator('.rail-about'), dialog = page.locator('.in-play-about')
    await entry.focus()
    // Native held fire. Real charge, no pending-state seeding or direct cancel call.
    const digit = await page.evaluate(() => syn3hNet.gear.list().indexOf('red') + 1)
    assert.ok(digit > 0); await page.keyboard.press(`Digit${digit}`)
    await ready(page, () => syn3hNet.gear.current === 'red')
    await entry.focus(); await page.keyboard.down('KeyL')
    await ready(page, () => syn3hNet.bigRed.ready)
    const before = await state(page), socketCount = sockets.length
    await checkpoint('charged-before-entry', { before, socketCount })
    // d58's exact reviewed observer retains first/terminal system identities.
    // Zero bots are part of the entry recipe, not a mutation to repair a roster.
    await ready(page, () => {
      const rows = [...syn3hNet.players.values()].filter(player => player.bot)
      if (!syn3hNet.isHost || syn3h.params.get('bots.count').value !== 0 || syn3h.bots.vehicles.length || rows.length) return false
      const previous = window.guideSettledSystems, systems = [...syn3h.game.systems]
      if (!previous || previous.systems.length !== systems.length || previous.systems.some((system, i) => system !== systems[i])) {
        window.guideSettledSystems = { systems, frame: syn3h.game.frames }; return false
      }
      return syn3h.game.frames >= previous.frame + 2
    })
    record.observerInstall = await page.evaluate(async () => {
      const { installAboutInputObservers } = await import('/tests/ui/about-input-observers.mjs')
      const settled = window.guideSettledSystems, systems = syn3h.game.systems
      if (!settled || !syn3hNet.isHost || syn3h.params.get('bots.count').value !== 0 || syn3h.bots.vehicles.length ||
          [...syn3hNet.players.values()].some(player => player.bot) || settled.systems.length !== systems.length ||
          settled.systems.some((system, i) => system !== systems[i])) throw Error('Roster changed before observer install')
      installAboutInputObservers()
      delete window.guideSettledSystems
      window.guideTrace = {
        get order() { return aboutInputObserver.order },
        get record() { return aboutInputObserver.records.find(record => record.label === 'about-open') },
        get immediate() { return this.record?.immediate },
        get firstStep() { return this.record?.firstStep },
        diagnostics() { return aboutInputObserver.diagnostics() },
        restore() { aboutInputObserver.restore() },
      }
      return aboutInputObserver.arm('about-open', 'releaseCursor')
    })
    assert.ok(record.observerInstall.ready && record.observerInstall.fire, 'real charge held before modal event')
    await drain(casePending)
    assert.ok(modules.some(item => new URL(item.url).pathname === '/tests/ui/about-input-observers.mjs'), 'executed observer evidence')
    assert.deepEqual(report.errors, [])
    await checkpoint('observer-armed')
    await entry.click(); await dialog.waitFor({ state: 'visible' })
    await ready(page, () => !!guideTrace.immediate)
    const trace = await page.evaluate(() => guideTrace.record)
    await checkpoint('entry-event', { trace })
    assert.equal(trace.lifecycleFailure ?? null, null)
    assert.equal(trace.immediate.fire, false); assert.equal(trace.immediate.red.sent, before.sent)
    assert.equal(trace.immediate.suspended, true); assert.equal(trace.immediate.tick, trace.eventReturn.tick)
    assert.ok(trace.transactions.length > 0, 'opening cancellation transaction')
    for (const transaction of trace.transactions) {
      const calls = transaction.calls.map(call => call.method)
      assert.ok(calls.includes('BigRed.cancel') && calls.includes('Yoink.cancel') && calls.includes('Input.inhibit'))
      assert.ok(calls.indexOf('BigRed.cancel') < calls.indexOf('Input.inhibit'))
      assert.ok(calls.indexOf('Yoink.cancel') < calls.indexOf('Input.inhibit'))
      assert.equal(transaction.before.suspended, false); assert.equal(transaction.returned.suspended, false)
      assert.ok(transaction.calls.every(call => !call.before.suspended && !call.after.suspended))
    }
    await ready(page, () => !!guideTrace.firstStep || !!guideTrace.record?.lifecycleFailure)
    const completed = await page.evaluate(() => ({ record: guideTrace.record, diagnostics: guideTrace.diagnostics() }))
    await checkpoint('first-step', { completed })
    assert.equal(completed.record.lifecycleFailure ?? null, null)
    assert.deepEqual(completed.diagnostics.lifecycleFailures, [])
    assert.equal(completed.diagnostics.droppedEvents, 0); assert.equal(completed.diagnostics.droppedLifecycle, 0); assert.equal(completed.diagnostics.droppedFailures, 0)
    assert.equal(completed.record.stepEntry.tick, completed.record.firstStep.tick)
    for (const phase of [completed.record.immediate, completed.record.stepEntry, completed.record.firstStep]) {
      assert.equal(phase.fire, false); assert.equal(phase.red.sent, before.sent); assert.equal(phase.red.fizzled, before.fizzled)
      assert.equal(phase.redCalls, record.observerInstall.redCalls)
    }
    const opened = await state(page)
    await checkpoint('opened', { opened })
    assert.equal(opened.sent, before.sent); assert.equal(opened.fizzled, before.fizzled)
    assert.equal(opened.url, before.url); assert.equal(opened.id, before.id); assert.equal(opened.host, before.host)
    assert.ok(opened.connected && opened.playing && !opened.menu && !opened.paused && opened.suspended && !opened.locked)
    assert.equal(sockets.length, socketCount)
    assert.equal(await dialog.locator('a[href*="/brand/licenses/"]').count(), 10)
    const licences = await page.evaluate(() => {
      const hrefs = selector => [...document.querySelectorAll(selector)].map(a => a.getAttribute('href')).sort()
      return { modal: hrefs('.in-play-about a[href*="/brand/licenses/"]'), lobby: hrefs('[data-panel="about"] a[href*="/brand/licenses/"]') }
    })
    assert.deepEqual(licences.modal, licences.lobby)
    assert.equal(await dialog.locator('img').count(), 0); assert.deepEqual(images, [])
    await dialog.locator('h2').focus()
    for (const key of ['p', 'j', 'h', 'w']) await page.keyboard.press(key)
    assert.ok(await dialog.evaluate(el => el.open))
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
      assert.ok(await page.evaluate(() => document.querySelector('.in-play-about').contains(document.activeElement)))
    }
    await dialog.locator('.shell-credits summary').click()
    await dialog.locator('.shell-credits li').last().scrollIntoViewIfNeeded()
    await bounded(page.screenshot({ path: `${out}/${touch ? 'touch' : 'desktop'}-guide-credits.png` }), 15000)
    await page.keyboard.press('Escape')
    assert.ok(await entry.evaluate(el => el === document.activeElement))
    assert.equal((await state(page)).locked, false)
    assert.equal(await page.evaluate(() => syn3h.game.input.state.fire), false)
    await page.keyboard.up('KeyL')
    // Fresh gesture after neutral must work, with the normal cooldown unchanged.
    const cooldownEnd = await page.evaluate(() => syn3h.game.time + syn3h.params.get('bigRed.cooldown').value + .1)
    await ready(page, time => syn3h.game.time >= time, cooldownEnd)
    await page.keyboard.down('KeyL'); await ready(page, () => syn3hNet.bigRed.ready)
    await page.keyboard.up('KeyL'); await ready(page, sent => syn3hNet.bigRed.stats.sent === sent + 1, before.sent)
    await entry.click()
    await page.evaluate(() => syn3h.pause.pause('hidden')) // explicit synthetic lifecycle
    await page.evaluate(() => syn3h.pause.resume('hidden'))
    assert.equal(await page.evaluate(() => syn3h.game.input.suspended), true)
    assert.ok(await page.evaluate(() => document.querySelector('.in-play-about').contains(document.activeElement)))
    await dialog.locator('.about-back').click()
    const returned = await state(page); assert.ok(!returned.paused && !returned.suspended && !returned.locked)
    // Native pause and native About entry through the actual pause UI.
    await checkpoint('before-paused-entry', { returned })
    await page.locator('.rail-pause').click()
    const pauseEntry = page.locator('.pause-about')
    await pauseEntry.waitFor({ state: 'visible' })
    await bounded(page.screenshot({ path: `${out}/${touch ? 'touch' : 'desktop'}-paused-entry.png` }), 15000)
    const beforePaused = await state(page)
    assert.ok(beforePaused.paused); assert.equal(beforePaused.reason, 'user')
    await pauseEntry.click()
    await dialog.waitFor({ state: 'visible' })
    const paused = await state(page)
    assert.ok(paused.paused && paused.suspended); assert.equal(paused.reason, 'user')
    assert.equal(paused.tick, beforePaused.tick)
    await checkpoint('paused-guide', { beforePaused, paused })
    await page.keyboard.press('Escape')
    const afterPaused = await state(page)
    assert.ok(afterPaused.paused && afterPaused.suspended && !afterPaused.locked)
    assert.equal(afterPaused.reason, 'user'); assert.equal(afterPaused.tick, paused.tick)
    assert.equal(afterPaused.url, beforePaused.url); assert.equal(afterPaused.id, beforePaused.id)
    assert.ok(await pauseEntry.evaluate(el => el === document.activeElement))
    await checkpoint('paused-close', { afterPaused })
    await bounded(page.screenshot({ path: `${out}/${touch ? 'touch' : 'desktop'}-paused-focus.png` }), 15000)
    // Close while hidden, then resume the same reason: no stranded suspension.
    await page.evaluate(() => syn3h.pause.resume('user'))
    await entry.click()
    await page.evaluate(() => syn3h.pause.pause('hidden'))
    await dialog.locator('.about-back').click()
    assert.equal((await state(page)).suspended, true)
    await page.evaluate(() => syn3h.pause.resume('hidden'))
    assert.equal((await state(page)).suspended, false)
    // Real click opener disappears before close: use the current session entry fallback.
    await entry.click()
    await page.evaluate(() => {
      const old = document.querySelector('.rail-about')
      const copy = old.cloneNode(true); old.replaceWith(copy)
      window.guideRestoreEntry = () => copy.replaceWith(old)
    })
    await dialog.locator('.about-back').click()
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.rail-about')), true)
    await page.evaluate(() => guideRestoreEntry())
    const finalState = await state(page)
    assert.equal(finalState.id, before.id); assert.equal(finalState.url, before.url)
    assert.ok(finalState.connected); assert.equal(sockets.length, socketCount)
    assert.deepEqual(images, [])
    record.trace = await page.evaluate(() => ({ record: guideTrace.record, diagnostics: guideTrace.diagnostics() }))
    assert.deepEqual(record.trace.diagnostics.lifecycleFailures, [])
    for (const key of ['droppedEvents', 'droppedLifecycle', 'droppedFailures']) assert.equal(record.trace.diagnostics[key], 0)
    await page.evaluate(() => { guideTrace.restore(); delete window.guideTrace })
    // Preserve original case evidence before running separately labelled extensions.
    await checkpoint('original-assertions-complete', { finalState })
    if (touch) await modalExtensions(page, record, entry, dialog)
    await checkpoint('before-context-close', { finalState })
    await bounded(context.close())
    await drain(casePending)
    assert.ok(documents.length > 0 && modules.length > 0, 'nonempty case execution provenance')
    assert.deepEqual(report.errors, [])
    await checkpoint('complete', { status: 'passed' })
  }
  report.finalProvenance = await provenance(); assert.deepEqual(report.finalProvenance, report.rawSourceProvenance)
} catch (error) {
  primary = error; report.failure = String(error.stack ?? error)
  for (const record of report.cases) if (record.status !== 'passed') { record.status = 'failed'; record.failure = report.failure }
  try { await persist() } catch {} // Original failure remains primary; write failure is sticky.
}
finally {
  for (const page of pages) if (!page.isClosed()) {
    try {
      records.get(page).failureTrace = await page.evaluate(() => window.guideTrace ? ({ record: guideTrace.record, diagnostics: guideTrace.diagnostics() }) : window.aboutInputObserver ? ({ records: aboutInputObserver.records, diagnostics: aboutInputObserver.diagnostics() }) : null)
      await persist()
    } catch (error) { report.errors.push(`Partial trace: ${error}`) }
    try { await page.evaluate(() => { if (window.guideTrace) guideTrace.restore(); else window.aboutInputObserver?.restore() }) } catch (error) { report.errors.push(String(error)) }
  }
  try { if (browser) await bounded(browser.close(), 15000) } catch (error) { report.errors.push(String(error)) }
  // Browser closed: no new response callbacks should start; drain all queued work.
  try { await drain(pending) }
  catch (error) { report.errors.push(String(error)) }
  report.captureComplete = !primary && report.errors.length === 0 && report.cases.length === 2 && report.cases.every(record => record.status === 'passed')
  try { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000) }
  catch (error) { report.captureComplete = false; report.errors.push(String(error)); console.error(JSON.stringify(report)) }
  if (primary) throw primary
  assert.deepEqual(report.errors, [])
}
