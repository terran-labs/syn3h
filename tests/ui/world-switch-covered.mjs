// A cold world switch must prepare the destination before handing control back.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('world-switch-covered')
const routes = ['reduced', 'flat', 'skip', 'flight']
const cases = [
  ...['phone', 'desktop'].flatMap(view => routes.map(route => ({ view, route, backend: 'webgl' }))),
  { view: 'phone', route: 'reduced', backend: 'webgpu' },
]
const selected = process.env.MIRA_WORLD_SWITCH_CASE
const caseName = ({ view, route, backend }) => `${view}-${backend}-${route}`
const matrix = selected ? cases.filter(test => caseName(test) === selected) : cases
assert.ok(matrix.length, `Unknown world switch case: ${selected}`)
const browser = await chromium.launch({ channel: 'chrome',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] })

function playing(page) {
  return page.waitForFunction(() => {
    const { shell, game } = window.mira ?? {}
    return shell?.playing && !shell.transitioning && !game.input.suspended
  }, null, { timeout: 90000 })
}

async function leave(page) {
  const pause = page.locator('.pause-exit')
  for (let i = 0; i < 3 && !await pause.isVisible(); i++) await page.keyboard.press('Escape')
  await pause.click()
  await page.locator('.exit-leave').click()
  await page.waitForFunction(() => {
    const { shell, game } = window.mira
    return !shell.playing && !shell.transitioning && game.view() === 'covered' &&
      (!shell.galaxy?.live || shell.galaxy.settled)
  }, null, { timeout: 45000 })
}

async function choose(page, id, touch, flat) {
  const label = page.locator(`.galaxy-label[data-world="${id}"]`)
  const input = touch ? 'tap' : 'click'
  if (flat || await label[input]({ trial: true, timeout: 1600 }).then(() => true, () => false)) {
    await label[input]()
    return
  }
  // A caption can be suppressed on a narrow screen. Use the foreground disc where it is hit-testable.
  const point = await page.evaluate(id => {
    const galaxy = window.mira.shell.galaxy, rect = galaxy.canvas.getBoundingClientRect()
    const planet = galaxy.screen.find(item => item.id === id && item.visible)
    if (!planet) return null
    for (const radius of [0, 0.5, 0.85]) {
      for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
        const x = planet.x + Math.cos(angle) * radius * planet.radius
        const y = planet.y + Math.sin(angle) * radius * planet.radius
        const hit = galaxy.screen.filter(p => p.visible && Math.hypot(p.x - x, p.y - y) < p.radius)
          .sort((a, b) => a.depth - b.depth)[0]
        if (hit?.id === id && document.elementFromPoint(x + rect.left, y + rect.top) === galaxy.canvas) {
          return { x: x + rect.left, y: y + rect.top }
        }
      }
    }
    return null
  }, id)
  if (point) {
    if (touch) await page.touchscreen.tap(point.x, point.y)
    else await page.mouse.click(point.x, point.y)
    return
  }
  const choice = page.locator(`.galaxy-world-key[data-world="${id}"]:not([disabled]), .galaxy-label[data-world="${id}"]:not([disabled])`).first()
  await choice.focus()
  await page.keyboard.press('Enter')
}

function observeSwitch() {
  const { game, shell, planets, terrain } = window.mira
  const root = shell.element, canvas = game.renderer.domElement
  const observation = window.worldSwitchObservation = {
    trusted: null, cover: null, coveredDraw: null, reveal: null, control: null,
    descending: false, blurred: false, builds: [], frames: [],
  }
  const sample = () => ({
    world: planets.currentPlanet().id, ready: terrain.ready !== false,
    covered: !shell.overlay.hidden && shell.overlay.style.opacity !== '0',
    held: game.holdDraws, playing: shell.playing, suspended: game.input.suspended,
  })
  const inspect = () => {
    if (observation.trusted === null) return
    const at = performance.now(), state = sample()
    if (root.classList.contains('is-descending')) observation.descending = true
    if (canvas.style.filter.includes('blur(')) observation.blurred = true
    if (state.held && observation.cover === null) observation.cover = { at, ...state }
    if (!state.covered && observation.reveal === null) observation.reveal = { at, ...state }
    if (state.playing && !shell.transitioning && !state.suspended && observation.control === null) {
      observation.control = { at, ...state }
    }
  }
  const mutations = new MutationObserver(inspect)
  for (const element of [root, canvas, shell.overlay]) mutations.observe(element, { attributes: true })
  for (const type of ['pointerup', 'click']) window.addEventListener(type, event => {
    const target = event.target
    if (!(target instanceof Element) || !event.isTrusted || observation.trusted !== null) return
    const action = type === 'pointerup' ? target.matches('.galaxy-canvas') : target.closest('.galaxy-label, .galaxy-world-key')
    if (action) observation.trusted = performance.now()
  }, { capture: true })

  const backend = game.renderer.backend, create = backend.createRenderPipeline
  backend.createRenderPipeline = function (renderObject, ...args) {
    if (observation.trusted === null) return create.call(this, renderObject, ...args)
    const at = performance.now(), state = sample()
    try { return create.call(this, renderObject, ...args) }
    finally { observation.builds.push({ at, ...state }) }
  }
  const draw = backend.draw
  backend.draw = function (renderObject, ...args) {
    const result = draw.call(this, renderObject, ...args)
    if (observation.trusted !== null && observation.coveredDraw === null && observation.reveal === null &&
        renderObject.scene === game.scene && renderObject.camera === game.camera && !renderObject.material?.isShadowPassMaterial) {
      const state = sample()
      if (state.world === 'alpine' && state.ready && state.covered && state.held) {
        observation.coveredDraw = { at: performance.now(), ...state }
      }
    }
    return result
  }
  // This callback follows the real world draw in the same task, while its canvas is readable.
  const recorder = game.blankFrames, afterDraw = recorder.afterDraw
  recorder.afterDraw = function (...args) {
    afterDraw.apply(this, args)
    inspect()
    if (observation.control === null || observation.frames.length >= 3) return
    const copy = document.createElement('canvas')
    copy.width = 16; copy.height = 8
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0, copy.width, copy.height)
    const rgba = context.getImageData(0, 0, copy.width, copy.height).data
    let nonblank = 0
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] >= 16 && 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] > 3) nonblank++
    }
    observation.frames.push({ nonblank, ...sample() })
  }
}

