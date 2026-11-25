// Exercise the real room, both bot-count controls, and Mute for me in the player panel.
// MIRA_URL points to the client and its local room server.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, devices } from 'playwright-core'

const url = new URL(process.env.MIRA_URL ?? 'http://127.0.0.1:5198/')
const out = resolve(process.env.MIRA_PLAYERS_EVIDENCE ?? 'tests/ui/artifacts/players-session')
const before = process.env.MIRA_PLAYERS_BEFORE === '1'
// Set on the combined Players and reset-to-default build.
const expectReset = process.env.MIRA_PLAYERS_EXPECT_RESET === '1'
const name = 'Wandering Moon Cartographer'
const card = '.world-inspector:not(.lobby-settings) .wi-card[data-section=players]'
const slider = '#session-bot-count'
const playerRow = (page, id) => page.locator(`${card} .score-row[data-player-id="${id}"]`)
const show = async (page, section) => {
  await page.evaluate(section => mira.shell.showCard(section), section)
  await page.locator(`.world-inspector:not(.lobby-settings) .wi-card.is-open[data-section="${section}"]`).waitFor()
}
const value = (page, selector, n) => page.waitForFunction(
  ([s, n]) => document.querySelector(s)?.value === String(n), [selector, n],
)
const mutedMark = (page, id, name) => page.waitForFunction(([id, name]) =>
  (document.querySelector(`.score-row[data-player-id="${id}"] .score-muted svg`)?.getAttribute('aria-label') ?? null) === name, [id, name])
const flags = (page, id, expected) => page.waitForFunction(([id, expected]) =>
  document.querySelector(`.score-row[data-player-id="${id}"] > small`)?.textContent === expected, [id, expected])
