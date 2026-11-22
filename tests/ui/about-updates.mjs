/**
 * The lobby's Updates sheet, the update banner and the mark on the Updates icon.
 *
 * Start the dev server as the release before the newest production one (the second-last
 * production row of release-notes/history.tsv) so the page knows its own version, then this
 * check serves a /v/versions.json naming the newest as live. Both are then in the dev feed,
 * which lists only recent releases (fixed versions fell out of it and broke this check):
 *
 *   SYN3H_RELEASE_VERSION=<second-newest, e.g. 26.11.1706> npx vite --port 5187
 *   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-updates.mjs
 */
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
const out = 'tests/ui/artifacts/about-updates'
await mkdir(out, { recursive: true })
/** The feed lists the real production history, newest first: its top entry grows with every release. */
const PRODUCTION = readFileSync('release-notes/history.tsv', 'utf8').split('\n').map((l) => l.split('\t'))
  .filter(([v, , , , channel]) => /^v\d/.test(v ?? '') && channel?.trim() === 'production').map(([v]) => v.slice(1))
const NEWEST = PRODUCTION.at(-1)
const RUNNING = process.env.SYN3H_RELEASE_VERSION ?? PRODUCTION.at(-2), LIVE = NEWEST
/** What the banner covers: the wordmark in the scene, the hint, lobby buttons, settings gear, any planet label or planet. */
const overlaps = page => page.evaluate(() => {
  const banner = document.querySelector('.update-banner').getBoundingClientRect()
  const hit = r => r.width && r.height && r.left < banner.right && banner.left < r.right && r.top < banner.bottom && banner.top < r.bottom
  const shown = el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
  const found = [...document.querySelectorAll('.lobby-links button, .lobby-gear-dock, .galaxy-labels > *, #syn3h-build-notice')]
    .filter(el => shown(el) && hit(el.getBoundingClientRect())).map(el => el.textContent.trim() || el.className.baseVal || el.className)
  // The wordmark stands in the scene now (src/ui/brand/wordmarkScene.ts): its box on screen.
  const mark = syn3h.shell.galaxy?.wordmarkScreenBox?.(), shell = document.querySelector('.galaxy-ui').getBoundingClientRect()
  if (mark && hit({ width: mark.width, height: mark.height, left: shell.left + mark.x, right: shell.left + mark.x + mark.width, top: shell.top + mark.y, bottom: shell.top + mark.y + mark.height })) found.push('wordmark')
  // Planets: the galaxy's own screen circles, in the overlay's coordinates.
  const host = document.querySelector('.galaxy-ui').getBoundingClientRect()
  for (const p of syn3h.shell.galaxy?.screen ?? []) {
    if (!p.visible) continue
    const x = host.left + p.x, y = host.top + p.y, nx = Math.max(banner.left, Math.min(x, banner.right)), ny = Math.max(banner.top, Math.min(y, banner.bottom))
    if (Math.hypot(x - nx, y - ny) < p.radius) found.push(`planet ${p.id}`)
  }
  return found
})
const live = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ versions: [PRODUCTION.at(-3), RUNNING, LIVE] }) })

