// The lobby's opening (src/ui/galaxy/opening.ts) gives way to the player. The bugs it catches:
// a tap or a key during the opening that does not end it, or ends it with the lobby's controls,
// the planets' captions or the name still held back; and reduced motion getting an opening, or
// getting the lobby without its sound starting.
//  - Skip, in Chromium: empty sky and untargeted keys settle the lobby without entering.
//  - A deliberate input during the opening enters its world once, after covered graphics preparation.
//  - Reduced motion, Chromium with sound allowed: no opening at all, controls and captions at
//    once, sound running.
//  - Reduced motion, WebKit with Safari's gesture rule (the tap-to-begin path, ?tap=1): the
//    prompt, then one tap starts the sound and shows the lobby, with no opening.
//
//   MIRA_URL=http://127.0.0.1:<port>/ tools/heavy.sh node tests/ui/opening-skip.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const base = (process.env.MIRA_URL ?? 'http://127.0.0.1:5258/').replace(/\/+$/, '') + '/'
const ready = page => page.waitForFunction(() => window.mira?.game?.tick > 25 && document.documentElement.dataset.boot === 'done' && window.mira.shell.galaxy, null, { timeout: 120000 })
/** The lobby as the player sees it: is the opening running, and is anything still held back? */
const lobby = page => page.evaluate(() => {
  const g = window.mira.shell.galaxy
  const shell = window.mira.shell
  return { opening: Boolean(g.opening), held: document.documentElement.dataset.opening ?? null, unrevealed: document.querySelectorAll('.galaxy-label.is-unrevealed').length, mark: g.markShown ?? 0, audio: window.mira.audio.state, started: shell.started, transitioning: shell.transitioning }
})
const failures = []
const check = async (name, run) => { try { await run(); console.log(`${name}: PASS`) } catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); console.log(`${name}: FAIL ${error.message.split('\n')[0]}`) } }

// Pick from the frame the player can see, and verify that DOM chrome does not take the hit.
async function openingPoint(page, kind, reduced = false) {
  const point = await page.waitForFunction(({ kind, reduced }) => {
    const galaxy = window.mira.shell.galaxy
    if (!reduced && (typeof galaxy.opening?.start !== 'number' ||
        galaxy.frames <= (window.openingEntryProbe?.replayFrame ?? -1))) return false
    const canvas = galaxy.canvas, rect = canvas.getBoundingClientRect()
    const discs = galaxy.screen.filter(p => p.visible)
    const gap = (p, x, y) => Math.hypot(p.x + rect.left - x, p.y + rect.top - y) - p.radius
    if (kind === 'sky') {
      for (const x of [32, innerWidth / 2, innerWidth - 32]) {
        for (const y of [32, innerHeight / 4, innerHeight / 2]) {
          if (document.elementFromPoint(x, y) === canvas && [galaxy.sunScreen, ...discs].every(p => gap(p, x, y) > 24)) return { x, y }
        }
      }
    } else if (kind === 'caption') {
      for (const button of document.querySelectorAll('.galaxy-label:not([hidden]):not([disabled])')) {
        const id = button.dataset.world, disc = discs.find(p => p.id === id), name = button.querySelector('strong')
        const style = getComputedStyle(button)
        if (!disc || disc.labelled === false || !name || style.visibility !== 'visible' || Number(style.opacity) < 0.2) continue
        const range = document.createRange()
        range.selectNodeContents(name)
        const row = range.getBoundingClientRect()
        const x = Math.round(row.left + row.width / 2), y = Math.round(row.top + row.height / 2)
        const hit = document.elementFromPoint(x, y)
        if ([galaxy.sunScreen, ...discs].some(p => gap(p, x, y) <= 1)) continue
        const distance = gap(disc, x, y)
        const canvasHit = hit === canvas && distance < 22 && discs.every(p => gap(p, x, y) >= distance)
        if (canvasHit || hit?.closest('.galaxy-label') === button) return { x, y, id }
      }
    } else {
      for (const p of discs) {
        const x = Math.round(p.x + rect.left), y = Math.round(p.y + rect.top)
        if (p.radius > 8 && document.elementFromPoint(x, y) === canvas &&
            discs.every(q => q === p || gap(q, x, y) >= 0 || q.depth > p.depth)) return { x, y, id: p.id }
      }
    }
    return false
  }, { kind, reduced }, { timeout: 10000 })
  return point.jsonValue()
}

