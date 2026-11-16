/**
 * Nothing on the page can be selected. On a touch device a long press that selects a label,
 * opens the copy callout or drags an image takes the player out of the game, so selection is
 * switched off everywhere except in fields the player types in.
 *
 *   tools/heavy.sh node tests/ui/no-select.mjs
 *
 * WebKit at iPad and iPhone sizes. Needs the lane dev server on 5187. What it cannot do is
 * long-press a real screen: that needs a device.
 */
import { devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await webkit.launch()
const errors = []
try {
  for (const name of ['iPad Pro 11 landscape', 'iPhone 14']) {
    const context = await browser.newContext({ ...devices[name] }), page = await context.newPage()
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
    await page.goto(`http://127.0.0.1:5187/?room=no-select-${Date.now()}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
    const result = await page.evaluate(() => {
      const select = (el) => { const s = getComputedStyle(el); return s.webkitUserSelect || s.userSelect }
      // Every element that shows text, outside fields, must refuse selection.
      const selectable = []
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('input, textarea, [contenteditable]')) continue
        if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
        if (select(el) !== 'none') selectable.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60))
      }
      const fire = (target, type) => { const event = new Event(type, { bubbles: true, cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented }
      const label = [...document.body.querySelectorAll('button, p, span, div')].find(el => el.textContent.trim() && !el.closest('input, textarea'))
      const field = document.createElement('input'); field.value = 'room name'; document.body.append(field)
      // A selection made by script over page text is dropped; one inside a field is kept.
      const range = document.createRange(); range.selectNodeContents(label); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
      return new Promise(resolve => setTimeout(() => {
        const dropped = getSelection().isCollapsed
        field.focus(); field.select()
        const kept = field.selectionEnd - field.selectionStart
        const out = { selectable: selectable.slice(0, 8), count: selectable.length, callout: getComputedStyle(label).webkitTouchCallout ?? 'unsupported',
          body: select(document.body), selectstart: fire(label, 'selectstart'), dragstart: fire(label, 'dragstart'), fieldSelectstart: fire(field, 'selectstart'),
          fieldSelect: select(field), dropped, kept }
        field.remove(); resolve(out)
      }, 120))
    })
    assert.equal(result.count, 0, `${name}: selectable text remains: ${result.selectable.join(', ')}`)
    assert.equal(result.body, 'none', `${name}: body`)
    assert.equal(result.selectstart, true, `${name}: selectstart on a label is refused`)
    assert.equal(result.dragstart, true, `${name}: dragstart on a label is refused`)
    assert.equal(result.fieldSelectstart, false, `${name}: a field may start a selection`)
    assert.notEqual(result.fieldSelect, 'none', `${name}: a field stays selectable`)
    assert.equal(result.dropped, true, `${name}: a selection over page text is dropped`)
    assert.ok(result.kept > 0, `${name}: a selection inside a field is kept`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true }))
} finally { await browser.close() }
