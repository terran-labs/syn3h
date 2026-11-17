// Tap to begin (src/ui/TapToBegin.ts), in a real browser. The bug it catches: a player whose
// browser blocks sound gets a lobby that hangs on the dark frame, a prompt shown while still
// loading, a tap that does not start the sound, or a Big Bang that starts apart from its music.
//  - WebKit with the gesture rule enforced (every AudioContext starts suspended and resumes only
//    inside a trusted gesture, Safari's rule): the veil waits with one line, the context is
//    suspended, one tap (or click, or key) starts the context, the opening and the score's swell
//    within a few frames of each other, and the drop lands on the pop.
//  - Chromium with autoplay allowed: no prompt, the opening plays at once with sound.
// Automated browsers are never held unless asked, so this uses ?tap=1.
//
//   tools/heavy.sh node tests/ui/tap-to-begin.mjs http://127.0.0.1:<port> [out dir]
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const origin = process.argv[2] ?? 'http://127.0.0.1:5291'
const out = process.argv[3] ?? '/tmp/tap-to-begin'
mkdirSync(out, { recursive: true })

/** Safari's rule, enforced: suspended at birth, resumed only inside a trusted gesture. */
const strict = () => {
  const Native = window.AudioContext
  window.AudioContext = class extends Native {
    constructor(...args) { super(...args); void super.suspend() }
    resume() { return window.__gesture ? super.resume() : new Promise(() => {}) }
  }
  for (const t of ['pointerup', 'touchend', 'keydown', 'click', 'mousedown']) window.addEventListener(t, e => { if (!e.isTrusted) return; window.__gesture = true; setTimeout(() => { window.__gesture = false }) }, { capture: true })
}
/** Records when the veil's state changes and when the prompt appears, from the first paint. */
const recorder = () => {
  window.__tap = { boot: [], gateAt: null, gateBoot: null }
  new MutationObserver(() => {
    const boot = document.documentElement.dataset.boot
    const last = window.__tap.boot.at(-1)
    if (boot !== last?.[0]) window.__tap.boot.push([boot, performance.now()])
    const gate = document.querySelector('.tap-gate')
    if (gate && window.__tap.gateAt === null) { window.__tap.gateAt = performance.now(); window.__tap.gateBoot = boot }
  }).observe(document, { attributes: true, childList: true, subtree: true })
}
const contextState = page => page.evaluate(() => { const a = window.syn3h?.audio; return a?.context?.state ?? a?.pending?.state ?? 'none' })
/** Every frame for `ms`: when the opening started, and the output level. */
const frames = (page, ms) => page.evaluate(ms => new Promise(resolve => {
  const rows = [], end = performance.now() + ms
  const step = () => {
    const g = window.syn3h.shell.galaxy, a = window.syn3h.audio
    rows.push({ t: performance.now(), boot: document.documentElement.dataset.boot, start: g?.opening?.start ?? null, opening: g?.opening !== null, dB: a.outputLevel, state: a.state })
    if (performance.now() < end) requestAnimationFrame(step); else resolve(rows)
  }
  requestAnimationFrame(step)
}), ms)