async function observeEntry(page) {
  // Register before the opening's capture listener can settle it in the input turn.
  await page.addInitScript(() => {
    for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, event => {
      const probe = window.openingEntryProbe, galaxy = window.mira?.shell?.galaxy
      if (!probe || probe.input || !event.isTrusted) return
      probe.input = { opening: typeof galaxy?.opening?.start === 'number', key: event.key,
        world: document.activeElement?.closest('.galaxy-label')?.dataset.world ?? null }
    }, { capture: true })
  })
}

async function enterDuringOpening(page, kind, touch, reduced = false) {
  await page.evaluate(reduced => {
    const { shell, game, params } = window.mira
    if (!reduced) shell.galaxy.replayOpening(params.get('lobby.intro').value)
    const probe = window.openingEntryProbe = {
      input: null, replayFrame: shell.galaxy.frames, joins: 0, preparations: [], flight: false,
    }
    const play = shell.onPlay, precompile = game.precompile
    shell.onPlay = function (...args) { probe.joins++; return play.apply(this, args) }
    game.precompile = async function (...args) {
      const prep = { covered: shell.overlay.inert && game.holdDraws && !shell.playing, finished: false }
      probe.preparations.push(prep)
      const result = await precompile.apply(this, args)
      prep.finished = true
      return result
    }
    new MutationObserver(() => {
      if (shell.element.classList.contains('is-descending')) probe.flight = true
    }).observe(shell.element, { attributes: true, attributeFilter: ['class'] })
  }, reduced)
  let world
  if (kind === 'enter') {
    await page.waitForFunction(() => {
      const galaxy = window.mira.shell.galaxy, label = document.querySelector('.galaxy-label.is-current')
      return typeof galaxy.opening?.start === 'number' && galaxy.frames > window.openingEntryProbe.replayFrame &&
        label && !label.disabled && !label.closest('[hidden], [inert]') && label.getClientRects().length
    }, null, { timeout: 10000 })
    const current = page.locator('.galaxy-label.is-current')
    await current.focus()
    world = await current.getAttribute('data-world')
    assert.equal(await current.evaluate(label => document.activeElement === label), true, 'the current label holds focus')
    await page.keyboard.press('Enter')
  } else {
    const point = await openingPoint(page, kind, reduced)
    world = point.id
    if (touch) await page.touchscreen.tap(point.x, point.y)
    else await page.mouse.click(point.x, point.y)
  }
  await page.waitForFunction(() => {
    const { game, shell } = window.mira
    return shell.playing && !shell.transitioning && !game.input.suspended && window.miraNet?.connected
  }, null, { timeout: 60000 })
  const result = await page.evaluate(() => ({ ...window.openingEntryProbe, world: window.mira.planets.currentPlanet().id }))
  assert.equal(result.input?.opening, !reduced, 'trusted input arrives in the expected opening state')
  if (kind === 'enter') assert.equal(result.input?.world, world, 'Enter targeted the current label')
  assert.equal(result.world, world, 'entered the world activated by the player')
  assert.equal(result.joins, 1, 'one activation joins once')
  assert.equal(result.flight, !reduced, 'reduced motion enters without a flight')
  assert.deepEqual(result.preparations, [{ covered: true, finished: true }], 'prepared once under cover before handing over control')
}

