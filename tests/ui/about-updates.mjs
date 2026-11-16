/**
 * Updates in About and the update banner.
 *
 * Start the dev server as release 26.11.1601 so the page knows its own version, then
 * this check serves a /v/versions.json naming 26.11.1602 as live:
 *
 *   SYN3H_RELEASE_VERSION=26.11.1601 npx vite --port 5187
 *   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-updates.mjs
 */
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/about-updates'
await mkdir(out, { recursive: true })
const RUNNING = '26.11.1601', LIVE = '26.11.1602'
/** The banner must cover none of the lobby's own controls or its wordmark. */
const overlaps = page => page.evaluate(() => {
  const banner = document.querySelector('.update-banner').getBoundingClientRect()
  const hit = r => r.width && r.height && r.left < banner.right && banner.left < r.right && r.top < banner.bottom && banner.top < r.bottom
  return [...document.querySelectorAll('.shell-logo, .galaxy-hint, .galaxy-links button, #syn3h-build-notice')]
    .filter(el => getComputedStyle(el).display !== 'none' && hit(el.getBoundingClientRect())).map(el => el.className.baseVal ?? el.className ?? el.id)
})
const live = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ versions: ['26.11.1600', RUNNING, LIVE] }) })

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
    assert.match(await banner.locator('strong').innerText(), new RegExp(`Update available: v${LIVE.replaceAll('.', '\\.')}`))
    await page.waitForFunction(() => document.querySelector('.update-banner-summary')?.textContent)
    assert.equal(await banner.getByRole('button', { name: 'Reload' }).count(), 1)
    assert.equal(await banner.getByRole('button', { name: 'What’s new' }).count(), 1)
    for (const button of await banner.locator('button').all()) assert.ok((await button.boundingBox()).height >= 44, 'banner buttons are full tap targets')
    assert.deepEqual(await overlaps(page), [], `${mode}: the banner covers nothing`)
    await page.screenshot({ path: `${out}/${mode}-banner.png` })
    await page.waitForTimeout(3000)
    assert.equal(loads, 1, 'nothing reloads by itself')

    // What's new opens About at Updates: newest first, the newest open with its notes.
    await banner.getByRole('button', { name: 'What’s new' }).click()
    const about = page.locator('[data-panel="about"]')
    await about.locator('.update-release').first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await about.getByRole('tab', { name: 'Updates' }).getAttribute('aria-selected'), 'true')
    const first = about.locator('.update-release').first()
    assert.equal(await first.getAttribute('data-version'), LIVE)
    assert.ok(await first.evaluate(d => d.open), 'the newest release starts open')
    assert.equal(await first.locator('.update-badge.is-new').innerText(), 'NEW')
    assert.ok(await first.locator('.update-notes h4').count() > 0, 'its notes are rendered with headings')
    assert.equal(await first.locator('.update-notes script, .update-notes [onerror]').count(), 0)
    const links = await first.locator('.update-notes a').evaluateAll(as => as.map(a => [a.target, a.rel, a.protocol]))
    for (const [target, rel, protocol] of links) { assert.equal(target, '_blank'); assert.match(rel, /noopener/); assert.match(protocol, /^https?:$/) }
    const mine = about.locator(`.update-release[data-version="${RUNNING}"]`)
    assert.match(await mine.locator('.update-badge').innerText(), /playing this/i)
    await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.busy === 'false' && !document.querySelector('.lobby-panels').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
    await page.screenshot({ path: `${out}/${mode}-updates.png` })
    if (!touch) {
      await first.locator('summary').click() // close the newest
      await mine.locator('summary').click()
      await mine.locator('.update-notes p').first().waitFor()
      await mine.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/desktop-release-expanded.png` })
    }
    assert.equal(loads, 1, 'still the first load')

    assert.ok(await banner.isHidden(), 'an open lobby panel hides the banner')
    // Back on the galaxy it returns; dismissed, it stays away for the session.
    await about.locator('button.panel-back').click()
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
    const note = pinned.locator('[data-panel="about"] .updates-pinned')
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
    assert.deepEqual(await overlaps(dev), [])
    console.log('dev rebuild ok')
  } finally { await browser.close() }
}