const cases = [
  { name: 'webkit-phone', engine: webkit, view: { width: 402, height: 874 }, touch: true, strict: true, input: 'tap' },
  { name: 'webkit-landscape', engine: webkit, view: { width: 844, height: 390 }, touch: true, strict: true, input: 'tap' },
  { name: 'webkit-desktop', engine: webkit, view: { width: 1440, height: 900 }, touch: false, strict: true, input: 'click' },
  { name: 'webkit-desktop-key', engine: webkit, view: { width: 1440, height: 900 }, touch: false, strict: true, input: 'Enter' },
  { name: 'chromium-allowed-phone', engine: chromium, args: ['--autoplay-policy=no-user-gesture-required'], view: { width: 402, height: 874 }, touch: true },
  { name: 'chromium-allowed-landscape', engine: chromium, args: ['--autoplay-policy=no-user-gesture-required'], view: { width: 844, height: 390 }, touch: true },
  { name: 'chromium-allowed-desktop', engine: chromium, args: ['--autoplay-policy=no-user-gesture-required'], view: { width: 1440, height: 900 }, touch: false },
]
const only = process.env.ONLY
const failures = [], report = []
for (const c of cases.filter(c => !only || c.name.includes(only))) {
  const browser = await c.engine.launch(c.engine === chromium ? { channel: 'chrome', headless: true, args: c.args } : {})
  const page = await browser.newPage({ viewport: c.view, hasTouch: c.touch, isMobile: c.touch && c.engine === webkit ? true : undefined, deviceScaleFactor: 2 })
  const errors = []; page.on('pageerror', e => errors.push(String(e)))
  if (c.strict) await page.addInitScript(strict)
  await page.addInitScript(recorder)
  try {
    await page.goto(`${origin}/?tap=1`)
    if (c.strict) {
      await page.waitForFunction(() => document.querySelector('.tap-gate.is-shown'), null, { timeout: 120000 })
      await page.waitForTimeout(1200)
      const held = await page.evaluate(() => ({ ...window.__tap, line: document.querySelector('.tap-gate-line')?.textContent, name: document.querySelector('.tap-gate')?.textContent, focused: document.activeElement?.className, role: document.querySelector('.tap-gate')?.tagName, opening: window.syn3h.shell.galaxy?.opening }))
      const before = await contextState(page)
      await page.screenshot({ path: `${out}/${c.name}-held.png` })
      const sampling = frames(page, 2600)
      await page.waitForTimeout(150)
      const tapAt = await page.evaluate(() => performance.now())
      if (c.input === 'tap') await page.touchscreen.tap(c.view.width / 2, c.view.height * 0.3)
      else if (c.input === 'click') await page.mouse.click(c.view.width / 2, c.view.height * 0.3)
      else await page.keyboard.press(c.input)
      const shots = [80, 200, 330, 600, 1200]
      for (let i = 0; i < shots.length; i++) { await page.waitForTimeout(shots[i] - (i ? shots[i - 1] : 0)); await page.screenshot({ path: `${out}/${c.name}-bang-${String(shots[i]).padStart(4, '0')}ms.png` }) }
      const rows = await sampling
      const after = await contextState(page)
      const bangAt = await page.evaluate(() => window.syn3h.audio.bangAt)
      const startRow = rows.find(r => r.start !== null)
      const loudRow = rows.find(r => r.dB > -70)
      const frame = 1000 / 60
      const result = {
        case: c.name, line: held.line, shownWhile: held.gateBoot, bootTrail: held.boot.map(([b]) => b).join(' > '), focused: held.focused,
        before, after, tapToOpeningMs: startRow ? +(startRow.start - tapAt).toFixed(0) : null,
        openingStartToFirstSoundMs: startRow && loudRow ? +(loudRow.t - startRow.start).toFixed(0) : null,
        openingStartToScheduledSoundMs: startRow && bangAt ? +(bangAt.page - startRow.start).toFixed(0) : null,
        popToDropMs: startRow && bangAt ? +((bangAt.page + 300) - (startRow.start + 300)).toFixed(0) : null,
        errors,
      }
      report.push(result)
      assert.equal(held.role, 'BUTTON'); assert.ok(held.name?.length > 10, 'the button has a name')
      assert.equal(held.gateBoot, 'ready', 'the prompt appears only once loading is done')
      assert.equal(held.focused, 'tap-gate is-shown', 'the prompt has focus')
      assert.notEqual(before, 'running', 'sound is blocked before the tap')
      assert.equal(after, 'running', 'sound runs after one tap')
      assert.ok(startRow, 'the opening started')
      assert.ok(Math.abs(result.openingStartToScheduledSoundMs) <= 3 * frame + 1, 'the sound is scheduled within a few frames of the opening')
      assert.ok(loudRow && Math.abs(result.openingStartToFirstSoundMs) <= 5 * frame, 'the first audible output is within a few frames of the opening')
    } else {
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'done' && window.syn3h?.shell?.galaxy, null, { timeout: 120000 })
      const rows = await frames(page, 1500)
      const held = await page.evaluate(() => window.__tap)
      const state = await contextState(page)
      await page.screenshot({ path: `${out}/${c.name}-opening.png` })
      const result = { case: c.name, gate: held.gateAt !== null, bootTrail: held.boot.map(([b]) => b).join(' > '), state, opening: rows.some(r => r.opening), loud: rows.some(r => r.dB > -70), errors }
      report.push(result)
      assert.equal(result.gate, false, 'no prompt where sound is allowed')
      assert.ok(!result.bootTrail.includes('ready'), 'the veil never waits where sound is allowed')
      assert.equal(state, 'running')
    }
    assert.deepEqual(errors, [])
  } catch (error) {
    failures.push(`${c.name}: ${error.message}`)
  } finally {
    await browser.close()
  }
}
console.log(JSON.stringify(report, null, 1))
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('tap to begin: ok')