const chrome = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [device, view, input] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, 'tap'], ['desktop', { viewport: { width: 1280, height: 800 } }, 'key']]) {
    const page = await chrome.newPage(view)
    await page.goto(`${base}?room=opening-skip-${Date.now()}`); await ready(page)
    for (const at of [0.5, 1.5, 3, 6]) {
      await check(`${device}: a ${input} at ${at} s skips the opening`, async () => {
        await page.evaluate(() => { const g = window.mira.shell.galaxy; g.replayOpening(window.mira.params.get('lobby.intro').value) })
        await page.waitForTimeout(at * 1000)
        assert.equal((await lobby(page)).opening, true, 'the opening is playing before the input')
        if (input === 'tap') {
          const { x, y } = await openingPoint(page, 'sky')
          await page.touchscreen.tap(x, y)
        } else if (at === 0.5) {
          assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'Enter has no focused action')
          await page.keyboard.press('Enter')
        } else await page.keyboard.press('x')
        // Read once the galaxy has drawn the result: headless frames on a busy machine can be
        // far apart, and these values are written per drawn frame. The controls and captions
        // show on the first frame after the input. The name may still be on its own fade from
        // when it was first drawable (WORDMARK_FADE_SECONDS, the same everywhere it arrives),
        // which on a busy machine can begin after the skip: what must hold is that it arrives.
        await page.waitForFunction(() => { const g = window.mira.shell.galaxy; return !g.opening && !document.documentElement.dataset.opening && !document.querySelector('.galaxy-label.is-unrevealed') && g.markShown > 0.5 }, null, { timeout: 5000, polling: 'raf' }).catch(() => {})
        const after = await lobby(page)
        assert.deepEqual({ opening: after.opening, held: after.held, unrevealed: after.unrevealed }, { opening: false, held: null, unrevealed: 0 }, `ended with nothing held back: ${JSON.stringify(after)}`)
        assert.ok(after.mark > 0.5, `the name arrives: ${after.mark}`)
        assert.equal(after.started || after.transitioning, false, 'untargeted input only settles the lobby')
      })
    }
    await page.close()
  }
  for (const [name, kind, touch] of [
    ['desktop focused current label and Enter', 'enter', false],
    ['desktop click on a visible disc', 'disc', false],
    ['phone tap on a visible disc', 'disc', true],
    ['phone tap on a printed planet name outside its disc', 'caption', true],
  ]) {
    await check(name, async () => {
      const page = await chrome.newPage({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch, isMobile: touch })
      try {
        await observeEntry(page)
        await page.goto(`${base}?tap=0&room=opening-input-${Date.now()}`)
        await ready(page)
        await enterDuringOpening(page, kind, touch)
      } finally { await page.close() }
    })
  }
  await check('reduced motion, sound allowed: no opening, everything at once, sound running', async () => {
    const page = await chrome.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    await observeEntry(page)
    await page.addInitScript(() => { window.__sawOpening = false; const watch = () => { if (window.mira?.shell?.galaxy?.opening) window.__sawOpening = true; requestAnimationFrame(watch) }; requestAnimationFrame(watch) })
    await page.goto(`${base}?room=opening-rm-${Date.now()}`); await ready(page)
    await page.waitForTimeout(1500)
    const state = await lobby(page)
    assert.equal(await page.evaluate(() => window.__sawOpening), false, 'no opening ran')
    assert.deepEqual({ held: state.held, unrevealed: state.unrevealed }, { held: null, unrevealed: 0 }, JSON.stringify(state))
    assert.equal(state.audio, 'running')
    await enterDuringOpening(page, 'disc', true, true)
    await page.close()
  })
} finally {
  await chrome.close()
}

const safari = await webkit.launch()
try {
  await check('reduced motion, WebKit with the gesture rule: one tap starts the sound and shows the lobby, no opening', async () => {
    const page = await safari.newPage({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      const Native = window.AudioContext
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); void super.suspend() }
        resume() { return window.__gesture ? super.resume() : new Promise(() => {}) }
      }
      for (const t of ['pointerup', 'touchend', 'keydown', 'click', 'mousedown']) window.addEventListener(t, e => { if (!e.isTrusted) return; window.__gesture = true; setTimeout(() => { window.__gesture = false }) }, { capture: true })
    })
    await page.goto(`${base}?tap=1&room=opening-rm-webkit-${Date.now()}`)
    await page.waitForFunction(() => document.querySelector('.tap-gate.is-shown'), null, { timeout: 120000 })
    assert.notEqual(await page.evaluate(() => window.mira.audio.state), 'running', 'sound is held before the tap')
    await page.touchscreen.tap(201, 300)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.mira.audio.state === 'running', null, { timeout: 5000 })
    await page.waitForTimeout(800)
    const state = await lobby(page)
    assert.deepEqual({ opening: state.opening, held: state.held, unrevealed: state.unrevealed }, { opening: false, held: null, unrevealed: 0 }, JSON.stringify(state))
    assert.equal(state.started || state.transitioning, false, 'the tap-to-begin gate does not enter a world')
    await page.close()
  })
} finally {
  await safari.close()
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('opening skip: ok')
