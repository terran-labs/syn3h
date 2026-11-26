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
import sharp from 'sharp'

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

/** On desktop the panel stays below the top HUD row and above the bottom stack's notices. */
async function insideBand(page, touch) {
  if (touch) return
  const r = await page.evaluate(() => {
    const panel = document.querySelector('#player-panel').getBoundingClientRect()
    const top = document.querySelector('.world-inspector:not(.lobby-settings) .rail-command').getBoundingClientRect().bottom
    const notes = [...document.querySelectorAll('.bottom-stack > *')].map(el => el.getBoundingClientRect()).filter(b => b.height)
    const bottom = Math.min(innerHeight, ...notes.map(b => b.top))
    return { top: panel.top, bottom: panel.bottom, min: top, max: bottom }
  })
  assert.ok(r.top >= r.min && r.bottom <= r.max, `panel outside its band: ${JSON.stringify(r)}`)
}

/**
 * Legibility over the brightest, busiest backdrop (the Foreman, 25 November 2026: no world text
 * may read through the panel). A fixture goes behind the panel: white and sky-blue stripes with
 * a copy of a real vehicle nameplate over them. For each text (the section label, a hint line),
 * the backdrop behind it is captured with that text made transparent, and its brightest pixel
 * must still leave the text's colour at 4.5:1 or better.
 */
async function contrastOverBusy(page, file) {
  await page.evaluate(() => {
    const panel = document.querySelector('#player-panel'), r = panel.getBoundingClientRect()
    const fixture = document.createElement('div'); fixture.id = 'pp-fixture'
    Object.assign(fixture.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '58', pointerEvents: 'none',
      background: 'repeating-linear-gradient(90deg, #fff 0 36px, #8fc3ee 36px 70px, #ffffff 70px 90px, #3d6e3a 90px 120px)' })
    const plate = document.querySelector('.vehicle-nameplate')?.cloneNode(true) ?? Object.assign(document.createElement('div'), { textContent: 'MIBIWISE' })
    plate.hidden = false
    Object.assign(plate.style, { position: 'absolute', left: '10px', top: '90px', transform: 'none', font: '600 22px Barlow, sans-serif', color: '#fff' })
    for (let i = 0; i < 4; i++) { const p = plate.cloneNode(true); p.style.top = `${60 + i * 110}px`; fixture.append(p) }
    panel.parentElement.insertBefore(fixture, panel)
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: file })
  const lum = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b) }
  const results = []
  for (const selector of ['#player-panel .pp-traits-head .pp-line-title', '#player-panel .pp-trait .pp-why']) {
    const target = page.locator(selector).first()
    const color = await target.evaluate(el => getComputedStyle(el).color)
    const rgb = color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    await target.evaluate(el => { el.dataset.was = el.style.color; el.style.color = 'transparent' })
    const box = await target.boundingBox()
    const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) }, scale: 'css' })
    await target.evaluate(el => { el.style.color = el.dataset.was })
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let brightest = 0
    for (let i = 0; i < data.length; i += info.channels) brightest = Math.max(brightest, lum([data[i], data[i + 1], data[i + 2]]))
    const ratio = (Math.max(lum(rgb), brightest) + 0.05) / (Math.min(lum(rgb), brightest) + 0.05)
    results.push([selector, Math.round(ratio * 100) / 100])
  }
  await page.evaluate(() => document.querySelector('#pp-fixture')?.remove())
  return results
}

/**
 * The same check in every glass style the player can choose (the panel follows the cards' own
 * material). MIRA_PANEL_NO_FLOOR=1 turns the panel's temporary floor off and only reports, to
 * compare the shared card face alone.
 */
