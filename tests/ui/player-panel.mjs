// The player panel in a real room: two people and bots, at four sizes. Invariants, each with
// its bug: every name starts at the same x (marks misalign); the label never pushes the name
// (names cut for a label); explanations never overlap a control (unreadable, untappable);
// the panel opens and closes by keyboard and returns focus (keyboard users stranded); a
// disabled control cannot fire (guests muting or ejecting). Frames go to MIRA_PANEL_EVIDENCE.
// Until the server's protocol lands, the room's side is filled in through setPlayerHooks and
// the roster's new fields are set on the local copy.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, devices } from 'playwright-core'

const url = new URL(process.env.MIRA_URL ?? 'http://127.0.0.1:5317/')
const out = resolve(process.env.MIRA_PANEL_EVIDENCE ?? 'tests/ui/artifacts/player-panel')
const only = process.env.MIRA_PANEL_SIZES?.split(',')
const card = '.world-inspector:not(.lobby-settings) .wi-card[data-section=players]'
const SIZES = [['1700x1100', 1700, 1100, false], ['1280x800', 1280, 800, false], ['844x390', 844, 390, true], ['390x844', 390, 844, true]]

/**
 * The local room server has no geography and these test browsers report no device, so the
 * roster's place and device fields (and the creator role, which needs the creator's key) are
 * set on this page's copy, again after each roster message. Everything else is the real room.
 */
async function mock(page) {
  await page.evaluate(() => {
    const people = [
      { country: 'US', region: 'California', deviceLabel: 'Mac', role: 'creator' },
      { country: 'US', region: 'Texas', deviceLabel: 'iPhone' },
    ]
    const apply = () => {
      const ids = [...miraNet.players.values()].filter(p => !p.bot).map(p => p.id).sort((a, b) => a - b)
      // A new object, as a roster message makes, so the Players card sees the change.
      ids.forEach((id, i) => {
        const p = miraNet.players.get(id)
        if (Object.entries(people[i] ?? {}).some(([k, v]) => p[k] !== v)) miraNet.players.set(id, { ...p, ...people[i] })
      })
    }
    apply(); setInterval(apply, 100)
  })
}

/** Boxes of explanations and controls inside the panel must not intersect. */
async function noOverlap(page) {
  const hits = await page.evaluate(() => {
    const panel = document.querySelector('#player-panel')
    const box = el => el.getBoundingClientRect()
    const controls = [...panel.querySelectorAll('button, input, output, label')].filter(el => el.offsetWidth).map(box)
    const texts = [...panel.querySelectorAll('.pp-why')].filter(el => el.offsetWidth)
    const out = []
    for (const t of texts) for (const c of controls) {
      const a = box(t)
      if (a.left < c.right - .5 && c.left < a.right - .5 && a.top < c.bottom - .5 && c.top < a.bottom - .5) out.push(t.textContent)
    }
    return out
  })
  assert.deepEqual(hits, [], 'an explanation overlaps a control')
}

