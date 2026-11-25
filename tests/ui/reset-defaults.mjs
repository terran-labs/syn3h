// Every setting can go back to its default (the owner, 25 November 2026: "ensure that any
// property in any card has an easy way to reset it to defaults"). Invariants, each a bug a
// player would hit, in desktop Chrome and iPhone WebKit:
//  1. coverage: a setting row without a reset, or a registered setting with no row at all;
//  2. a reset that restores something other than the true default (the registry's, or the
//     quality level's value for a Settings fine-tune row);
//  3. a row at its default still showing an active reset;
//  4. a guest under the host's lock resetting a shared setting they may not edit;
//  5. "Reset M changes" touching anything outside its section, or nothing inside it;
//  6. a row moving when its reset appears or goes.
// Written against the registry and the rows the row builder makes, not card names, so it
// survives cards being merged and renamed.
//
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs reset-defaults
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('reset-defaults')
const shots = 'tests/ui/artifacts/reset-defaults'
await mkdir(shots, { recursive: true })
/**
 * Registered, not hidden, and still not a row anywhere, on purpose: the quality level and
 * Auto are the Settings card's own controls (Auto is their reset), and the older level
 * follows the quality level.
 */
const NOT_ROWS = new Set(['gfx.quality', 'gfx.auto', 'gfx.level'])
/** Defaults worked out on the device (src/ui/inspector/defaults.ts). */
const DEVICE_DEFAULTS = new Set(['hud.surfaceCoverage', 'chat.overlay'])

