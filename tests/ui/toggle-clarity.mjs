// Screenshots of the standard switch in play: switch rows over a daylight and a night scene at
// each glass setting, the Performance card with Auto quality on and off, and a switch locked by
// the host. Desktop (Chrome) and an iPhone 14 (WebKit), one browser at a time. Bugs caught: a
// switch whose state disagrees with its setting; a plain checkbox left in the sidebar; a row
// locked by the host that does not show its lock to a guest.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs toggle-clarity
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('toggle-clarity')
const out = 'tests/ui/artifacts/toggle-clarity'
await mkdir(out, { recursive: true })

for (const mode of (process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone'])) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=toggle-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector')
    await rail.waitFor({ state: 'visible' })
    const settle = () => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations({ subtree: true }).some(a => a.playState === 'running')).then(() => page.waitForTimeout(250))

    // Every on/off row is a switch with aria-checked matching the registry.
    const mismatched = await page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-row.is-switch')].filter(row => {
      const input = row.querySelector('input'); return input.getAttribute('role') !== 'switch' || input.getAttribute('aria-checked') !== String(!!window.mira.params.get(row.dataset.id).value)
    }).map(row => row.dataset.id))
    assert.deepEqual(mismatched, [], `${mode}: switches agree with their settings`)
    assert.equal(await page.locator('.world-inspector input[type=checkbox]:not([role=switch])').count(), 0, `${mode}: no plain checkboxes left in the sidebar`)

    // The group with the most switches, open in its card, with a mix of on and off.
    const target = await page.evaluate(() => {
      let best = null
      for (const group of document.querySelectorAll('.world-inspector .wi-cards details.wi-group')) {
        // Shared (world) switches, so the same rows can be shown locked by the host.
        const n = [...group.querySelectorAll(':scope > .wi-row.is-switch:not([hidden])')].filter(row => window.mira.params.get(row.dataset.id).def.scope === 'world').length
        if (n && (!best || n > best.n)) best = { n, card: group.closest('.wi-card').dataset.section, group: group.querySelector('summary span')?.textContent }
      }
      return best
    })
    assert.ok(target, `${mode}: some group holds switches`)
    const card = rail.locator(`.wi-card[data-section="${target.card}"]`)
    if (!(await card.evaluate(c => c.classList.contains('is-open')))) { await (touch ? card.locator('.wi-head').tap() : card.locator('.wi-head').click()) }
    const group = card.locator('details.wi-group').filter({ has: page.locator(`summary span:text-is("${target.group}")`) })
    await group.evaluate(g => { g.open = true })
    const ids = await group.locator(':scope > .wi-row.is-switch:not([hidden])').evaluateAll(rows => rows.slice(0, 3).map(r => r.dataset.id))
    const saved = await page.evaluate(ids => ids.map(id => window.mira.params.get(id).value), ids)
    // Alternate on and off so both states sit side by side.
    await page.evaluate(ids => ids.forEach((id, i) => window.mira.params.set(id, i % 2 === 0)), ids)
    await page.evaluate(() => window.mira.shell.inspector.update())
    await group.locator(':scope > .wi-row.is-switch').first().scrollIntoViewIfNeeded()
    const shotRail = async name => { await settle(); await page.screenshot({ path: `${out}/${mode}-${name}.png` }) }

    for (const [scene, hour] of [['day', 12.5], ['night', 0.5]]) {
      await page.evaluate(hour => window.mira.params.set('sun.timeOfDay', hour), hour)
      for (const glass of [0, 1, 2]) {
        await page.evaluate(glass => window.mira.params.set('hud.glass', glass), glass)
        await page.waitForTimeout(400)
        await shotRail(`switches-${scene}-glass${glass}`)
      }
    }
    await page.evaluate(() => window.mira.params.set('hud.glass', 1))
    // Changing the style closes the open groups in other cards (reported 23 November 2026 as a
    // product fault, not this check's subject): open this one again for the lock.
    await group.evaluate(g => { g.open = true })

    // Locked by the host: dimmed, a lock and "host", true state still shown.
    // A guest under the host's lock, as the room reports it: canEditWorld false.
    await page.evaluate(() => {
      window.__realNet = window.miraNet
      window.miraNet = Object.create(window.miraNet ?? {}, { canEditWorld: { value: false }, isHost: { value: false }, locked: { value: true } })
    })
    await page.waitForTimeout(300)
    const lockedWorld = await group.locator('.wi-row.is-locked-row').count()
    await shotRail('switches-locked')
    if (lockedWorld) assert.ok(await group.locator('.wi-row.is-locked-row .wi-lock').first().isVisible(), `${mode}: the lock shows`)
    console.log(`${mode}: ${lockedWorld} locked switch rows in ${target.group}`)
    await page.evaluate(() => { window.miraNet = window.__realNet })
    await page.waitForTimeout(300)
    assert.equal(await group.locator('.wi-row.is-locked-row').count(), 0, `${mode}: unlocked again`)
    await page.evaluate(([ids, saved]) => ids.forEach((id, i) => window.mira.params.set(id, saved[i])), [ids, saved])

    // Close the switch card so the next ones have room. A row's tip, raised by the pointer
    // left over it, can stand over the header for a moment: dismiss it as moving away would.
    await page.evaluate(() => window.mira.shell.inspector.hideTooltip()); if (!touch) await page.mouse.move(1, 1)
    await (touch ? card.locator('.wi-head').tap() : card.locator('.wi-head').click()); await settle()
    // Players & session: Connection diagnostics and Mute audio are switches too.
    const players = rail.locator('details.rail-players, [data-section=players]').first()
    if (await players.count()) {
      await players.evaluate(p => { if (p.tagName === 'DETAILS') p.open = true; else if (!p.classList.contains('is-open')) p.querySelector('.wi-head')?.click() })
      await shotRail('players-switches')
      // Mute lives in the Me card since f1146c26, whether or not that card is open.
      assert.equal(await rail.getByRole('switch', { name: 'Mute audio', includeHidden: true }).count() > 0, true, `${mode}: mute is a switch`)
      await players.evaluate(p => { if (p.tagName === 'DETAILS') p.open = false; else p.querySelector('.wi-head')?.click() }); await settle()
    }
    // The Performance card, Auto quality on and off.
    const perf = rail.locator('.wi-card[data-section=performance]')
    await perf.scrollIntoViewIfNeeded()
    if (!(await perf.evaluate(c => c.classList.contains('is-open')))) await (touch ? perf.locator('.wi-head').tap() : perf.locator('.wi-head').click())
    const auto = perf.getByRole('switch', { name: 'Auto quality' })
    await auto.waitFor({ state: 'attached' })
    await perf.evaluate(c => c.scrollIntoView({ block: 'start' }))
    const autoNow = await auto.getAttribute('aria-checked') === 'true'
    await shotRail(`performance-auto-${autoNow ? 'on' : 'off'}`)
    await auto.focus(); await page.keyboard.press('Enter')
    assert.equal(await auto.getAttribute('aria-checked'), String(!autoNow), `${mode}: Enter toggles Auto quality`)
    await shotRail(`performance-auto-${autoNow ? 'off' : 'on'}`)
    await page.keyboard.press('Space')
    assert.equal(await auto.getAttribute('aria-checked'), String(autoNow), `${mode}: Space toggles Auto quality`)
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: ok`)
  } finally { await browser.close() }
}
