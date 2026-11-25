// Exercise the real room, both bot-count controls, and the local mute menu.
// MIRA_URL points to the client and its local room server.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, devices } from 'playwright-core'

const url = new URL(process.env.MIRA_URL ?? 'http://127.0.0.1:5198/')
const out = resolve(process.env.MIRA_PLAYERS_EVIDENCE ?? 'tests/ui/artifacts/players-session')
const before = process.env.MIRA_PLAYERS_BEFORE === '1'
const name = 'Wandering Moon Cartographer'
const card = '.world-inspector:not(.lobby-settings) .wi-card[data-section=players]'
const game = '.world-inspector:not(.lobby-settings) .wi-card[data-section=game]'
const slider = '#session-bot-count'
const gameSlider = `${game} [data-id="bots.count"] input[type=range]`
const playerRow = (page, id) => page.locator(`${card} .score-row[data-player-id="${id}"]`)
const show = async (page, section) => {
  await page.evaluate(section => mira.shell.showCard(section), section)
  await page.locator(`.world-inspector:not(.lobby-settings) .wi-card.is-open[data-section="${section}"]`).waitFor()
}
const value = (page, selector, n) => page.waitForFunction(
  ([s, n]) => document.querySelector(s)?.value === String(n), [selector, n],
)
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
      let socket
      page.on('websocket', connection => { if (new URL(connection.url()).pathname === '/ws') socket = connection })
      const link = new URL(url)
      link.search = new URLSearchParams({ room, name, autoplay: '1', webgl: '1', gfx: '2', world: 'alpine.1' })
      await page.goto(link.href)
      await page.waitForFunction(() => window.miraNet?.connected && mira.shell.playing && !mira.shell.dropping, null, { timeout: 120000 })
      return { page, context, socket }
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
        await value(host, slider, 4); await value(guest, slider, 4); await value(guest, gameSlider, 4)
        await host.waitForFunction(selector =>
          document.querySelector(selector)?.textContent === '2 players, 4 bots', `${card} .wi-sum`)
        assert.equal(await guest.locator(slider).isDisabled(), true)
        assert.equal(await guest.locator(`${card} .rail-session-bots output`).evaluate(el => el.classList.contains('is-disabled')), true)
        assert.equal(await guest.locator(gameSlider).isDisabled(), true)
        await setRange(guest, slider, 5)
        await value(guest, slider, 4); await value(host, slider, 4)
        // Send a forged write over the same test connection. The room must enforce its lock
        // independently of the disabled controls.
        const rejection = guestTab.socket.waitForEvent('framereceived', {
          predicate: ({ payload }) => {
            if (typeof payload !== 'string') return false
            const message = JSON.parse(payload)
            return message.type === 'param' && message.id === 'bots.count' && message.from === 0 && message.value === 4
          },
        })
        await guest.evaluate(() => miraNet.send({ type: 'param', id: 'bots.count', value: 5 }))
        await rejection
        await value(host, slider, 4)

        await host.getByRole('button', { name: 'More bots', exact: true }).click()
        await value(host, gameSlider, 5); await value(guest, slider, 5)
        await show(host, 'game')
        await setRange(host, gameSlider, 4)
        await value(host, slider, 4); await value(guest, slider, 4)
        await host.evaluate(() => miraNet.setLocked(false))
        await guest.waitForFunction(() => !document.querySelector('#session-bot-count').disabled)
        assert.equal(await guest.locator(gameSlider).isDisabled(), false)
        await guest.getByRole('button', { name: 'Fewer bots', exact: true }).click()
        await value(host, slider, 3); await value(guest, gameSlider, 3)
        await show(guest, 'game')
        await setRange(guest, gameSlider, 4)
        await value(host, slider, 4); await value(guest, slider, 4)
        await host.evaluate(() => miraNet.setLocked(true))
        await guest.waitForFunction(() => document.querySelector('#session-bot-count').disabled)
        await Promise.all([show(host, 'players'), show(guest, 'players')])

        if (size === 'portrait') {
          const max = await host.locator(slider).evaluate(input => Number(input.max))
          await host.evaluate(() => mira.params.set('bots.keepCount', false))
          await setRange(host, slider, max)
          await value(guest, gameSlider, max)
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
        await nameButton.click()
        await host.getByRole('menuitem', { name: /^Mute / }).click()
        await flags(host, guestId, 'MUTED')
        assert.equal(await host.evaluate(id => miraNet.chat.muted.has(id), guestId), true)
        assert.equal(await host.evaluate(id => miraNet.chat.muted.has(id), hostId), false)
        assert.equal(await sameNode(), true)
        assert.equal((await row.boundingBox()).height, rowHeight)
        await nameButton.click()
        await host.getByRole('menuitem', { name: /^Unmute / }).click()
        await flags(host, guestId, '')
        await nameButton.click()
        await host.getByRole('menuitem', { name: /^Mute / }).click()
        await flags(host, guestId, 'MUTED')
        assert.equal(await sameNode(), true)
        await original.dispose()
        await host.evaluate(([guestId, guestName]) => { miraNet.players.get(guestId).name = guestName }, [guestId, guestName])
        await row.getByRole('button', { name: guestName, exact: true }).waitFor()

        const layout = await host.locator(card).evaluate(card => {
          const order = selector => Number(getComputedStyle(card.querySelector(selector)).order)
          const controls = [...card.querySelectorAll('.rail-bot-controls > *')].map(el => {
            const r = el.getBoundingClientRect()
            return [r.width, r.height]
          })
          const rows = [...card.querySelectorAll('.score-row')].map(row => {
            const name = row.children[0].getBoundingClientRect(), flags = row.children[1].getBoundingClientRect()
            return { width: name.width, clear: name.right <= flags.left, divider: getComputedStyle(row).borderBottomWidth }
          })
          return { order: ['.score-row', '.rail-universe', '.rail-session-bots', '.rail-diagnostics', '.rail-session-actions'].map(order), controls, rows }
        })
        assert.ok(layout.order.every((n, i) => !i || n > layout.order[i - 1]))
        assert.ok(layout.controls.every(([w,h]) => w >= 44 && h >= 44))
        assert.ok(layout.rows.every(row => row.width > 0 && row.clear && row.divider === '0px'))
      }

      // A manual pause and a parked hidden tab take the same remote snapshot path.
      await guest.evaluate(() => mira.shell.pauseControl.pause('user'))
      await host.waitForFunction(id => miraNet.pausedOf(id), guestId)
      if (!before) {
        await flags(host, guestId, 'PAUSED · MUTED')
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
