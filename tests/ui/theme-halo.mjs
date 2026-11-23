// The Halo theme in the real game: screenshots for review and two hard checks (card headers
// keep their 44 px hit height, and nothing in the rail uses backdrop-filter).
// Run through tests/ui/run-theme-halo.sh, which serves on 5214. Images go to
// tests/ui/artifacts/theme-halo/ (git-ignored).
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5214/'
const shots = 'tests/ui/artifacts/theme-halo'
await mkdir(shots, { recursive: true })

const settled = page => page.waitForFunction(() => !document.querySelector('.wi-cards')?.getAnimations({ subtree: true }).some(a => a.playState === 'running'))
async function openCard(page, section, press) {
  const card = page.locator(`.wi-card[data-section="${section}"]`)
  if (!await card.evaluate(c => c.classList.contains('is-open'))) await press(card.locator('.wi-head'))
  await settled(page)
  return card
}
async function checks(page, label) {
  const result = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('.world-inspector .wi-head')].map(h => h.getBoundingClientRect().height),
    blurred: [...document.querySelectorAll('.world-inspector, .world-inspector *')].filter(el => { const s = getComputedStyle(el); return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none') }).map(el => el.className),
  }))
  assert.ok(result.heads.length > 0, `${label}: card headers present`)
  for (const h of result.heads) assert.ok(h >= 44 - .5, `${label}: card header ${h}px is under 44px`)
  assert.deepEqual(result.blurred, [], `${label}: no backdrop-filter under .world-inspector`)
}

for (const mode of process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] } : { viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    // Touch arrives with ?autoplay=1. On a desktop, ?autoplay=1 alone left the rail hidden, so
    // enter the way a player does (a real gesture captures the cursor), then Escape frees it
    // and the panels open, as in tests/ui/cursor-panels.mjs.
    await page.goto(touch ? `${base}?autoplay=1&room=theme-halo-${mode}-${Date.now()}` : `${base}?room=theme-halo-${mode}-${Date.now()}`)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (!touch) {
      await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
      await page.waitForFunction(() => mira.shell.playing && !mira.shell.dropping, null, { timeout: 120000 })
      await page.waitForFunction(() => document.pointerLockElement === mira.game.canvas, null, { timeout: 10000 }).catch(() => {})
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden, null, { timeout: 15000 })
    } else {
      await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    }
    await page.waitForTimeout(1500)
    const press = locator => touch ? locator.tap() : locator.click()

    if (touch) {
      await page.screenshot({ path: `${shots}/${mode}-play.png` })
      await page.locator('.inspector-toggle').tap()
    }
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    await openCard(page, 'sky', press)
    await openCard(page, 'you', press)
    await checks(page, mode)
    await page.screenshot({ path: `${shots}/${mode}-panels.png` })
    // What actually paints behind the text, layer by layer, for checking the backing by eye.
    if (!touch) console.log(JSON.stringify(await page.evaluate(() => {
      const pick = (el, pseudo) => { const s = getComputedStyle(el, pseudo); return { content: s.content, display: s.display, background: s.backgroundImage + ' | ' + s.backgroundColor, boxShadow: s.boxShadow, filter: s.backdropFilter, opacity: s.opacity } }
      const out = {}
      for (const [name, el] of [['rail-foot', document.querySelector('.rail-foot')], ['open card', document.querySelector('.wi-card.is-open')], ['open body', document.querySelector('.wi-card.is-open .wi-body')], ['inspector', document.querySelector('.world-inspector')]])
        if (el) out[name] = { self: pick(el), before: pick(el, '::before'), after: pick(el, '::after') }
      return out
    }), null, 1))

    if (!touch) {
      // A number being edited, in the open Sky card.
      const num = page.locator('.wi-card[data-section="sky"] .wi-row .wi-num:visible').first()
      await num.scrollIntoViewIfNeeded(); await num.click()
      await page.locator('.wi-num-edit').first().waitFor({ state: 'visible' })
      await page.screenshot({ path: `${shots}/desktop-day-editing.png` })
      // Enter keeps the same value and leaves the field; Escape here could reach the game.
      await page.keyboard.press('Enter')
      // A tooltip: hover a row in the open card.
      const row = page.locator('.wi-card[data-section="you"] .wi-row:visible').first()
      await row.hover(); await page.locator('.wi-tooltip').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${shots}/desktop-day-tooltip.png` })
      await page.mouse.move(400, 500)
      // Night.
      await page.evaluate(() => mira.params.set('sun.timeOfDay', 22.5))
      await page.waitForTimeout(4000)
      await page.screenshot({ path: `${shots}/desktop-night.png` })
      // Paused: Escape once with the cursor free.
      // Escape pauses only with the cursor free; if it is captured, the first Escape frees it.
      await page.evaluate(() => document.activeElement?.blur())
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.pointerLockElement)
      await page.keyboard.press('Escape')
      await page.locator('.pause-veil').waitFor({ state: 'visible', timeout: 5000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${shots}/desktop-paused.png` })
    }
    if (errors.length) console.warn(mode, 'page errors:', errors.slice(0, 5))
    console.log(mode, 'ok')
  } finally {
    await browser.close()
  }
}