/** Every name in the card starts at the same x, people and bots alike. */
async function namesAligned(page) {
  const xs = await page.locator(`${card} .score-row.is-rich .mark-name`).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().left * 2) / 2))
  assert.ok(xs.length >= 3, 'rows shown')
  assert.ok(xs.every(x => x === xs[0]), `name starts differ: ${xs}`)
  // The name is never cut while a label is shown.
  const cut = await page.locator(`${card} .score-row.is-rich`).evaluateAll(rows => rows.filter(row => {
    const name = row.querySelector('.mark-name'), meta = row.querySelector('.score-meta')
    return meta.textContent && name.scrollWidth > name.clientWidth + 1
  }).length)
  assert.equal(cut, 0, 'a name was cut while its row shows a label')
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const [size, width, height, touch] of SIZES.filter(([s]) => !only || only.includes(s))) {
    const opts = { ...(touch ? devices['iPhone 14'] : {}), viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, reducedMotion: 'reduce' }
    const room = `player-panel-${Date.now()}-${size}`
    const errors = []
    const open = async name => {
      const context = await browser.newContext(opts)
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      const link = new URL(url)
      link.search = new URLSearchParams({ room, name, autoplay: '1', webgl: '1', gfx: '2', world: 'alpine.1' })
      await page.goto(link.href)
      await page.waitForFunction(() => window.miraNet?.connected && mira.shell.playing && !mira.shell.dropping, null, { timeout: 180000 })
      return { page, context }
    }
    const hostTab = await open('Aubrey'), guestTab = await open('Zepy')
    const host = hostTab.page, guest = guestTab.page
    try {
      await host.waitForFunction(() => miraNet.isHost && [...miraNet.players.values()].filter(p => !p.bot).length === 2, null, { timeout: 60000 })
      await host.evaluate(() => { mira.params.set('bots.keepCount', true); mira.params.set('bots.count', 2) })
      await host.waitForFunction(() => [...miraNet.players.values()].filter(p => p.bot).length === 2, null, { timeout: 60000 })
      await guest.waitForFunction(() => [...miraNet.players.values()].filter(p => p.bot).length === 2, null, { timeout: 60000 })
      await mock(host); await mock(guest)
      for (const page of [host, guest]) {
        await page.evaluate(() => { mira.shell.showCard('players') })
        await page.locator(`${card}.is-open .score-row.is-rich`).first().waitFor()
        await page.waitForTimeout(300)
        await namesAligned(page)
      }
      const guestId = await guest.evaluate(() => miraNet.id), hostId = await host.evaluate(() => miraNet.id)
      const row = (page, id) => page.locator(`${card} .score-row[data-player-id="${id}"] > button.score-name`)
      await host.screenshot({ path: resolve(out, `${size}-rows.png`) })

      // Host opens the guest's panel: the tooltip on desktop (hover), the sheet on touch.
      if (!touch) {
        await row(host, guestId).hover()
        await host.locator('#player-panel:not([hidden])').waitFor({ timeout: 2000 })
        assert.equal(await host.locator('#player-panel').evaluate(el => el.classList.contains('is-pinned')), false, 'hover opens unpinned')
        await host.screenshot({ path: resolve(out, `${size}-host-tooltip.png`) })
        await row(host, guestId).click()
        assert.equal(await host.locator('#player-panel').evaluate(el => el.classList.contains('is-pinned')), true, 'a click pins it')
      } else {
        await row(host, guestId).tap()
        await host.locator('#player-panel:not([hidden])').waitFor({ timeout: 2000 })
      }
      assert.equal(await row(host, guestId).getAttribute('aria-expanded'), 'true')
      await noOverlap(host)
      await host.screenshot({ path: resolve(out, `${size}-host-panel.png`) })

      // Mute for me toggles this screen's mute; the host may mute for everyone.
      await host.locator('#player-panel .pp-toggle[data-mute=me]').click()
      await host.waitForFunction(id => miraNet.chat.muted.has(id), guestId)
      await host.locator('#player-panel .pp-toggle[data-mute=all]').click()
      await host.waitForFunction(id => miraNet.players.get(id)?.muted === true, guestId)
      await guest.waitForFunction(id => miraNet.players.get(id)?.muted === true, guestId)
      await host.screenshot({ path: resolve(out, `${size}-host-muted.png`) })

      // Eject: the dialog, focus on Cancel, End jumps to Permanently, Escape cancels.
      await host.locator('#player-panel .pp-eject-go').click()
      await host.locator('.eject-confirm:not([hidden])').waitFor()
      assert.equal(await host.evaluate(() => document.activeElement?.classList.contains('eject-cancel')), true, 'focus starts on Cancel')
      // The dialog is on top of everything, the panel included.
      assert.equal(await host.locator('.eject-confirm-card').evaluate(card => {
        const r = card.getBoundingClientRect()
        return [[.5, .5], [.1, .2], [.9, .2], [.1, .9], [.9, .9]].every(([x, y]) => card.contains(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)))
      }), true, 'the eject dialog is covered')
      await host.screenshot({ path: resolve(out, `${size}-eject-none.png`) })
      await host.locator('.banish-slider').focus(); await host.keyboard.press('End')
      assert.equal(await host.locator('.banish-slider').getAttribute('aria-valuetext'), 'Permanently')
      await host.screenshot({ path: resolve(out, `${size}-eject-permanent.png`) })
      await host.keyboard.press('Escape')
      assert.equal(await host.locator('.eject-confirm').isHidden(), true)
      assert.equal(await host.evaluate(id => miraNet.players.has(id), guestId), true, 'Escape ejected')

      // Keyboard: close, then Enter on the row opens pinned and Escape returns focus to it.
      await host.keyboard.press('Escape')
      await host.locator('#player-panel').waitFor({ state: 'hidden' })
      await row(host, guestId).focus(); await host.keyboard.press('Enter')
      await host.locator('#player-panel:not([hidden])').waitFor()
      await host.keyboard.press('Escape')
      await host.locator('#player-panel').waitFor({ state: 'hidden' })
      assert.equal(await host.evaluate(id => document.activeElement?.dataset.id === String(id), guestId), true, 'focus returns to the row')

      // A bot's panel, host view.
      const botId = await host.evaluate(() => [...miraNet.players.values()].find(p => p.bot).id)
      await row(host, botId).click()
      await host.locator('#player-panel .pp-trait').first().waitFor()
      await noOverlap(host)
      await host.screenshot({ path: resolve(out, `${size}-host-bot.png`) })
      await host.keyboard.press('Escape')

      // The guest: the host's panel shows disabled moderation that cannot fire.
      await (touch ? row(guest, hostId).tap() : row(guest, hostId).click())
      await guest.locator('#player-panel:not([hidden])').waitFor()
      await noOverlap(guest)
      const forAll = guest.locator('#player-panel .pp-toggle[data-mute=all]')
      assert.equal(await forAll.isDisabled(), true)
      const sent = []
      await guest.exposeFunction('panelSent', type => sent.push(type))
      await guest.evaluate(() => { const send = miraNet.send.bind(miraNet); miraNet.send = msg => { if (['mute', 'eject', 'bot-traits'].includes(msg.type)) window.panelSent(msg.type); return send(msg) } })
      await forAll.dispatchEvent('click')
      await guest.locator('#player-panel .pp-eject-go').dispatchEvent('click')
      await guest.waitForTimeout(300)
      assert.deepEqual(sent, [], 'a disabled control fired')
      assert.equal(await guest.locator('.eject-confirm').isHidden(), true)
      await guest.screenshot({ path: resolve(out, `${size}-guest-panel.png`) })
      // Your own panel shows what others see, without moderation.
      await guest.keyboard.press('Escape')
      await (touch ? row(guest, guestId).tap() : row(guest, guestId).click())
      assert.equal(await guest.locator('#player-panel .pp-eject-go').count(), 0, 'own panel has no Eject')
      await guest.screenshot({ path: resolve(out, `${size}-own-panel.png`) })
      assert.deepEqual(errors, [])
      console.log(`${size}: ok`)
    } finally {
      await hostTab.context.close(); await guestTab.context.close()
    }
  }
} finally {
  await browser.close()
}
