// A player on an older release is told a newer one is live, and can read its notes and reload.
// Bugs caught: the lobby banner or the in-play chip never appearing for a newer live version;
// What's new not opening the notes, or the newest release missing or not first; the page
// reloading by itself; Dismiss not sticking; a pinned (?v=) page prompting; release notes
// rendering markup or unsafe links. Where the notice sits and how big it is is not pinned.
//
// The watcher runs only on a release build (feed.ts, watchForUpdates), so start the dev server
// as the release before the newest production one (the second-last production row of
// release-notes/history.tsv); this check then serves a /v/versions.json naming the newest:
//
//   SYN3H_RELEASE_VERSION=<second-newest, e.g. 26.11.2200> npx vite --port 5187
//   SYN3H_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-updates.mjs
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
/** The feed lists the real production history, newest first: its top entry grows with every release. */
const PRODUCTION = readFileSync('release-notes/history.tsv', 'utf8').split('\n').map((l) => l.split('\t'))
  .filter(([v, , , , channel]) => /^v\d/.test(v ?? '') && channel?.trim() === 'production').map(([v]) => v.slice(1))
const NEWEST = PRODUCTION.at(-1)
const RUNNING = process.env.SYN3H_RELEASE_VERSION ?? PRODUCTION.at(-2), LIVE = NEWEST
const live = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ versions: [PRODUCTION.at(-3), RUNNING, LIVE] }) })

for (const mode of ['desktop', 'phone']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const context = await browser.newContext(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    await context.route('**/v/versions.json', live)
    const page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    let loads = 0; page.on('load', () => loads++)
    await page.goto(`${process.env.SYN3H_URL}?room=updates-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.shell, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // Without a release version the watcher is off and nothing below can happen: say so.
    const build = await page.locator('.lobby-version').textContent()
    assert.ok(/\d+\.\d+\.\d+/.test(build ?? ''), `the dev server is not a release build (shows "${build}"): start it with SYN3H_RELEASE_VERSION=${RUNNING}`)

    // The lobby banner: the newer version, Reload and What's new.
    const banner = page.locator('.update-banner')
    await banner.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await banner.locator('strong').textContent(), `Update available · v${LIVE}`)
    assert.equal(await banner.getByRole('button', { name: 'Reload' }).count(), 1)
    assert.equal(await banner.getByRole('button', { name: 'What’s new' }).count(), 1)
    await page.waitForTimeout(3000)
    assert.equal(loads, 1, 'nothing reloads by itself')

    // The version in the lower left (which opens Updates) carries a quiet mark while a newer version is out.
    assert.equal(await page.locator('.lobby-version.has-update').count(), 1, `${mode}: the version is marked`)
    // What's new opens Updates: the newest release first, with its notes.
    await banner.getByRole('button', { name: 'What’s new' }).click()
    const about = page.locator('.lobby-sheet-updates')
    await about.locator('.update-release').first().waitFor({ state: 'visible', timeout: 15000 })
    const first = about.locator('.update-release').first()
    assert.equal(await first.getAttribute('data-version'), NEWEST)
    assert.ok(await first.locator('.update-notes li').count() >= 2, 'the player digest shows as bullets')
    assert.equal(await first.locator('.update-full').getAttribute('href'), `https://github.com/terran-labs/syn3h/releases/tag/v${NEWEST}`)
    assert.equal(await first.locator('.update-notes script, .update-notes [onerror]').count(), 0)
    const links = await first.locator('.update-notes a').evaluateAll(as => as.map(a => [a.target, a.rel, a.protocol]))
    for (const [target, rel, protocol] of links) { assert.equal(target, '_blank'); assert.match(rel, /noopener/); assert.match(protocol, /^https?:$/) }
    assert.equal(loads, 1, 'still the first load')

    // Closed, the banner is back; dismissed, it goes.
    await about.locator('.lobby-sheet-close').click()
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
    console.log('dev rebuild ok')
  } finally { await browser.close() }
}
