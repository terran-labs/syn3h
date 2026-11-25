// Run from the checkout with the shared heavy-job wrapper. The browser intercepts external navigations.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const out = resolve(process.argv[2] ?? 'tests/ui/artifacts/lobby-community-links')
const invite = 'https://discord.gg/dxTFZRM'
const links = [
  ['Join the Mira community on Discord', invite],
  ['Mira on GitHub', 'https://github.com/terran-labs/syn3h'],
  ['Terran Labs', 'https://terranlabs.com'],
]
const profiles = [[320, 568], [390, 844], [844, 390], [1280, 800], [1440, 900]]
const requested = process.argv.slice(3)
const selected = profiles.filter(([width, height]) => !requested.length || requested.includes(`${width}x${height}`))
assert.ok(selected.length, 'at least one requested viewport must match')
const report = []
const failures = []
await mkdir(out, { recursive: true })
process.env.MIRA_NO_ROOM_SERVER = '1'
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.resolvedUrls.local[0]
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  for (const [width, height] of selected) {
    const id = `${width}x${height}`
    const touch = width < 900
    const context = await browser.newContext({
      viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce',
    })
    const destinations = url => ['discord.gg', 'github.com', 'terranlabs.com'].includes(url.hostname)
    const requests = []
    await context.route(destinations, async route => {
      requests.push(route.request().url())
      await route.fulfill({ body: 'Intercepted link destination' })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(7000)
    const measurements = { id }
    try {
      await page.goto(address + '?webgl=1&tap=0&intro=0', { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.locator('html[data-boot="done"]').waitFor({ state: 'attached', timeout: 90000 })
      const version = page.locator('[data-lobby-version]')
      await version.waitFor({ timeout: 45000 })
      const nav = page.getByRole('navigation', { name: 'Mira community' })
      const anchors = nav.getByRole('link')
      assert.deepEqual(await anchors.evaluateAll(elements => elements.map(link => [
        link.getAttribute('aria-label'), link.getAttribute('href'), link.target, link.rel,
      ])), links.map(entry => [...entry, '_blank', 'noopener noreferrer']))
      assert.equal(await nav.getByRole('link', { name: 'Terran Labs' }).textContent(), 'terranlabs.com')
      assert.equal(await nav.locator('svg > path').count(), 2)
      await page.screenshot({ path: resolve(out, id + '.png') })
      Object.assign(measurements, await page.evaluate(() => {
        const rect = el => el.getBoundingClientRect().toJSON()
        const dock = document.querySelector('.lobby-version-dock')
        return {
          dock: rect(dock),
          version: rect(dock.querySelector('button')),
          gear: rect(document.querySelector('.lobby-gear-dock')),
          targets: [...dock.querySelectorAll('a')].map(link => {
            const r = rect(link)
            const center = [r.x + r.width / 2, r.y + r.height / 2]
            const inset = [[r.left + 3, center[1]], [r.right - 3, center[1]],
              [center[0], r.top + 3], [center[0], r.bottom - 3]]
            return { rect: r, hits: [center, ...inset].map(([x, y]) => link.contains(document.elementFromPoint(x, y))) }
          }),
        }
      }))
      console.log(JSON.stringify(measurements))
      assert.deepEqual(requests, [], 'community destinations receive no requests before activation')
      await version.focus()
      for (let index = 0; index < links.length; index++) {
        await page.keyboard.press('Tab')
        assert.ok(await anchors.nth(index).evaluate(link => link === document.activeElement), 'links are in keyboard order')
      }
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')])
      await popup.waitForLoadState()
      assert.equal(new URL(popup.url()).origin, 'https://terranlabs.com')
      assert.equal(await popup.evaluate(() => window.opener), null)
      await popup.close()
      assert.equal(requests.length, 1)
      if (touch) {
        for (const [name, url] of links.slice(0, 2)) {
          const [tab] = await Promise.all([page.waitForEvent('popup'), nav.getByRole('link', { name }).tap()])
          await tab.waitForLoadState()
          assert.equal(tab.url(), url)
          await tab.close()
        }
      }
      await version.click()
      await page.locator('.lobby-sheet-updates[open]').waitFor()
      assert.equal(await nav.isVisible(), false, 'the existing Updates sheet hides the whole dock')
      await page.keyboard.press('Escape')
      await nav.waitFor()
      assert.ok(await version.evaluate(button => button === document.activeElement), 'Updates returns focus to the version button')
      await page.locator('.lobby-about').click()
      await page.locator('.lobby-sheet-about[open]').waitFor()
      assert.equal(await version.isVisible() || await nav.isVisible(), false, 'Welcome hides the entire version dock')
      if (width === 390) await page.screenshot({ path: resolve(out, id + '-welcome.png') })
      await page.keyboard.press('Escape')
      await version.waitFor()

      await page.locator('.lobby-gear').click()
      await page.locator('.lobby-settings').waitFor()
      assert.equal(await version.isVisible() || await nav.isVisible(), false, 'Settings hides the entire version dock')
      await page.keyboard.press('Escape')
      await version.waitFor()

      const { dock, gear, targets } = measurements
      assert.ok(dock.left >= 0 && dock.right <= width && dock.top >= 0 && dock.bottom <= height)
      assert.ok(dock.right <= gear.left || dock.left >= gear.right || dock.bottom <= gear.top || dock.top >= gear.bottom,
        'the community dock and Settings/Welcome controls have independent space')
      assert.ok(targets.every(({ rect, hits }) => rect.width >= 44 && rect.height >= 44 && hits.every(Boolean)),
        'each community link offers a full touch target')
    } catch (error) {
      failures.push(`${id}: ${error.message}`)
    } finally {
      report.push(measurements)
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
  await writeFile(resolve(out, 'measurements.json'), JSON.stringify({ report, failures }, null, 2))
}
assert.deepEqual(failures, [])
