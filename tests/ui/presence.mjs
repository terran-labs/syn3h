import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  let mode = 'populated', calls = 0
  await page.route('**/presence', route => {
    calls++
    if (mode === 'error') return route.fulfill({ status: 503, body: 'Unavailable' })
    const now = Date.now(), byRecipe = mode === 'empty' ? [] : [{ recipeId: 'alpine', players: 3, rooms: 2, oldestReportAt: now - (mode === 'stale' ? 90001 : 0) }]
    return route.fulfill({ json: { version: 1, generatedAt: now, ttlMs: 90000, byRecipe } })
  })
  await page.goto(process.env.SYN3H_URL ?? 'http://127.0.0.1:5193/')
  const label = page.locator('.galaxy-label[data-world="alpine"] .galaxy-population')
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population')?.textContent === '3 connected across 2 rooms', null, { timeout: 120000 })
  assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.population.get('alpine').players), 3)
  assert.equal(await page.locator('[data-world="custom"] .galaxy-population').count(), 0)
  const change = async value => {
    mode = value
    await page.evaluate(() => { const g = window.syn3h.shell.galaxy; g.presence.setActive(false); g.syncPresence() })
  }
  await change('stale')
  await page.waitForTimeout(150)
  assert.equal(await label.textContent(), 'Population unknown')
  await change('empty')
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population').textContent === '0 connected across 0 rooms')
  await change('error')
  await page.waitForTimeout(150)
  assert.equal(await label.textContent(), 'Population unknown')
  mode = 'populated'
  await page.evaluate(() => window.syn3h.shell.play())
  const inPlay = calls
  await page.waitForTimeout(500)
  assert.equal(calls, inPlay)
  assert.equal(await page.evaluate(() => window.syn3h.shell.galaxy.presence.active), false)
  await page.evaluate(() => window.syn3h.shell.openMenu())
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population').textContent === '3 connected across 2 rooms')
  assert.match(await page.locator('[data-world="alpine"]').getAttribute('aria-label'), /Counts span separate rooms/)
  // Population display must not route planet taps into an enumerated room.
  const room = await page.evaluate(() => window.syn3h.shell.roomInput.value)
  await page.locator('[data-world="alpine"]').dispatchEvent('click')
  await page.waitForFunction(() => window.syn3h.shell.dropping)
  assert.equal(await page.evaluate(() => window.syn3h.shell.roomInput.value), room)
  console.log('PRESENCE UI OK')
} finally { await browser.close() }