async function contrastEveryStyle(page, out, size) {
  const noFloor = process.env.MIRA_PANEL_NO_FLOOR === '1'
  if (noFloor) await page.evaluate(() => document.querySelector('#player-panel').classList.add('no-floor'))
  const report = {}
  // Style, then the budget state: full; shed (the glass lead's hook: the post chain released, so
  // Liquid falls to its CSS face, html[data-drive-glass="shed"]); low (the real lowest quality
  // level, gfx.quality 0, end to end). Frost at full budget for coverage.
  const cases = [['flat', 2, 'full'], ['flat', 2, 'low'], ['liquid', 0, 'full'], ['liquid', 0, 'shed'], ['liquid', 0, 'low'], ['frost', 1, 'full']] // Flat is the default style
  for (const [name, style, state] of cases) {
    await page.evaluate(style => mira.params.set('hud.glass', style), style)
    if (state === 'shed') {
      await page.evaluate(() => { window.__ppChain = mira.game.postChain; window.__ppChain?.glass?.release('player panel contrast'); mira.game.setPostChain(null) })
      await page.waitForFunction(() => document.documentElement.dataset.driveGlass === 'shed', null, { timeout: 30000 })
    }
    if (state === 'low') {
      await page.evaluate(() => mira.params.set('gfx.quality', 0))
      await page.waitForFunction(() => document.documentElement.dataset.gfx === '0', null, { timeout: 60000 })
      await page.waitForTimeout(1500)
    }
    await page.waitForTimeout(400)
    const shown = await page.evaluate(() => `${document.documentElement.dataset.glassMaterial}/${document.documentElement.dataset.driveGlass ?? '-'}/gfx${document.documentElement.dataset.gfx ?? '?'}`)
    const results = await contrastOverBusy(page, resolve(out, `${size}-host-bot-busy-${name}-${state}${noFloor ? '-nofloor' : ''}.png`))
    report[`${name}-${state} (${shown})`] = Object.fromEntries(results.map(([selector, ratio]) => [selector.includes('why') ? 'hint' : 'label', ratio]))
    if (!noFloor) for (const [selector, ratio] of results) assert.ok(ratio >= 4.5, `${selector} reads at ${ratio}:1 over a busy backdrop in ${name}-${state} (${shown})`)
    if (state === 'shed') {
      await page.evaluate(() => mira.game.setPostChain(window.__ppChain))
      await page.waitForFunction(() => document.documentElement.dataset.driveGlass !== 'shed', null, { timeout: 30000 }).catch(() => {})
    }
    if (state === 'low') await page.evaluate(() => mira.params.set('gfx.quality', mira.params.get('gfx.quality').def.default))
  }
  await page.evaluate(() => { mira.params.set('hud.glass', mira.params.get('hud.glass').def.default); document.querySelector('#player-panel').classList.remove('no-floor') })
  return report
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
      // On a phone the sheet stands in the sidebar's place: the card under it must not show through.
      if (touch) assert.equal(await host.evaluate(() => getComputedStyle(document.querySelector('.world-inspector:not(.lobby-settings)')).visibility), 'hidden', 'the Players card shows through the sheet')
      await noOverlap(host)
      await host.screenshot({ path: resolve(out, `${size}-host-panel.png`) })

      // Mute for me toggles this screen's mute; the host may mute for everyone.
      await host.locator('#player-panel .pp-toggle[data-mute=me]').click()
      await host.waitForFunction(id => miraNet.chat.muted.has(id), guestId)
      // A toggle that is on looks on: it is filled, unlike one that is off.
      const fills = await host.locator('#player-panel .pp-toggle').evaluateAll(bs => bs.map(b => [b.getAttribute('aria-pressed'), getComputedStyle(b).backgroundColor]))
      const on = fills.find(([p]) => p === 'true'), off = fills.find(([p]) => p === 'false')
      assert.ok(on && off && on[1] !== off[1], `a lit toggle is not filled: ${JSON.stringify(fills)}`)
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
      const danger = await host.locator('.eject-go').evaluate(b => getComputedStyle(b).backgroundColor)
      assert.match(danger, /^rgba?\((1[5-9]\d|2\d\d), \d{1,2}, \d{1,2}/, `Eject is not red: ${danger}`)
      await host.screenshot({ path: resolve(out, `${size}-eject-none.png`) })
      // Every stop, one arrow press at a time, with its words under the slider.
      await host.locator('.banish-slider').focus()
      const STOPS = [['5m', '5 minutes', 'Banished for 5 minutes.'], ['30m', '30 minutes', 'Banished for 30 minutes.'], ['24h', '24 hours', 'Banished for 24 hours.'], ['permanent', 'Permanently', 'Banished permanently.']]
      for (const [id, words, says] of STOPS) {
        await host.keyboard.press('ArrowRight')
        assert.equal(await host.locator('.banish-slider').getAttribute('aria-valuetext'), words)
        assert.equal(await host.locator('.banish-says').textContent(), says)
        if (!touch || id === 'permanent') await host.screenshot({ path: resolve(out, `${size}-eject-${id}.png`) })
      }
      await host.keyboard.press('Home')
      assert.equal(await host.locator('.banish-slider').getAttribute('aria-valuetext'), 'None')
      await host.keyboard.press('End')
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
      // Change Boldness: its reset arrow and the set's "Reset to its nature" come alive, the
      // nature notch stays on the track, and the set reset returns it.
      const bold = host.locator('#player-panel .pp-trait[data-trait=boldness]')
      const before = Number(await bold.locator('input').inputValue())
      await bold.locator('input').focus()
      for (let i = 0; i < 15; i++) await host.keyboard.press(before > 50 ? 'ArrowLeft' : 'ArrowRight')
      await bold.locator('.reset-control.is-live').waitFor({ timeout: 15000 })
      assert.match(await bold.locator('.reset-control').getAttribute('aria-label'), /^Reset Boldness to \d+$/)
      assert.equal(await host.locator('#player-panel .pp-reset-all').isDisabled(), false)
      assert.ok(await bold.locator('input').evaluate(i => i.classList.contains('has-default') && i.style.getPropertyValue('--wi-default') !== ''), 'no nature notch')
      await noOverlap(host)
      await insideBand(host, touch)
      await host.screenshot({ path: resolve(out, `${size}-host-bot.png`) })
      if (!touch) console.log(`${size} contrast over a busy backdrop${process.env.MIRA_PANEL_NO_FLOOR === '1' ? ' (floor off, report only)' : ''}:`, JSON.stringify(await contrastEveryStyle(host, out, size)))
      await host.locator('#player-panel .pp-reset-all').click(); await host.locator('#player-panel .pp-reset-all').click()
      await bold.locator('.reset-control:not(.is-live)').waitFor({ timeout: 15000 })
      assert.equal(Number(await bold.locator('input').inputValue()), before, 'the set reset did not return Boldness to its nature')
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
      // The host leaves: the guest becomes host and is told so in the bottom stack.
      await guest.keyboard.press('Escape')
      await hostTab.context.close()
      await guest.waitForFunction(() => miraNet.isHost, null, { timeout: 60000 })
      const notice = guest.locator('.bottom-stack .room-notice:not([hidden])')
      await notice.waitFor({ timeout: 30000 })
      assert.match(await notice.textContent(), /^You are now the host of this world\./)
      await guest.screenshot({ path: resolve(out, `${size}-new-host.png`) })
      assert.deepEqual(errors, [])
      console.log(`${size}: ok`)
    } finally {
      await hostTab.context.close().catch(() => {}); await guestTab.context.close()
    }
  }
} finally {
  await browser.close()
}