for (const mode of process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices['iPhone 14'] } : { viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${base}?autoplay=1&room=reset-defaults-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })

    // ---- 1. Every setting row has a reset, and every setting has a row. ----
    const coverage = await page.evaluate(notRows => {
      const rows = [...document.querySelectorAll('.wi-row[data-id]')]
      const bare = rows.filter(row => !row.querySelector(':scope > button.reset-control')).map(row => row.dataset.id)
      const shown = new Set(rows.map(row => row.dataset.id))
      const missing = mira.params.all().map(p => p.def).filter(def => !def.hidden && !notRows.includes(def.id) && !shown.has(def.id))
        // A hidden vehicle's handling is hidden with it (src/vehicles/available.ts).
        .filter(def => !(def.group === 'Tank' && !document.querySelector('[data-group="Tank"]'))).map(def => def.id)
      return { rows: rows.length, bare, missing }
    }, [...NOT_ROWS])
    assert.ok(coverage.rows > 100, `the panels hold the settings (${coverage.rows} rows)`)
    assert.deepEqual(coverage.bare, [], 'every setting row has a reset')
    assert.deepEqual(coverage.missing, [], 'every registered setting has a row')

    // ---- 3. At the default, no reset is active. A fresh device in a fresh room is all defaults. ----
    const live = await page.evaluate(() => [...document.querySelectorAll('.wi-row[data-id] > .reset-control.is-live')].map(b => b.closest('.wi-row').dataset.id))
    assert.deepEqual(live, [], 'no row at its default shows an active reset')
    assert.equal(await page.locator('.wi-row[data-id] > .reset-control:not(.is-live)').first().evaluate(b => b.inert && b.tabIndex === -1), true, 'an inactive reset is inert')

    // ---- 2. Every row's reset restores its true default. Each setting is moved and reset in
    // one task, so no frame ever draws the moved value. ----
    const failures = await page.evaluate(async deviceDefaults => {
      const bad = []
      const tick = () => Promise.resolve().then(() => Promise.resolve())
      for (const row of document.querySelectorAll('.wi-row[data-id]')) {
        const id = row.dataset.id, p = mira.params.get(id), button = row.querySelector(':scope > .reset-control')
        if (!p || button.disabled) continue
        const def = p.def, before = p.value
        const other = typeof def.default === 'boolean' ? !before : (before !== Math.min(def.min ?? before, def.max ?? before) ? Math.min(def.min, def.max) : Math.max(def.min, def.max))
        if (other === undefined || other === before || !mira.params.set(id, other, 'local')) continue
        await tick()
        if (!button.classList.contains('is-live')) { bad.push(`${id}: no active reset after a change`); mira.params.set(id, before, 'local'); continue }
        if (!/^Reset .+ to .+/.test(button.getAttribute('aria-label') ?? '')) bad.push(`${id}: accessible name "${button.getAttribute('aria-label')}"`)
        if (!/^Reset to .+/.test(button.dataset.tip ?? '')) bad.push(`${id}: tooltip "${button.dataset.tip}"`)
        button.click(); await tick()
        if (button.classList.contains('is-live')) bad.push(`${id}: still changed after reset (${p.value})`)
        const fine = row.classList.contains('is-fine')
        if (!fine && !deviceDefaults.includes(id) && p.value !== def.default) bad.push(`${id}: reset to ${p.value}, registry default ${def.default}`)
        if (p.value !== before) mira.params.set(id, before, 'local')
      }
      return bad
    }, [...DEVICE_DEFAULTS])
    assert.deepEqual(failures, [], 'every reset restores its true default')

    // ---- 6. A row does not move when its reset appears. ----
    const row = page.locator('.wi-row[data-id="paint.gloss"]')
    await row.evaluate(r => { r.closest('.wi-card').querySelector('.wi-head').click(); r.closest('details').open = true })
    await page.waitForTimeout(600); await row.scrollIntoViewIfNeeded()
    const boxes = () => row.evaluate(r => [r, ...r.children].map(el => { const b = el.getBoundingClientRect(); return [el.className, Math.round(b.x * 2) / 2, Math.round(b.y * 2) / 2, Math.round(b.width * 2) / 2, Math.round(b.height * 2) / 2] }))
    const atDefault = await boxes()
    await page.evaluate(() => mira.params.set('paint.gloss', 0.56, 'local')); await page.waitForTimeout(250)
    assert.deepEqual(await boxes(), atDefault, 'the row keeps every box when its reset appears')
    const reset = row.locator('.reset-control')
    assert.equal(await reset.getAttribute('aria-label'), 'Reset Sky reflection to 0.42')
    const target = await reset.boundingBox()
    if (touch) assert.ok(target.width >= 44 - .5 && target.height >= 44 - .5, `the reset is a 44 px target (${target.width} × ${target.height})`)
    if (!touch) { await reset.hover(); await page.waitForTimeout(500) } else await row.locator('.wi-label').tap()
    await page.screenshot({ path: `${shots}/${mode}-sky-reflection.png` })
    await (touch ? reset.tap() : reset.click())
    assert.equal(await page.evaluate(() => mira.params.get('paint.gloss').value), 0.42)

    // ---- 5. "Reset M changes" restores its own section and nothing else. ----
    const fold = page.locator('details.wi-group[data-group="Vehicle paint"]')
    await page.evaluate(() => { mira.params.set('paint.flakes', 1.2, 'local'); mira.params.set('paint.seams', 0.8, 'local'); mira.params.set('hud.mapNorthUp', true, 'local') })
    await page.waitForTimeout(100)
    assert.match(await fold.locator(':scope > summary > small').innerText(), /· 2 changed$/)
    const group = fold.locator(':scope > .wi-group-reset > button')
    assert.equal(await group.innerText(), 'Reset 2 changes')
    await (touch ? group.tap() : group.click())
    assert.equal(await group.innerText(), 'Confirm: reset 2', 'a reset of several asks once, in place')
    assert.equal(await page.evaluate(() => mira.params.get('paint.flakes').value), 1.2, 'nothing changes before the confirmation')
    await (touch ? group.tap() : group.click())
    assert.deepEqual(await page.evaluate(() => ['paint.flakes', 'paint.seams', 'hud.mapNorthUp'].map(id => mira.params.get(id).value)), [0.6, 0.35, true], 'its section only')
    assert.equal(await group.isDisabled(), true); assert.equal(await group.innerText(), 'No changes')
    await page.evaluate(() => mira.params.set('hud.mapNorthUp', false, 'local'))

    // ---- 4. Under the host's lock a guest cannot reset a shared setting. ----
    await page.evaluate(() => {
      mira.params.set('world.gravity', 12, 'local')
      Object.defineProperty(window.miraNet, 'canEditWorld', { get: () => false, configurable: true })
    })
    const gravity = page.locator('.wi-row[data-id="world.gravity"] > .reset-control')
    await page.waitForFunction(() => document.querySelector('.wi-row[data-id="world.gravity"] > .reset-control').disabled)
    await gravity.evaluate(b => b.click())
    assert.equal(await page.evaluate(() => mira.params.get('world.gravity').value), 12, 'a locked reset changes nothing')
    await page.evaluate(() => { delete window.miraNet.canEditWorld; mira.params.set('world.gravity', mira.params.get('world.gravity').def.default, 'local') })

    assert.deepEqual(errors, [], 'no page errors')
    console.log(`reset-defaults ${mode}: ${coverage.rows} rows, all with a working reset`)
  } finally { await browser.close() }
}
