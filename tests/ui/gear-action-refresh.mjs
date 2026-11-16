// Source-prepared focused DOM fixture. Run only in an allocated browser slot against
// the exact candidate's Vite origin. No game, server or build is launched here.
// Controlled secondary actions isolate DOM ownership; this is NOT real gear safety proof.
import { chromium, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.SYN3H_URL
assert.ok(base, 'SYN3H_URL must identify the exact served candidate')
const out = process.env.UX_EVIDENCE_DIR ?? 'tests/ui/artifacts/gear-action-refresh'
await mkdir(out, { recursive: true })
const report = { source: process.env.UX_SOURCE_SHA ?? 'UNSPECIFIED', cases: [] }
assert.notEqual(report.source, 'UNSPECIFIED', 'record exact served source in UX_SOURCE_SHA')
try {
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch({ headless: true })
    try {
      for (const mode of ['Space', 'Enter', 'mouse']) {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
        const errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.route('**/__gear_action_refresh', route => route.fulfill({
          contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
        }))
        await page.goto(new URL('/__gear_action_refresh', base).href)
        await page.evaluate(async () => {
          const { GearSelector } = await import('/src/ui/gear/GearSelector.ts')
          // Fixed geometry prevents the fixture's labels from moving under a held pointer.
          const style = document.createElement('style')
          style.textContent = '.gear-actions{display:flex!important;position:fixed!important;left:50px!important;top:50px!important;transform:none!important;gap:8px}.gs-action{width:180px!important;height:48px!important}'
          document.head.append(style)
          const calls = [], events = [], mutations = []
          let version = 0, controls, node, pointerId
          const action = (id, label, hold) => ({ id, label, hold, keys: [],
            start: () => calls.push(`${version}:${id}:start`),
            stop: reason => calls.push(`${id}:${reason}`) })
          const make = (label, extra, present = true) => ({ gear: 'fixture', name: 'Fixture',
            description: '', state: String(version++), actions: [action('primary', 'Primary omitted', true),
              ...(present ? [action('secondary', label, true)] : []),
              ...(extra ? [action('extra', 'Extra', false)] : [])] })
          controls = make('Hold', false)
          const rack = { current: 'fixture', list: () => ['fixture', 'other'], select() {}, controls: () => controls }
          const selector = new GearSelector(document.body, () => rack, { touch: true })
          selector.update(false)
          node = document.querySelector('[data-action="secondary"].gs-action')
          for (const type of ['blur', 'lostpointercapture', 'pointerleave', 'gotpointercapture'])
            node.addEventListener(type, e => events.push({ type, trusted: e.isTrusted }))
          // Explicit fixture capture exercises native capture retention; production mouse
          // buttons do not request capture here. This does not prove physical touch capture.
          node.addEventListener('pointerdown', e => { pointerId = e.pointerId; node.setPointerCapture(pointerId) })
          new MutationObserver(records => mutations.push(...records.flatMap(r => [...r.removedNodes]).filter(n => n === node).map(() => 'held removed')))
            .observe(node.parentElement, { childList: true })
          window.fixture = {
            refresh(label, extra, present = true) { controls = make(label, extra, present); selector.update(false) },
            snapshot() { return { calls: [...calls], events: [...events], mutations: [...mutations],
              same: document.querySelector('[data-action="secondary"].gs-action') === node,
              connected: node.isConnected, focused: document.activeElement === node,
              captured: pointerId !== undefined && node.hasPointerCapture(pointerId) } },
            dispose() { selector.dispose() },
          }
        })
        const held = page.locator('.gs-action[data-action="secondary"]')
        await held.focus()
        if (mode === 'mouse') {
          const box = await held.boundingBox()
          assert.ok(box)
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.down()
          await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2)
        } else await page.keyboard.down(mode)
        const before = await page.evaluate(() => fixture.snapshot())
        assert.equal(before.calls.length, 1)
        if (mode === 'mouse') assert.equal(before.captured, true)
        for (const [label, extra] of [['Ready', false], ['Ready', true], ['Hold', false]]) {
          await page.evaluate(([label, extra]) => fixture.refresh(label, extra), [label, extra])
          const state = await page.evaluate(() => fixture.snapshot())
          assert.equal(state.same, true); assert.equal(state.connected, true)
          assert.equal(state.focused, true)
          if (mode === 'mouse') assert.equal(state.captured, true)
          assert.equal(state.calls.length, 1, 'presentation must not cleanup or restart a hold')
          assert.deepEqual(state.mutations, [])
          assert.equal(state.events.filter(e => ['blur', 'lostpointercapture', 'pointerleave'].includes(e.type)).length, 0)
        }
        if (mode === 'mouse') await page.mouse.up()
        else await page.keyboard.up(mode)
        let state = await page.evaluate(() => fixture.snapshot())
        assert.deepEqual(state.calls.slice(1), ['secondary:end'])
        // A genuine removal suppresses immediately, but the retained physical end still
        // reaches the original action after its DOM button has disappeared.
        await held.focus()
        if (mode === 'mouse') await page.mouse.down()
        else await page.keyboard.down(mode)
        await page.evaluate(() => fixture.refresh('Removed', false, false))
        state = await page.evaluate(() => fixture.snapshot())
        assert.equal(state.connected, false)
        assert.equal(state.calls.at(-1), 'secondary:cleanup')
        const count = state.calls.length
        if (mode === 'mouse') await page.mouse.up()
        else await page.keyboard.up(mode)
        state = await page.evaluate(() => fixture.snapshot())
        assert.equal(state.calls.length, count + 1)
        assert.equal(state.calls.at(-1), 'secondary:end')
        assert.deepEqual(errors, [])
        report.cases.push({ engine, mode, before, final: state, errors })
        await page.evaluate(() => fixture.dispose())
        await page.close()
      }
    } finally { await browser.close() }
  }
} catch (error) {
  report.failure = String(error.stack ?? error)
  throw error
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
}
