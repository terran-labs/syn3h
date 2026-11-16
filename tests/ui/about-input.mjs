// FIRST FOUR Chrome slices only. Source-prepared; not a release/full-modal gate.
// Requires a separately allocated supervisor, dedicated room server and clean Vite tree.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL
const expected = process.env.UX_SOURCE_SHA
const out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST, 'Explicit allocated origin, source, evidence and launcher manifest required')
const deadline = Date.now() + 480_000
const remaining = cap => { const ms = Math.min(cap, deadline - Date.now()); assert.ok(ms > 0, 'fixture absolute deadline'); return ms }
const bounded = async (promise, cap, label) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} deadline`)), remaining(cap))
  })]) } finally { clearTimeout(timer) }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: remaining(5000) }).trim()
const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected)
assert.equal(launch.origin, origin)
assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
assert.equal(String(launch.env.SYN3H_ROOM_PORT), String(launch.roomPort), 'Vite proxy room port must be explicit')
assert.ok(Number.isInteger(launch.roomPort) && launch.roomPort !== 8787, 'dedicated room port required')
assert.ok(launch.roomPid > 0 && launch.roomStart && launch.vitePid > 0 && launch.viteStart, 'supervisor-owned PID/start provenance required')
const report = { source: expected, launch, cases: [], classification: {
  chrome: 'installed channel chrome', tag: 'synthetic touch PointerEvents through actual TAG handlers',
  nativeTag: 'native Chrome mouse on the actual TAG button', keyboard: 'native Playwright keyboard',
  canvasMouse: 'native Playwright mouse with actual pointer lock', gamepad: 'not in first four slices',
  touchHardware: 'not verified', expandedAbout: 'not implemented or covered',
}, errors: [] }
await mkdir(out, { recursive: true })
const files = ['src/main.ts', 'src/core/Input.ts', 'src/core/Game.ts', 'src/ui/Shell.ts',
  'src/ui/TouchControls.ts', 'src/ui/gear/GearSelector.ts', 'src/net/index.ts',
  'src/net/Connection.ts', 'src/weapons/Gear.ts', 'src/weapons/BigRed.ts',
  'src/weapons/yoink/Yoink.ts', 'src/weapons/yoink/params.ts', 'src/weapons/bigRedParams.ts',
  'src/weapons/bungee/Bungee.ts', 'src/weapons/aim.ts', 'src/bots/params.ts',
  'shared/params.ts', 'vite.config.ts', 'tests/ui/about-input.mjs', 'tests/ui/about-input-observers.mjs']
async function provenance() {
  assert.equal(git('rev-parse', 'HEAD'), expected)
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
  const manifest = []
  for (const path of files) {
    const local = await readFile(new URL(path, new URL('../../', import.meta.url)), 'utf8')
    const response = await fetch(new URL(`/${path}?raw`, origin), { signal: AbortSignal.timeout(remaining(10000)), cache: 'no-store' })
    assert.equal(response.status, 200, path)
    const raw = await bounded(response.text(), 10000, 'raw source body')
    const literal = raw.match(/^export default ("(?:[^"\\]|\\.)*")\s*;?/m)
    assert.ok(literal, `${path} raw export`)
    assert.equal(JSON.parse(literal[1]), local, `${path} served identity`)
    let transformedHash
    if (path.startsWith('src/') && path.endsWith('.ts')) {
      const transformed = await fetch(new URL(`/${path}`, origin), { signal: AbortSignal.timeout(remaining(10000)), cache: 'no-store' })
      assert.equal(transformed.status, 200)
      const module = await bounded(transformed.text(), 10000, 'transformed source body')
      const encoded = module.match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
      assert.ok(encoded, `${path} inline source map required`)
      const map = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'))
      assert.ok(map.sourcesContent?.includes(local), `${path} transformed input differs`)
      transformedHash = hash(module)
    }
    manifest.push({ path, sha256: hash(local), transformedHash })
  }
  return manifest
}
let browser
const contexts = []
async function ready(page, fn, arg, timeout = 10000) {
  await page.waitForFunction(fn, arg, { timeout: remaining(timeout) })
}
async function state(page) { return page.evaluate(() => aboutInputObserver.snapshot()) }
async function record(page, label, expectStep = true) {
  await ready(page, ({ label, expectStep }) => {
    const r = aboutInputObserver.records.find(r => r.label === label)
    return r?.immediate && (!expectStep || r.firstStep)
  }, { label, expectStep })
  const r = await page.evaluate(label => aboutInputObserver.records.find(r => r.label === label), label)
  report.cases.push(r)
  assert.equal(r.preconditionFailure, null)
  return r
}
function noRed(before, after) {
  assert.equal(after.red.sent, before.red.sent); assert.equal(after.red.fizzled, before.red.fizzled)
  assert.equal(after.redCalls, before.redCalls)
}
function oneRed(before, after) {
  assert.equal(after.red.sent - before.red.sent, 1)
  assert.equal(after.redCalls - before.redCalls, 1)
  assert.equal(after.red.fizzled, before.red.fizzled)
}
async function select(page, id) {
  // The real rack keyboard selector runs before the next normal fixed step.
  // Derive actual order from source at runtime, do not rely on guessed digits.
  const digit = await page.evaluate(id => syn3hNet.gear.list().indexOf(id) + 1, id)
  assert.ok(digit > 0 && digit <= 9)
  await page.keyboard.press(`Digit${digit}`)
  await ready(page, id => syn3hNet.gear.current === id, id)
  await ready(page, () => !syn3h.game.input.state.fire && !syn3h.game.input.suspended)
  // Wait normal simulation cooldown; never overwrite pending action state.
  const waitUntil = await page.evaluate(() => syn3h.game.time + Math.max(
    syn3h.params.get('bigRed.cooldown').value, syn3h.params.get('yoink.cooldown').value) + .1)
  await ready(page, time => syn3h.game.time >= time, waitUntil)
}
async function tagDown(page, id) {
  await page.locator('.touch-fire').waitFor({ state: 'visible', timeout: remaining(10000) })
  await page.evaluate(id => {
    const tag = document.querySelector('.touch-fire')
    tag.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: id, button: 0, buttons: 1 }))
  }, id)
}
async function tagEnd(page, id, type, label, target = null) {
  // Arm and dispatch synchronously: target and hold-window check immediately precedes action.
  return page.evaluate(({ id, type, label, target }) => {
    const before = aboutInputObserver.arm(label, type, target)
    document.querySelector('.touch-fire').dispatchEvent(new PointerEvent(type,
      { bubbles: true, pointerType: 'touch', pointerId: id, button: 0, buttons: 0 }))
    return before
  }, { id, type, label, target })
}
async function newGame(touch, name) {
  const context = await bounded(browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: touch }), 10000, 'new context')
  contexts.push(context)
  const page = await bounded(context.newPage(), 10000, 'new page')
  // Playwright evaluate and low-level input APIs have no per-call timeout option.
  // Bound their promises without changing the browser-side event or application.
  for (const [object, names] of [[page, ['evaluate']], [page.keyboard, ['down', 'up', 'press']],
    [page.mouse, ['down', 'up', 'move', 'click']]]) {
    for (const name of names) {
      const original = object[name].bind(object)
      object[name] = (...args) => { remaining(15000); return bounded(original(...args), 15000, name) }
    }
  }
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000)
  page.on('pageerror', error => report.errors.push({ name, message: error.message }))
  const sockets = []
  page.on('websocket', ws => sockets.push(ws.url()))
  const url = new URL(origin)
  url.searchParams.set('room', `ux-input-${name}-${Date.now()}`)
  await page.goto(url.href, { timeout: remaining(30000) })
  await ready(page, () => !!window.syn3h?.shell?.galaxy?.live, null, 60000)
  await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
  await ready(page, () => window.syn3hNet?.connected && syn3h.shell.playing && !syn3h.shell.dropping, null, 60000)
  const websocketBase = launch.env.VITE_SERVER_URL ?? origin.replace(/^http/, 'ws')
  const expectedSocket = websocketBase.replace(/\/+$/, '').replace(/\/ws$/, '') + '/ws?room=' + encodeURIComponent(url.searchParams.get('room'))
  assert.ok(sockets.includes(expectedSocket), 'actual connection must match allocated room origin and room')
  assert.ok(sockets.every(socket => socket === expectedSocket || new URL(socket).pathname === '/'), 'unexpected websocket destination')
  assert.ok(await page.evaluate(() => syn3hNet.isHost), 'isolated fixture must own room')
  const settings = await page.evaluate(() => {
    const changes = { 'daydream.seconds': 0, 'bots.tagBeams': false, 'bots.canDrive': false,
      'bots.count': 1, 'bots.fleet': 0 }
    const before = {}
    for (const [id, value] of Object.entries(changes)) {
      before[id] = syn3h.params.get(id).value
      syn3h.params.set(id, value)
    }
    return { before, applied: changes, holdTime: syn3h.params.get('yoink.holdTime').value,
      charge: syn3h.params.get('bigRed.charge').value }
  })
  report[name] = { url: url.href, sockets, settings }
  await page.evaluate(async () => {
    const { installAboutInputObservers } = await import('/tests/ui/about-input-observers.mjs')
    installAboutInputObservers()
  })
  return page
}
async function stageTarget(page) {
  const staged = await page.evaluate(async () => {
    if (syn3hNet.yoink.holding !== null) throw new Error('Cannot stage during carry')
    const { aimFrom } = await import('/src/weapons/aim.ts')
    const candidate = [...syn3hNet.players.values()].find(p => p.bot && syn3hNet.vehicleOf(p.id))
    if (!candidate) throw new Error('No actual host bot target')
    const vehicle = syn3hNet.vehicleOf(candidate.id)
    const aim = aimFrom(syn3h.game, syn3h.player.body, syn3h.params.get('yoink.range').value, .4, 2.4, 0, true)
    const position = aim.o.clone().addScaledVector(aim.d, 8)
    vehicle.body.setTranslation(position, true)
    vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    return { id: candidate.id, position: position.toArray(), tick: syn3h.game.tick }
  })
  await ready(page, staged => {
    const vehicle = syn3hNet.vehicleOf(staged.id)
    const p = vehicle?.body.translation()
    return syn3h.game.tick >= staged.tick + 3 && p && vehicle.object.position.distanceTo(p) < 2
  }, staged)
  report.targetSetups ??= []; report.targetSetups.push(staged)
  return staged.id
}

try {
  report.provenance = await provenance()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: remaining(30000) })
  const touch = await newGame(true, 'tag')
  const charged = () => ready(touch, () => syn3hNet.bigRed.ready && syn3h.game.input.state.fire)
  // Slice 1: positive and negative real TAG controls through actual state refresh.
  for (const [id, type] of [[101, 'pointerup'], [102, 'pointercancel']]) {
    await select(touch, 'red'); await tagDown(touch, id); await charged()
    await ready(touch, () => syn3hNet.gear.controls().state === 'ready' &&
      document.querySelector('.gs-hints [data-action=charge] .gs-act')?.textContent === 'Let go to send')
    const label = `tag-thunder-${type}`
    const before = await tagEnd(touch, id, type, label)
    assert.equal(before.ready, true)
    const r = await record(touch, label)
    if (type === 'pointerup') oneRed(before, r.firstStep)
    else {
      assert.equal(r.immediate.charge, -1); noRed(before, r.immediate); noRed(before, r.firstStep)
    }
  }
  // Native mouse on the real TAG button, in the same touch-capable app layout.
  await select(touch, 'red')
  const tag = touch.locator('.touch-fire')
  const box = await tag.boundingBox(); assert.ok(box)
  await touch.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await touch.mouse.down(); await charged()
  const nativeBefore = await touch.evaluate(() => aboutInputObserver.arm('tag-thunder-native-up', 'pointerup'))
  await touch.mouse.up()
  const nativeRelease = await record(touch, 'tag-thunder-native-up')
  assert.equal(nativeRelease.detail.trusted, true); oneRed(nativeBefore, nativeRelease.firstStep)

  // Slice 2: actual acquisition, not a seeded carry. No target movement while held.
  for (const [id, type] of [[201, 'pointerup'], [202, 'pointercancel'], [203, 'fling']]) {
    await select(touch, 'yoink')
    await ready(touch, () => [...syn3hNet.players.values()].some(p => p.bot && syn3hNet.vehicleOf(p.id)))
    const target = await stageTarget(touch)
    await tagDown(touch, id)
    await ready(touch, target => syn3hNet.yoink.holding === target, target, 3000)
    await ready(touch, () => syn3hNet.gear.controls().state === 'holding' &&
      document.querySelector('.gs-status')?.textContent.startsWith('Holding '))
    const label = `tag-yoink-${type}`
    let before
    if (type === 'fling') {
      const fling = touch.locator('.gs-action[data-action="fling"]')
      await fling.waitFor({ state: 'visible', timeout: remaining(2000) })
      before = await touch.evaluate(({ label, target }) => aboutInputObserver.arm(label, 'fling', target), { label, target })
      await fling.click({ timeout: remaining(2000) })
    } else before = await tagEnd(touch, id, type, label, target)
    assert.equal(before.holding, target)
    const r = await record(touch, label)
    assert.equal(r.firstStep.holding, null)
    assert.equal(r.firstStep.yoink.flings - before.yoink.flings, type === 'pointercancel' ? 0 : 1)
    assert.equal(r.firstStep.yoink.drops - before.yoink.drops, type === 'pointercancel' ? 1 : 0)
    if (type === 'pointercancel') {
      assert.equal(r.immediate.holding, null)
      assert.equal(r.immediate.yoink.flings, before.yoink.flings)
    }
    if (type === 'fling') {
      const later = await tagEnd(touch, id, 'pointerup', 'yoink-old-tag-up')
      const ended = await record(touch, 'yoink-old-tag-up')
      assert.equal(ended.firstStep.yoink.flings, later.yoink.flings)
    }
  }

  // Slice 3a: native keyboard hold across actual pause/resume, without forced lock state.
  await select(touch, 'red'); await touch.keyboard.down('KeyL'); await charged()
  const keyBefore = await touch.evaluate(() => aboutInputObserver.arm('key-pause', 'requestPause'))
  await touch.keyboard.press('Escape')
  const paused = await record(touch, 'key-pause', false)
  assert.equal(paused.immediate.paused, true); assert.equal(paused.immediate.charge, -1)
  noRed(keyBefore, paused.immediate)
  await touch.evaluate(() => aboutInputObserver.arm('key-resume-held', 'requestResume'))
  await touch.keyboard.press('Escape')
  const resumed = await record(touch, 'key-resume-held')
  assert.equal(resumed.firstStep.fire, false); assert.equal(resumed.firstStep.charge, -1)
  noRed(keyBefore, resumed.firstStep)
  await touch.keyboard.up('KeyL'); await touch.keyboard.down('KeyL'); await charged()
  const freshKey = await touch.evaluate(() => aboutInputObserver.arm('key-fresh-up', 'keyup'))
  await touch.keyboard.up('KeyL')
  oneRed(freshKey, (await record(touch, 'key-fresh-up')).firstStep)

  // Slice 4: both sources genuinely acquired before partial cancellation.
  for (const [id, final] of [[301, 'intentional-key'], [302, 'cancel-tag']]) {
    await select(touch, 'red'); await tagDown(touch, id); await touch.keyboard.down('KeyL'); await charged()
    const overlap = await touch.evaluate(() => ({ state: aboutInputObserver.snapshot(),
      tagHeld: document.querySelector('.touch-fire').classList.contains('held'),
      keyHeld: syn3h.game.input.held('KeyL') }))
    assert.ok(overlap.tagHeld && overlap.keyHeld)
    if (final === 'intentional-key') {
      const before = await tagEnd(touch, id, 'pointercancel', 'overlap-cancel-tag')
      const r = await record(touch, 'overlap-cancel-tag')
      assert.equal(r.immediate.fire, true); assert.equal(r.firstStep.ready, true)
      noRed(before, r.firstStep)
      await touch.evaluate(() => aboutInputObserver.arm('overlap-final-key', 'keyup'))
      await touch.keyboard.up('KeyL')
      oneRed(before, (await record(touch, 'overlap-final-key')).firstStep)
    } else {
      await touch.evaluate(() => aboutInputObserver.arm('overlap-partial-key', 'keyup'))
      await touch.keyboard.up('KeyL')
      const partial = await record(touch, 'overlap-partial-key')
      assert.equal(partial.firstStep.fire, true); assert.equal(partial.firstStep.ready, true)
      const before = await tagEnd(touch, id, 'pointercancel', 'overlap-final-cancel')
      const r = await record(touch, 'overlap-final-cancel')
      assert.equal(r.immediate.charge, -1); noRed(before, r.firstStep)
    }
  }
  // Slice 3b: native canvas mouse. Escape releases lock, then pauses, with no mouseup.
  const desktop = await newGame(false, 'canvas')
  await select(desktop, 'red')
  if (!await desktop.evaluate(() => !!document.pointerLockElement)) {
    const point = await desktop.evaluate(() => { const r = syn3h.game.canvas.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await desktop.mouse.click(point.x, point.y)
  }
  await ready(desktop, () => document.pointerLockElement === syn3h.game.canvas)
  await desktop.mouse.down()
  await ready(desktop, () => syn3hNet.bigRed.ready)
  const canvasBefore = await desktop.evaluate(() => aboutInputObserver.arm('canvas-unlock-held', 'releaseCursor'))
  assert.ok(canvasBefore.rawPrimary.length > 0)
  await desktop.keyboard.press('Escape')
  const unlocked = await record(desktop, 'canvas-unlock-held')
  noRed(canvasBefore, unlocked.firstStep)
  assert.deepEqual(unlocked.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.evaluate(() => aboutInputObserver.arm('canvas-pause-held', 'requestPause'))
  await desktop.keyboard.press('Escape')
  const canvasPause = await record(desktop, 'canvas-pause-held', false)
  assert.equal(canvasPause.immediate.paused, true)
  assert.deepEqual(canvasPause.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.evaluate(() => aboutInputObserver.arm('canvas-resume-held', 'requestResume'))
  await desktop.keyboard.press('Escape')
  const canvasResume = await record(desktop, 'canvas-resume-held')
  assert.equal(canvasResume.firstStep.fire, false); noRed(canvasBefore, canvasResume.firstStep)
  assert.deepEqual(canvasResume.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.mouse.up()
  await ready(desktop, () => document.pointerLockElement === syn3h.game.canvas)
  await desktop.mouse.down(); await ready(desktop, () => syn3hNet.bigRed.ready)
  const freshMouse = await desktop.evaluate(() => aboutInputObserver.arm('canvas-fresh-up', 'canvasup'))
  await desktop.mouse.up()
  oneRed(freshMouse, (await record(desktop, 'canvas-fresh-up')).firstStep)
  for (const page of [touch, desktop]) {
    const trace = await page.evaluate(() => ({ order: aboutInputObserver.order, events: aboutInputObserver.events }))
    report.traces ??= []; report.traces.push(trace)
    // Every full rack cancellation observed must cancel local charge/carry before inhibitor.
    for (let i = 0; i < trace.order.length; i++) if (trace.order[i].method === 'cancelActions' && trace.order[i].phase === 'before') {
      const tail = trace.order.slice(i + 1)
      const inhibit = tail.findIndex(e => e.method === 'cancelFireUntilNeutral' && e.phase === 'before')
      const local = tail.filter((e, index) => index < inhibit && e.method === 'cancel' && e.phase === 'before')
      assert.ok(inhibit >= 0 && local.length >= 2, 'Gear cancellation must precede Input inhibition')
    }
  }
  assert.deepEqual(report.errors, [])
  report.finalProvenance = await provenance()
  assert.deepEqual(report.finalProvenance, report.provenance)
} catch (error) {
  report.failure = String(error.stack ?? error)
  throw error
} finally {
  report.cleanupErrors = []
  for (const context of contexts) {
    for (const page of context.pages()) {
      try {
        await bounded(page.evaluate(() => {
          if (!window.aboutInputObserver) return null
          const evidence = { records: aboutInputObserver.records, order: aboutInputObserver.order }
          aboutInputObserver.restore()
          return evidence
        }).then(evidence => { if (evidence) { report.partialTraces ??= []; report.partialTraces.push(evidence) } }), 3000, 'observer restore')
      } catch (error) { report.cleanupErrors.push(String(error)) }
    }
  }
  try { if (browser) await bounded(browser.close(), 15000, 'browser close') }
  catch (error) { report.cleanupErrors.push(String(error)) }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  if (report.cleanupErrors.length) throw new Error(`Incomplete fixture cleanup: ${report.cleanupErrors.join('; ')}`)
}
