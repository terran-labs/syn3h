// Exercise the composer through its real card, input events and local chat channel.
// MIRA_URL must point to the isolated dev server for this check.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const sizes = [[1280, 800, false], [1700, 1100, false], [390, 844, true], [844, 390, true]]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [width, height, touch] of sizes) {
    const tag = `${width}x${height}`
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
    const page = await context.newPage()
    await page.goto(`${base}?autoplay=1&vehicle=buggy&room=composer-${tag}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.miraChat, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.locator('.entry-warm-progress').waitFor({ state: 'hidden', timeout: 120000 })
    await page.evaluate(() => {
      const chat = window.miraChat.net.chat
      // Sending stays in this browser. Exercise both the accepted and refused paths.
      window.composerSends = []
      window.composerAccept = true
      chat.send = text => {
        window.composerSends.push(text)
        return window.composerAccept
      }
      window.miraChat.panel.openAndFocus()
    })
    const card = page.locator('.wi-card[data-section="chat"].is-open')
    const draft = card.getByRole('textbox', { name: 'Chat', exact: true })
    await draft.waitFor()
    const layout = () => draft.evaluate(el => {
      const box = el.getBoundingClientRect()
      const button = el.form.querySelector('.chat-send').getBoundingClientRect()
      const css = getComputedStyle(el)
      return {
        multiline: el.form.classList.contains('is-multiline'),
        height: box.height, width: box.width, top: box.top, bottom: box.bottom,
        x: box.left, inset: [parseFloat(css.paddingLeft), parseFloat(css.paddingRight)],
        line: parseFloat(css.lineHeight), padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom),
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop,
        sendTop: button.top, sendBottom: button.bottom, sendRight: button.right, sendWidth: button.width,
      }
    })
    const frame = async label => {
      if (!out) return
      const form = card.locator('.chat-form')
      await form.screenshot({ path: `${out}/${tag}-${label}.png`, animations: 'disabled' })
    }

    if (height === 1100) {
      // An empty chat starts below the stack's 200 px comfort floor. Choose a stack height
      // where it and an older Game card (the old Me card, sidebar consolidation) fit inline, but cross the normal collapse threshold
      // when the composer takes a second row. The real content observer must trigger the fit.
      await page.evaluate(() => {
        const shell = window.mira.shell
        const chat = document.querySelector('.wi-card[data-section="chat"]')
        chat.querySelector('.wi-head').click()
        shell.showCard('game')
        window.miraChat.panel.openAndFocus()
        chat.querySelector('.chat-log').replaceChildren()
      })
      const me = page.locator('.wi-card[data-section="game"]')
      await page.waitForFunction(() => !document.querySelector('.wi-card.is-moving'))
      const room = await card.evaluate(chat => {
        const stack = chat.closest('.wi-cards')
        const visible = [...stack.children].filter(row => row.getClientRects().length)
        const height = row => row.querySelector('.wi-head')?.offsetHeight + row.offsetHeight - row.clientHeight || row.offsetHeight
        const headers = visible.reduce((sum, row) => sum + height(row), 0)
        const gaps = (visible.length - 1) * parseFloat(getComputedStyle(stack).rowGap)
        const me = stack.querySelector('[data-section="game"]')
        const inlineChat = Math.min(200, chat.offsetHeight)
        const total = headers + gaps + 200 - height(me) + inlineChat - height(chat)
        stack.style.maxHeight = `${Math.ceil(total - 19)}px`
        return { inlineChat, total, available: stack.clientHeight }
      })
      assert.ok(room.inlineChat < 195, `${tag}: empty chat starts under the stack floor ${JSON.stringify(room)}`)
      await page.waitForFunction(() => !document.querySelector('.wi-card.is-moving'))
      assert.ok(await me.evaluate(el => el.classList.contains('is-open')), `${tag}: Game fits beside the one-line draft`)
      await draft.fill('One\nTwo')
      await page.waitForFunction(() => !document.querySelector('.wi-card[data-section="game"]').classList.contains('is-open'), null, { timeout: 8000 })
      await draft.fill('')
      await card.evaluate(el => el.closest('.wi-cards').style.removeProperty('max-height'))
      console.log(`${tag}: the existing stack fit collapsed the older card as the empty history grew`)
    }

    await draft.fill('One line.')
    const one = await layout()
    assert.ok(!one.multiline && Math.abs(one.top - one.sendTop) < 1, `${tag}: Send sits beside one line`)
    assert.deepEqual(one.inset, [touch ? 20 : 18, touch ? 20 : 18])
    await frame('one')
    await draft.press('Shift+Enter')
    await page.keyboard.insertText('Second line.')
    assert.equal(await draft.inputValue(), 'One line.\nSecond line.')
    const two = await layout()
    assert.ok(two.multiline && two.sendTop >= two.bottom && two.height > one.height, `${tag}: second line puts Send below, ${JSON.stringify(two)}`)
    assert.ok(Math.abs(two.sendRight - one.sendRight) < 1 && two.sendWidth > one.sendWidth)
    assert.deepEqual(two.inset, one.inset)
    assert.equal(two.x, one.x)
    await frame('two')

    // Find a draft which crosses the beside-Send width by one character.
    for (let n = 1; n <= 80; n++) {
      await draft.fill('W'.repeat(n))
      if ((await layout()).multiline) break
    }
    const threshold = await draft.inputValue()
    const expanded = await layout()
    assert.ok(expanded.multiline && expanded.width > one.width, `${tag}: text wraps at the beside-Send width`)
    await draft.evaluate(el => new Promise(resolve => {
      const states = []
      const track = () => {
        states.push(el.form.classList.contains('is-multiline'))
        if (states.length === 12) resolve(states)
        else requestAnimationFrame(track)
      }
      requestAnimationFrame(track)
    })).then(states => assert.ok(states.every(Boolean), `${tag}: threshold draft stays expanded`))
    assert.equal(await draft.inputValue(), threshold)

    if (touch) await draft.evaluate(el => {
      const viewport = window.visualViewport
      Object.defineProperty(viewport, 'height', { configurable: true, value: innerHeight - (innerWidth > innerHeight ? 145 : 300) })
      viewport.dispatchEvent(new Event('resize'))
    })
    await draft.fill('One\nTwo\nThree')
    const three = await layout()
    assert.ok(three.height > two.height, `${tag}: draft grows to at least three lines`)
    const maxLength = await draft.evaluate(el => el.maxLength)
    await draft.fill(('A\n').repeat(Math.floor(maxLength / 2)).slice(0, maxLength))
    await draft.press('End')
    await page.keyboard.insertText('Z')
    assert.equal((await draft.inputValue()).length, maxLength, `${tag}: typing respects the message length limit`)
    const overflow = await layout()
    assert.ok(overflow.height >= three.height && overflow.height <= Math.ceil(overflow.line * 5 + overflow.padding), `${tag}: draft stops growing after three to five lines ${JSON.stringify(overflow)}`)
    assert.ok(overflow.scrollHeight > overflow.clientHeight && overflow.scrollTop > 0, `${tag}: caret can scroll past the visible rows`)
    await frame('overflow')
    if (touch) {
      const visibleBottom = await page.evaluate(() => visualViewport.offsetTop + visualViewport.height)
      const fieldBox = await layout()
      assert.ok(fieldBox.sendBottom <= visibleBottom + 1, `${tag}: field stays above the simulated keyboard ${JSON.stringify(fieldBox)}`)
    }
    const cap = Math.round((overflow.height - overflow.padding) / overflow.line)
    await draft.fill(Array.from({ length: cap }, (_, i) => `Line ${i + 1}`).join('\n'))
    const max = await layout()
    assert.equal(max.height, overflow.height, `${tag}: further text does not grow the field`)
    await frame('max')

    await draft.fill('')
    assert.deepEqual(await layout().then(x => [x.multiline, x.height]), [false, one.height], `${tag}: deleting the draft restores inline Send`)
    assert.equal(await page.evaluate(() => mira.game.input.typing), true)
    await draft.press('y')
    await draft.press('w')
    assert.equal(await draft.inputValue(), 'yw')
    assert.equal(await page.evaluate(() => mira.game.input.state.y), 0)
    await draft.fill('Keep\nthis draft')
    await page.evaluate(() => { window.composerAccept = false })
    await draft.press('Enter')
    assert.equal(await draft.inputValue(), 'Keep\nthis draft')
    await page.evaluate(() => { window.composerAccept = true })
    await draft.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart'))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
      el.dispatchEvent(new CompositionEvent('compositionend'))
    })
    assert.equal(await draft.inputValue(), 'Keep\nthis draft')
    assert.deepEqual(await page.evaluate(() => window.composerSends), ['Keep\nthis draft'])
    if (touch) await draft.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true })))
    else await draft.press('Enter')
    assert.equal(await draft.inputValue(), '')
    assert.ok(!(await layout()).multiline)
    assert.deepEqual(await page.evaluate(() => window.composerSends), ['Keep\nthis draft', 'Keep\nthis draft'])
    await frame('sent')
    const log = card.locator('.chat-log')
    await page.evaluate(() => {
      const channel = window.miraChat.net.chat
      for (let i = 0; i < 32; i++) channel.receive({ type: 'chat', from: 42, text: `Local scrollback sample ${i}`, t: 0 })
    })
    const fromEnd = () => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    await log.evaluate(el => { el.scrollTop = el.scrollHeight })
    await draft.fill('Three\nline\ndraft')
    await page.waitForFunction(() => {
      const log = document.querySelector('.wi-card[data-section="chat"] .chat-log')
      return log.scrollHeight - log.scrollTop - log.clientHeight < 3
    })
    await log.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel')); el.scrollTop = 0 })
    await page.waitForFunction(() => document.querySelector('.wi-card[data-section="chat"] .chat-log').scrollTop < 2)
    await draft.fill('One line.')
    assert.ok(await fromEnd() > 30, `${tag}: resizing does not pin a log the player scrolled up`)
    await draft.press('Escape')
    assert.equal(await page.evaluate(() => mira.game.input.typing), false)
    await page.evaluate(() => window.miraChat.panel.openAndFocus())
    await draft.fill('')
    await draft.press('Enter')
    assert.equal(await page.evaluate(() => mira.game.input.typing), false)
    assert.equal(await page.evaluate(() => window.composerSends.length), 2)
    console.log(`${tag}: composer ok (${cap} visible draft lines)`)
    await context.close()
  }
} finally { await browser.close() }
