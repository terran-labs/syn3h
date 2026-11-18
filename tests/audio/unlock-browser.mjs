// Sound starts on the first gesture anywhere on the page, in Chromium (with its default autoplay
// policy and with a gesture forced to be required) and in WebKit. For each, a fresh page:
//  - before any input, the context is suspended (or running, if the browser allows it)
//  - after one key press in the lobby, it runs and what is heard rises from silence (the mix's meter)
//  - after one pointer down on the lobby background, the same, and after one touch tap there
//  - after one key press during the loading view, before the game exists, the same once it loads
//
//   tools/heavy.sh node tests/audio/unlock-browser.mjs http://127.0.0.1:<port>
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const engines = [
  ['chromium default', () => chromium.launch({ channel: 'chrome', headless: true })],
  // Headless Chrome starts an AudioContext without a gesture whatever --autoplay-policy says
  // (checked 16 November 2026), so this run also enforces the rule itself: every context is
  // held suspended, and resume() only works during a transient user activation as the browser
  // itself reports it. That is Safari's rule and stricter than Chrome's.
  ['chromium gesture-required', () => chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=user-gesture-required'] }), true],
  ['webkit', () => webkit.launch()],
]
const audioState = page => page.evaluate(() => {
  const a = window.syn3h?.audio
  return a ? { published: a.state, pending: a.pending?.state ?? null, master: a.master?.gain.value ?? null, waiting: a.waitingForGesture } : null
})
const failures = []

const strict = () => {
  const Native = window.AudioContext
  window.AudioContext = class extends Native {
    constructor(...args) { super(...args); void super.suspend() }
    resume() { return navigator.userActivation?.isActive ? super.resume() : new Promise(() => {}) }
  }
}
for (const [name, launch, enforce] of engines) {
  const browser = await launch()
  try {
    for (const input of ['key', 'pointer', 'tap', 'key while loading']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: input === 'tap' })
      if (enforce) await page.addInitScript(strict)
      const errors = []
      page.on('pageerror', error => errors.push(String(error)))
      // Where the browser allows sound without a gesture, it is already playing before input.
      let startedBefore = false
      try {
        if (input === 'key while loading') {
          await page.goto(`${origin}/`, { waitUntil: 'commit' })
          // As soon as the loading view has a body, before the world (and GameAudio) exist.
          await page.waitForFunction(() => document.body)
          await page.keyboard.press('KeyQ')
          const late = await page.evaluate(() => Boolean(window.syn3h))
          await page.waitForFunction(() => window.syn3h?.audio, null, { timeout: 90000 })
          console.log(`${name} | ${input}: game existed at the key press: ${late}`)
        } else {
          await page.goto(`${origin}/`)
          await page.waitForFunction(() => window.syn3h?.audio, null, { timeout: 90000 })
          await page.waitForTimeout(1500) // idle time: the suspended mix is built ahead of the gesture
          const before = await audioState(page)
          console.log(`${name} | before input: ${JSON.stringify(before)}`)
          if (before.published !== 'running') assert.ok(before.waiting, 'waiting for a gesture before input')
          startedBefore = before.published === 'running'
          if (input === 'key') await page.keyboard.press('KeyQ')
          // A touch going down is not a user activation; lifting it is. The first must not strand the second.
          else if (input === 'tap') await page.touchscreen.tap(640, 120)
          else {
            // The lobby background: the galaxy, away from the panels.
            const target = await page.evaluate(() => { const e = document.elementFromPoint(640, 120); return e ? `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}` : 'none' })
            console.log(`${name} | pointer target: ${target}`)
            await page.mouse.move(640, 120); await page.mouse.down()
          }
        }
        await page.waitForFunction(() => window.syn3h.audio.state === 'running', null, { timeout: 8000 })
        // What is heard, from the mix's own output meter every frame, not the master's reported
        // value: WebKit reports a gain's value a frame late, so it read 1 as the fade began.
        const levels = await page.evaluate(() => new Promise(resolve => {
          const rows = [], end = performance.now() + 1300
          const step = () => { rows.push(window.syn3h.audio.outputLevel); if (performance.now() < end) requestAnimationFrame(step); else resolve(rows) }
          requestAnimationFrame(step)
        }))
        const heard = levels.filter(Number.isFinite), first = heard[0] ?? -Infinity, last = heard.at(-1) ?? -Infinity
        const b = await audioState(page)
        console.log(`${name} | after ${input}: running${startedBefore ? ' (already before input)' : ''}, output ${first.toFixed(1)} dB -> ${last.toFixed(1)} dB`)
        if (startedBefore) assert.ok(last > -60, 'sound the browser started without a gesture keeps playing')
        else {
          assert.ok(first < -50, 'sound arrives from silence, not at full level')
          assert.ok(last > first + 10, 'the mix fades in after the gesture')
        }
        assert.equal(b.waiting, false)
        assert.deepEqual(errors, [])
        if (input === 'pointer') await page.mouse.up()
      } catch (error) {
        failures.push(`${name} | ${input}: ${error.message.split('\n')[0]}`)
        console.log(`${name} | ${input}: FAILED ${error.message.split('\n')[0]}`, JSON.stringify(await audioState(page).catch(() => null)))
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