async function checkCase({ view, route, backend }) {
  const phone = view === 'phone', label = caseName({ view, route, backend })
  const page = await browser.newPage({
    viewport: phone ? { width: 320, height: 568 } : { width: 1280, height: 800 },
    isMobile: phone, hasTouch: phone, reducedMotion: 'no-preference',
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    if (phone && backend === 'webgl' && route === 'reduced') await page.addInitScript(() => {
      // Shell owns Escape, so observe it before Shell installs its capture listener.
      window.addEventListener('keydown', event => {
        if (window.observeResume && event.isTrusted && event.code === 'Escape') {
          window.resumeInputFrame = window.mira.game.frames
        }
      }, { capture: true })
    })
    if (route === 'flat') await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return this.classList.contains('galaxy-canvas') ? null : getContext.call(this, kind, ...args)
      }
    })
    const url = new URL(base)
    url.search = new URLSearchParams({ tap: '0', intro: '0', gfx: '2', freeze: '1', room: `covered-switch-${label}-${Date.now()}` })
    if (backend === 'webgl') url.searchParams.set('webgl', '1')
    await page.goto(url.href, { waitUntil: 'commit' })
    await page.waitForFunction(() => {
      const shell = window.mira?.shell
      return document.documentElement.dataset.boot === 'done' && shell &&
        (shell.element.classList.contains('galaxy-flat') || shell.galaxy?.settled)
    }, null, { timeout: 120000 })
    assert.deepEqual(await page.evaluate(() => ({
      backend: window.mira.game.backend, world: window.mira.planets.currentPlanet().id,
      flat: window.mira.shell.element.classList.contains('galaxy-flat'),
    })), { backend, world: 'volcanic', flat: route === 'flat' }, label)
    await choose(page, 'volcanic', phone, route === 'flat')
    await playing(page)
    if (route === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' })
    await leave(page)
    assert.equal(await page.evaluate(() => window.mira.planets.currentPlanet().id), 'volcanic', label)
    await page.evaluate(observeSwitch)
    await choose(page, 'alpine', phone, route === 'flat')
    if (route === 'skip') {
      await page.waitForFunction(() => window.worldSwitchObservation.descending)
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      await page.keyboard.press('Space')
    }
    await playing(page)
    await page.waitForFunction(() => {
      const trace = window.worldSwitchObservation
      return trace.control !== null && trace.frames.length === 3 && performance.now() >= trace.control.at + 10000
    }, null, { timeout: 45000 })
    const trace = await page.evaluate(() => window.worldSwitchObservation)
    const toCover = trace.cover ? `${Math.round(trace.cover.at - trace.trusted)} ms` : 'no cover'
    console.log(`${label} input to cover ${toCover}, to control ${Math.round(trace.control.at - trace.trusted)} ms`)
    assert.ok(trace.trusted !== null && trace.cover?.covered, `${label}: a trusted selection prepares under cover`)
    assert.equal(trace.reveal?.world, 'alpine', `${label}: reveal shows Alpine`)
    assert.equal(trace.reveal.ready, true, `${label}: destination terrain is ready`)
    assert.equal(trace.descending, route === 'flight' || route === 'skip', `${label}: expected flight path`)
    assert.equal(trace.blurred, route === 'flight', `${label}: only the full flight shows the blurred air transition`)
    assert.ok(trace.coveredDraw && trace.coveredDraw.at <= trace.reveal.at, `${label}: draws the ready destination under cover`)
    assert.equal(trace.builds.filter(build => build.at >= trace.control.at && build.at <= trace.control.at + 10000).length,
      0, `${label}: no new pipelines during the first ten seconds of control`)
    assert.ok(trace.frames.every(frame => frame.world === 'alpine' && !frame.suspended && frame.nonblank > 3),
      `${label}: the first three playable draws show Alpine`)
    await page.keyboard.down('ArrowUp')
    try { await page.waitForFunction(() => window.mira.game.input.held('ArrowUp')) }
    finally { await page.keyboard.up('ArrowUp') }
    if (phone && backend === 'webgl' && route === 'reduced') {
      await leave(page)
      await page.evaluate(() => {
        const { shell, game, planets } = window.mira
        window.observeResume = true
        const observer = new MutationObserver(() => {
          if (!shell.playing || game.input.suspended) return
          window.sameWorldResume = game.frames === window.resumeInputFrame && !shell.transitioning &&
            planets.currentPlanet().id === 'alpine'
          observer.disconnect()
        })
        observer.observe(shell.element, { attributes: true, attributeFilter: ['class'] })
      })
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate(() => window.sameWorldResume), true, 'same-world Resume restores control in the input turn')
    }
    assert.deepEqual(errors, [], `${label}: uncaught browser errors`)
  } finally { await page.close() }
}

try {
  for (const test of matrix) await checkCase(test)
} finally { await browser.close() }
