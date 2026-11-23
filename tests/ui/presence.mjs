import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => console.error('PAGE ERROR', error.message))
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.log(message.type(), message.text()) })
  let mode = 'populated', calls = 0
  await page.route('**/presence', route => {
    calls++; console.log('presence request', mode)
    if (mode === 'error') return route.fulfill({ status: 503, body: 'Unavailable' })
    const now = Date.now(), byRecipe = mode === 'empty' ? [] : [{ recipeId: 'alpine', players: 3, rooms: 2, oldestReportAt: now - (mode === 'stale' ? 90001 : 0) }]
    return route.fulfill({ json: { version: 1, generatedAt: now, ttlMs: 90000, byRecipe } })
  })
  await page.goto(process.env.MIRA_URL ?? 'http://127.0.0.1:5193/')
  console.log('loaded', await page.evaluate(() => ({ boot: document.documentElement.dataset.boot, shell: !!window.mira?.shell, labels: document.querySelectorAll('.galaxy-label').length })))
  const label = page.locator('.galaxy-label[data-world="alpine"] .galaxy-population')
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population')?.textContent === '3 online', null, { timeout: 120000 }).catch(async error => { console.log('state', await page.evaluate(() => ({ boot: document.documentElement.dataset.boot, fatal: document.querySelector('#fatal')?.textContent, labels: document.querySelectorAll('.galaxy-label').length, hidden: document.hidden, galaxy: window.mira?.shell?.galaxy ? { active: window.mira.shell.galaxy.active, feed: window.mira.shell.galaxy.presence.active, menu: window.mira.shell.menuOpen, attract: window.mira.shell.attracting } : null }))); throw error })
  assert.equal(await page.evaluate(() => window.mira.shell.galaxy.population.get('alpine').players), 3)
  assert.equal(await page.locator('[data-world="custom"] .galaxy-population').count(), 0)
  const change = async value => {
    mode = value
    await page.evaluate(() => { const g = window.mira.shell.galaxy; g.presence.setActive(false); g.syncPresence() })
  }
  await change('stale')
  await page.waitForTimeout(150)
  assert.equal(await label.textContent(), '')
  assert.equal(await label.isVisible(), false)
  assert.match(await page.locator('[data-world="alpine"]').getAttribute('aria-label'), /Population unknown/)
  await change('empty')
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population').textContent === '')
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"]').getAttribute('aria-label').includes('0 connected across 0 rooms'))
  assert.equal(await label.isVisible(), false)
  await change('error')
  await page.waitForTimeout(150)
  assert.equal(await label.textContent(), '')
  mode = 'populated'
  await page.evaluate(() => window.mira.shell.play())
  const inPlay = calls
  await page.waitForTimeout(500)
  assert.equal(calls, inPlay)
  assert.equal(await page.evaluate(() => window.mira.shell.galaxy.presence.active), false)
  await page.evaluate(() => window.mira.shell.openMenu())
  await page.waitForFunction(() => document.querySelector('[data-world="alpine"] .galaxy-population').textContent === '3 online')
  assert.match(await page.locator('[data-world="alpine"]').getAttribute('aria-label'), /Counts span separate rooms/)
  // Population display must not route planet taps into an enumerated room.
  const room = await page.evaluate(() => window.mira.shell.roomInput.value)
  await page.locator('[data-world="alpine"]').dispatchEvent('click')
  await page.waitForFunction(() => window.mira.shell.dropping)
  assert.equal(await page.evaluate(() => window.mira.shell.roomInput.value), room)
  console.log('PRESENCE UI OK')
} finally { await browser.close() }