for (const mode of ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const context = await browser.newContext(touch ? devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    await context.route('**/v/versions.json', live)
    const page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    let loads = 0; page.on('load', () => loads++)
    await page.goto(`${process.env.SYN3H_URL}?room=updates-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })

    // The lobby banner: the newer version, its summary, Reload and What's new.
    const banner = page.locator('.update-banner')
    await banner.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await banner.locator('strong').textContent(), `Update available · v${LIVE}`)
    if (mode === 'desktop') await page.waitForFunction(() => document.querySelector('.update-banner-summary')?.textContent)
    assert.ok((await banner.boundingBox()).height <= 50, `${mode}: the banner is one slim row`)
    await page.waitForTimeout(1500) // the galaxy eases down to leave the banner its band
    // The banner sits at the top centre of the screen.
    const place = await banner.boundingBox(), width = page.viewportSize().width
    assert.ok(place.y < 60 && Math.abs(place.x + place.width / 2 - width / 2) < 2, `${mode}: the banner is at the top centre (${JSON.stringify(place)})`)
    assert.equal(await banner.getByRole('button', { name: 'Reload' }).count(), 1)
    assert.equal(await banner.getByRole('button', { name: 'What’s new' }).count(), 1)
    for (const button of await banner.locator('button').all()) assert.ok((await button.boundingBox()).height >= 44, 'banner buttons are full tap targets')
    assert.deepEqual(await overlaps(page), [], `${mode}: the banner covers nothing`)
    await page.screenshot({ path: `${out}/${mode}-banner.png` })
    await page.waitForTimeout(3000)
    assert.equal(loads, 1, 'nothing reloads by itself')

    // The version in the lower left (which opens Updates) carries a quiet mark while a newer version is out.
    assert.equal(await page.locator('.lobby-version.has-update').count(), 1, `${mode}: the version is marked`)
    // What's new opens the Updates sheet: newest first, the newest open with its notes, no tabs.
    await banner.getByRole('button', { name: 'What’s new' }).click()
    const about = page.locator('.lobby-sheet-updates')
    await about.locator('.update-release').first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await about.getByRole('tab').count(), 0, 'the Updates sheet has no tabs')
    const first = about.locator('.update-release').first()
    assert.equal(await first.getAttribute('data-version'), NEWEST)
    assert.ok(await first.evaluate(d => d.open), 'the newest release starts open')
    assert.equal(await first.locator('.update-badge.is-new').innerText(), 'NEW')
    assert.ok(await first.locator('.update-notes li').count() >= 2, 'the player digest shows as bullets')
    assert.equal(await first.locator('.update-full').getAttribute('href'), `https://github.com/terran-labs/syn3h/releases/tag/v${NEWEST}`)
    assert.equal(await first.locator('.update-notes script, .update-notes [onerror]').count(), 0)
    const links = await first.locator('.update-notes a').evaluateAll(as => as.map(a => [a.target, a.rel, a.protocol]))
    for (const [target, rel, protocol] of links) { assert.equal(target, '_blank'); assert.match(rel, /noopener/); assert.match(protocol, /^https?:$/) }
    const mine = about.locator(`.update-release[data-version="${RUNNING}"]`)
    assert.match(await mine.locator('.update-badge').innerText(), /playing this/i)
    // The panel's own motion (the buttons beside it keep their slow gear turn).
    await page.waitForFunction(() => !document.querySelector('.lobby-sheet-updates .lobby-sheet-panel').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
    if (mode === 'landscape') {
      const sheet = await about.locator('.lobby-sheet-panel').boundingBox()
      // It stands under the name, which keeps it at least half the screen tall (LobbySheet.frame).
      assert.ok(sheet.height >= page.viewportSize().height * 0.5 - 1, `landscape: Updates keeps at least half the screen (${sheet.height}px)`)
    }
    await page.screenshot({ path: `${out}/${mode}-updates.png` })
    if (!touch) {
      await first.locator('summary').click() // close the newest
      await mine.locator('summary').click()
      await mine.locator('.update-notes li').first().waitFor()
      await mine.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/desktop-release-expanded.png` })
    }
    assert.equal(loads, 1, 'still the first load')

    assert.ok(await banner.isHidden(), 'an open sheet hides the banner')
    // Closed with its X, the galaxy and the banner return; dismissed, it stays away for the session.
    await about.getByRole('button', { name: 'Close Updates' }).click()
    await about.waitFor({ state: 'hidden' })
    await banner.waitFor({ state: 'visible' })
    await banner.getByRole('button', { name: 'Dismiss for now' }).click()
    assert.ok(await banner.isHidden())
    assert.deepEqual(errors, [])
    await context.close()
    console.log(mode, 'lobby ok')
  } finally { await browser.close() }
}

// In play: the guide shows the same Updates, and the notice is a sidebar chip, not a banner.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.route('**/v/versions.json', live)
    const page = await context.newPage()
    await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=updates-play-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const chip = page.locator('.rail-update')
    await chip.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok(await page.locator('.update-banner').isHidden(), 'no banner over the world')
    await chip.click()
    const guide = page.locator('.in-play-about')
    await guide.locator('.update-release').first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await guide.getByRole('tab', { name: 'Updates' }).getAttribute('aria-selected'), 'true')
    await page.screenshot({ path: `${out}/in-play-updates.png` })
    await page.keyboard.press('Escape')
    await guide.waitFor({ state: 'hidden' })
    console.log('in play ok')

    // A pinned page never prompts, and Updates says it is pinned and links to the latest.
    const pinned = await context.newPage()
    await pinned.goto(`${process.env.SYN3H_URL}?v=${RUNNING}&room=updates-pinned-${Date.now()}`)
    await pinned.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await pinned.waitForTimeout(6000)
    assert.ok(await pinned.locator('.update-banner').isHidden(), 'no banner on a pinned page')
    await pinned.evaluate(() => syn3h.shell.showUpdates())
    const note = pinned.locator('.lobby-sheet-updates .updates-pinned')
    await note.waitFor({ timeout: 15000 })
    assert.match(await note.innerText(), new RegExp(`pinned version v${RUNNING.replaceAll('.', '\\.')}`))
    assert.equal(await note.locator('a').getAttribute('href'), '/')
    console.log('pinned ok')

    // The dev server's rebuild notice: in the lobby the banner replaces its pill.
    const dev = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await dev.goto(`${process.env.SYN3H_URL}?room=updates-dev-${Date.now()}`)
    await dev.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await dev.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await dev.evaluate(() => window.dispatchEvent(new CustomEvent('syn3h:new-build')))
    await dev.locator('.update-banner').waitFor({ state: 'visible' })
    assert.equal(await dev.locator('.update-banner strong').innerText(), 'New build available')
    assert.ok(await dev.locator('#syn3h-build-notice').isHidden(), 'the old pill does not show in the lobby')
    await dev.waitForTimeout(1500) // the galaxy eases down to leave the banner its band
    assert.deepEqual(await overlaps(dev), [])
    console.log('dev rebuild ok')
  } finally { await browser.close() }
}