const setRange = (page, selector, n) => page.locator(selector).evaluate((input, n) => {
  input.value = String(n)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, n)

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [size, width, height, touch] of [['portrait', 390, 844, true], ['landscape', 844, 390, true], ['desktop', 1280, 800, false]]) {
    const opts = {
      ...(touch ? devices['iPhone 14'] : {}), viewport: { width, height }, deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    }
    const room = `players-ui-${Date.now()}-${size}`
    const errors = []
    const context = async () => {
      const context = await browser.newContext(opts)
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      const link = new URL(url)
      link.search = new URLSearchParams({ room, name, autoplay: '1', webgl: '1', gfx: '2', world: 'alpine.1' })
      await page.goto(link.href)
      await page.waitForFunction(() => window.miraNet?.connected && mira.shell.playing && !mira.shell.dropping, null, { timeout: 120000 })
      return { page, context }
    }
    const hostTab = await context()
    const guestTab = await context()
    const host = hostTab.page, guest = guestTab.page
    try {
      await host.waitForFunction(() => miraNet.isHost && [...miraNet.players.values()].filter(p => !p.bot).length === 2)
      await guest.waitForFunction(() => !miraNet.isHost && [...miraNet.players.values()].filter(p => !p.bot).length === 2)
      const hostId = await host.evaluate(() => miraNet.id), guestId = await guest.evaluate(() => miraNet.id)
      await host.evaluate(() => {
        mira.params.set('bots.keepCount', true)
        mira.params.set('bots.count', 4)
        miraNet.setLocked(true)
      })
      await guest.waitForFunction(() => miraNet.locked)
      await Promise.all([show(host, 'players'), show(guest, 'players')])
      await host.waitForFunction(() => [...miraNet.players.values()].filter(p => p.bot).length === 4, null, { timeout: 30000 })
      await guest.waitForFunction(() => [...miraNet.players.values()].filter(p => p.bot).length === 4)

      if (!before) {
        const header = host.locator(card).getByRole('button', { name: /^Players(?:\s|$)/ })
        assert.equal(await header.locator('h3').textContent(), 'Players')
        assert.equal(await host.locator('#session-bot-count').count(), 1)
        const inspector = host.locator('.world-inspector:not(.lobby-settings)')
        assert.equal(await inspector.locator('[data-id="bots.count"], [data-id="hud.diagnostics"]').count(), 0)
        assert.equal(await inspector.locator('.rail-diagnostics input[type=checkbox]').count(), 1)
        await value(host, slider, 4); await value(guest, slider, 4)
        await host.waitForFunction(selector =>
          document.querySelector(selector)?.textContent === '2 players, 4 bots', `${card} .wi-sum`)
        const less = page => page.getByRole('button', { name: 'Fewer bots', exact: true })
        const more = page => page.getByRole('button', { name: 'More bots', exact: true })
        for (const control of [guest.locator(slider), less(guest), more(guest)]) {
          assert.equal(await control.isDisabled(), true)
        }
        assert.equal(await guest.locator(`${card} .rail-session-bots output`).evaluate(el => el.classList.contains('is-disabled')), true)
        // The shipped input handler also guards against a stale control during a lock change.
        await setRange(guest, slider, 5)
        await value(guest, slider, 4); await value(host, slider, 4)
        assert.equal(await guest.evaluate(() => mira.params.get('bots.count').value), 4)

        await more(host).click()
        await value(host, slider, 5); await value(guest, slider, 5)
        await setRange(host, slider, 4)
        await value(guest, slider, 4)
        await host.evaluate(() => miraNet.setLocked(false))
        await guest.waitForFunction(() => !document.querySelector('#session-bot-count').disabled)
        assert.equal(await less(guest).isEnabled(), true)
        await less(guest).click()
        await value(host, slider, 3); await value(guest, slider, 3)
        await setRange(guest, slider, 4)
        await value(host, slider, 4); await value(guest, slider, 4)
        await host.evaluate(() => miraNet.setLocked(true))
        await guest.waitForFunction(() => document.querySelector('#session-bot-count').disabled)
        await Promise.all([show(host, 'players'), show(guest, 'players')])

        if (size === 'portrait' && expectReset) {
          const diagnostics = host.locator(`${card} .rail-diagnostics[data-setting-id="hud.diagnostics"]`)
          assert.equal(await diagnostics.count(), 1)
          const toggle = diagnostics.locator('input[type=checkbox]')
          const reset = diagnostics.getByRole('button', { name: 'Reset Connection diagnostics to off', exact: true })
          assert.equal(await toggle.isChecked(), false)
          await toggle.check()
          await reset.click()
          assert.equal(await toggle.isChecked(), false)
          assert.equal(await host.evaluate(() => mira.params.get('hud.diagnostics').value), false)
        }

        if (size === 'portrait') {
          const max = await host.locator(slider).evaluate(input => Number(input.max))
          await host.evaluate(() => mira.params.set('bots.keepCount', false))
          await setRange(host, slider, max)
          await value(guest, slider, max)
          assert.match(await host.locator(`${card} .rail-session-bots output`).textContent(), new RegExp(`^${max} requested · \\d+ in room$`))
          await setRange(host, slider, 4)
          await value(guest, slider, 4)
          await host.evaluate(() => mira.params.set('bots.keepCount', true))
        }

        // The current server disambiguates names on admission. A local roster fixture also
        // checks the display layer with duplicates, without changing either connection's ID.
        const [guestName, duplicate] = await host.evaluate(([hostId, guestId]) => {
          const remote = miraNet.players.get(guestId)
          const old = remote.name
          remote.name = miraNet.players.get(hostId).name
          return [old, remote.name]
        }, [hostId, guestId])
        const row = playerRow(host, guestId), nameButton = row.getByRole('button', { name: duplicate, exact: true })
        await nameButton.waitFor()
        const original = await nameButton.elementHandle()
        const rowHeight = (await row.boundingBox()).height
        const sameNode = () => nameButton.evaluate((button, original) => button === original, original)
        // Mute for me lives in the player panel the row opens (src/ui/players); the row shows it
        // as the crossed speaker named "Muted for you", only on the muter's screen.
        const muteForMe = async on => {
          if (await host.locator('#player-panel').isHidden()) await nameButton.click()
          const toggle = host.locator('#player-panel .pp-toggle[data-mute=me]')
          if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click()
          await host.waitForFunction(([id, on]) => miraNet.chat.muted.has(id) === on, [guestId, on])
          await mutedMark(host, guestId, on ? 'Muted for you' : null)
          await host.keyboard.press('Escape')
          await host.locator('#player-panel').waitFor({ state: 'hidden' })
        }
        await muteForMe(true)
        assert.equal(await host.evaluate(id => miraNet.chat.muted.has(id), guestId), true)
        assert.equal(await host.evaluate(id => miraNet.chat.muted.has(id), hostId), false)
        assert.equal(await sameNode(), true)
        assert.equal((await row.boundingBox()).height, rowHeight)
        await muteForMe(false)
        await muteForMe(true)
        assert.equal(await sameNode(), true)
        await original.dispose()
        await host.evaluate(([guestId, guestName]) => { miraNet.players.get(guestId).name = guestName }, [guestId, guestName])
        await row.getByRole('button', { name: guestName, exact: true }).waitFor()

        const layout = await host.locator(card).evaluate(card => {
          const order = selector => Number(getComputedStyle(card.querySelector(selector)).order)
          const heading = card.querySelector('.rail-bot-heading')
          const words = [...heading.children].map(el => el.getBoundingClientRect())
          const headingRect = heading.getBoundingClientRect()
          const controlRow = card.querySelector('.rail-bot-controls')
          const controlRect = controlRow.getBoundingClientRect()
          const controls = [...controlRow.children].map(el => {
            const r = el.getBoundingClientRect(), css = getComputedStyle(el)
            return { width: r.width, height: r.height, paintedWidth: el.offsetWidth, paintedHeight: el.offsetHeight, centerY: (r.top + r.bottom) / 2,
              tag: el.tagName, border: css.borderTopStyle, borderWidth: parseFloat(css.borderTopWidth),
              background: css.backgroundColor, filter: css.backdropFilter }
          })
          const sameLine = words[0].top < words[1].bottom && words[1].top < words[0].bottom
          const fillsSecondLine = controlRect.top >= headingRect.bottom &&
            Math.abs(controlRect.left - headingRect.left) <= 1 && Math.abs(controlRect.right - headingRect.right) <= 1
          const rows = [...card.querySelectorAll('.score-row')].map(row => {
            const name = row.children[0].getBoundingClientRect(), flags = row.children[1].getBoundingClientRect()
            return { width: name.width, clear: name.right <= flags.left, divider: getComputedStyle(row).borderBottomWidth }
          })
          return { order: ['.score-row', '.rail-universe', '.rail-session-bots', '.rail-diagnostics', '.rail-session-actions'].map(order), controls, rows, sameLine, fillsSecondLine }
        })
        assert.ok(layout.order.every((n, i) => !i || n > layout.order[i - 1]))
        const minimum = touch ? 44 : 32
        assert.equal(layout.sameLine, true, 'Bots and the counts share the first line')
        assert.equal(layout.fillsSecondLine, true, 'the controls fill the second line')
        for (const control of layout.controls) {
          assert.ok(control.paintedWidth >= minimum && control.paintedHeight >= minimum,
            `${size}: expected a ${minimum}px painted control, got ${JSON.stringify(control)}`)
          assert.ok(control.width >= minimum - .5 && control.height >= minimum - .5,
            `${size}: expected a ${minimum}px viewport box, got ${JSON.stringify(control)}`)
        }
        assert.ok(layout.controls.every(control => Math.abs(control.centerY - layout.controls[0].centerY) <= 1))
        for (const control of [layout.controls[0], layout.controls[2]]) {
          assert.equal(control.tag, 'BUTTON')
          assert.ok(control.border === 'solid' && control.borderWidth >= 1)
          assert.doesNotMatch(control.background, /^(transparent|rgba\([^)]*,\s*0\))$/)
          assert.equal(control.filter, 'none')
        }
        assert.ok(layout.rows.every(row => row.width > 0 && row.clear && row.divider === '0px'))
        const body = host.locator(`${card} > .wi-body`)
        const start = await body.evaluate(el => el.scrollTop)
        await host.locator(`${card} .rail-session-bots`).scrollIntoViewIfNeeded()
        await host.screenshot({ path: resolve(out, `${size}-bots.png`), scale: 'css' })
        await body.evaluate((el, top) => { el.scrollTop = top }, start)
      }

      // A manual pause and a parked hidden tab take the same remote snapshot path.
      await guest.evaluate(() => mira.shell.pauseControl.pause('user'))
      await host.waitForFunction(id => miraNet.pausedOf(id), guestId)
      if (!before) {
        await flags(host, guestId, 'PAUSED')
        await mutedMark(host, guestId, 'Muted for you')
        await flags(guest, guestId, 'YOU · PAUSED')
        const row = playerRow(host, guestId)
        const current = await row.evaluate(el => {
          const name = el.children[0].getBoundingClientRect(), flags = el.children[1].getBoundingClientRect()
          return name.width > 0 && name.right <= flags.left && flags.height <= el.getBoundingClientRect().height
        })
        assert.equal(current, true, 'combined statuses stay to the right of the long name')
      }
      await host.screenshot({ path: resolve(out, `${size}-host.png`), scale: 'css' })
      await guest.evaluate(() => mira.shell.pauseControl.resume('user'))
      await host.waitForFunction(id => !miraNet.pausedOf(id), guestId)
      await host.evaluate(() => mira.shell.pauseControl.pause('hidden'))
      await guest.waitForFunction(id => miraNet.pausedOf(id), hostId)
      if (!before) await flags(guest, hostId, 'HOST · PAUSED')
      await guest.screenshot({ path: resolve(out, `${size}-guest.png`), scale: 'css' })
      await host.evaluate(() => mira.shell.pauseControl.resume('hidden'))
      assert.deepEqual(errors, [])
      console.log(size, before ? 'baseline captured' : 'host and guest roster, controls and pauses passed')
    } finally {
      await hostTab.context.close()
      await guestTab.context.close()
    }
  }
} finally {
  await browser.close()
}
