// Record blank frames (Performance, Diagnostics) in desktop Chrome. What must stay true:
// - The switch is there, off by default, and while off the copied report still carries the
//   graphics line (backend, adapter, scene samples, refraction) and the device error count.
// - Recording a normal run in play records no blank frame.
// - A frame whose canvas is cleared after the draw (the test hook, as a resize would) is recorded,
//   and the count beside the switch and the copied report both show it.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/blank-frames.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(String(error.stack ?? error.message).slice(0, 600)))
  await page.goto(`${base}?autoplay=1&room=blank-frames-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  // Past the drop: the descent through space is dark by design.
  await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  await page.waitForTimeout(1500)
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
  const card = page.locator('.wi-card[data-section=performance]')
  if (!(await card.evaluate(el => el.classList.contains('is-open')))) await card.locator('.wi-head').click()
  const fold = card.locator('details.performance-diagnostics')
  if (!(await fold.evaluate(el => el.open))) await fold.locator('summary').click()

  const copyReport = async () => {
    await card.locator('[data-performance=copy-report]').click()
    await page.waitForFunction(() => /copied|Select and copy/.test(document.querySelector('[data-performance=copy-status]')?.textContent ?? ''))
    return page.evaluate(async () => { const field = document.querySelector('[data-performance=copy-text]'); return field.hidden ? navigator.clipboard.readText() : field.value })
  }

  const toggle = card.locator('.wi-blank-frames input')
  assert.equal(await toggle.isChecked(), false, 'Record blank frames is off by default')
  assert.equal(await card.locator('[data-performance=blank-count]').textContent(), 'Off')
  const off = await copyReport()
  assert.match(off, /^Graphics: (WebGPU|WebGL 2), adapter .*, scene samples .*, refraction .*$/m, 'the graphics line, switch off')
  assert.match(off, /^Uncaptured device errors this session: \d+/m, 'the device error count, switch off')
  assert.match(off, /^Blank frames: not recorded/m)

  // A normal run, recorded.
  await toggle.click()
  assert.equal(await toggle.isChecked(), true)
  const before = await page.evaluate(() => mira.game.blankFrames.frames)
  await page.waitForTimeout(5000)
  const normal = await page.evaluate(() => ({ frames: mira.game.blankFrames.frames, total: mira.game.blankFrames.total, events: mira.game.blankFrames.events.slice(0, 3) }))
  assert.ok(normal.frames - before > 30, `frames were recorded: ${normal.frames - before}`)
  assert.equal(normal.total, 0, `a normal run records no blank frame: ${JSON.stringify(normal.events)}`)

  // One frame cleared after its draw.
  await page.evaluate(() => mira.game.blankFrames.clearNextFrame())
  await page.waitForFunction(() => mira.game.blankFrames.total >= 1, null, { timeout: 10000 }).catch(async error => {
    const why = await page.evaluate(() => { const b = mira.game.blankFrames; return { backend: mira.game.backend, frames: b.frames, total: b.total, clearNext: b.clearNext, previousShare: b.previousShare } })
    throw new Error(`the cleared frame was not recorded: ${JSON.stringify(why)}`, { cause: error })
  })
  await page.waitForFunction(() => /^[1-9]\d* in the last minute, [1-9]\d* in total$/.test(document.querySelector('[data-performance=blank-count]')?.textContent ?? ''), null, { timeout: 10000 })
  const on = await copyReport()
  assert.match(on, /^Blank frames: [1-9]\d* in \d+ frames recorded/m, 'the report counts it')
  assert.match(on, /^Blank frames by coincidence \(a frame copy counts when the number differs from the usual \d+\): frame copy \d+, resize \d+, quality step \d+, device error \d+, nothing \d+$/m)
  assert.match(on, /^ {2}[\d.]+ s blank \(100%\), (WebGPU|WebGL 2), level \d+ rung \d+ /m, 'the event in full')

  await toggle.click()
  assert.equal(await toggle.isChecked(), false)
  assert.deepEqual(errors, [], 'no page errors')
  console.log('blank-frames: ok', JSON.stringify({ recorded: normal.frames - before, report: on.split('\n').filter(l => /^(Graphics:|Uncaptured|Blank frames|  [\d.]+ s )/.test(l)) }))
} finally {
  await browser.close()
}
