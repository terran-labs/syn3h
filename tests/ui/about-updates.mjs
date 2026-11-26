// A newer release must open to its own readable notes. Older history stays reachable,
// and a player on a deliberately pinned version can choose the latest version.
// tools/browser-checks.mjs supplies MIRA_RELEASE_VERSION and the matching dev server.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium, devices, webkit } from 'playwright-core'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('about-updates')
const versions = readFileSync('release-notes/history.tsv', 'utf8').split('\n')
  .map(line => line.split('\t'))
  .filter(([version, , , , channel]) => /^v\d/.test(version) && channel?.trim() === 'production')
  .map(([version]) => version.slice(1))
const latest = versions.at(-1), running = process.env.MIRA_RELEASE_VERSION ?? versions.at(-2)
const oldest = versions[0]
const release = (version, digest) => ({ version, summary: digest, digest, channel: 'production' })

for (const pinned of [false, true]) {
  const browser = pinned ? await webkit.launch() : await chromium.launch({ channel: 'chrome' })
  try {
    const page = await browser.newPage(pinned ? devices['iPhone 14'] : {})
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/v/versions.json', r => r.fulfill({ json: { versions: [running, latest] } }))
    await page.route('**/releases.json', r => r.fulfill({ json: {
      releases: [release(latest, 'Notes for the advertised release.')], older: '/releases-older.json'
    } }))
    await page.route('**/releases-older.json', r => r.fulfill({ json: {
      releases: [release(oldest, 'Notes for the archived release.')]
    } }))
    const url = new URL(base)
    url.searchParams.set('room', `updates-${Date.now()}`)
    if (pinned) url.searchParams.set('v', running)
    await page.goto(url.href)
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })

    const banner = page.locator('.update-banner')
    const sheet = page.locator('dialog.lobby-sheet-updates[open]')
    if (pinned) {
      await page.locator('[data-lobby-version]').tap()
      const latestLink = sheet.locator('.updates-pinned a')
      await latestLink.waitFor({ state: 'visible' })
      assert.equal(new URL(await latestLink.getAttribute('href'), url).href, new URL('/', base).href)
      assert.ok(await banner.isHidden(), 'pinned players choose when to update')
    } else {
      await banner.waitFor({ state: 'visible' })
      assert.ok((await banner.innerText()).includes(latest), 'the banner identifies the newer release')
      await banner.locator('.update-whatsnew').click()
      const notes = version => sheet.locator(`.update-release[data-version="${version}"] .update-notes`)
      await notes(latest).getByText('Notes for the advertised release.', { exact: true }).waitFor()
      await sheet.locator('.updates-more-button').click()
      const olderDay = sheet.locator('.update-day').nth(1)
      const dayToggle = olderDay.locator('.update-day-toggle')
      if (await dayToggle.getAttribute('aria-expanded') !== 'true') await dayToggle.click()
      const releaseToggle = olderDay.locator(`.update-release[data-version="${oldest}"] .update-release-toggle`)
      if (await releaseToggle.getAttribute('aria-expanded') !== 'true') await releaseToggle.click()
      await notes(oldest).getByText('Notes for the archived release.', { exact: true }).waitFor()
      await sheet.locator('.lobby-sheet-close').click()
      await banner.locator('.update-dismiss').click()
      await banner.waitFor({ state: 'hidden' })
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}
