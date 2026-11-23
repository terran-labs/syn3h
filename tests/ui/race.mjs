import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'
const base = serverUrl('race')
await mkdir('tests/ui/artifacts/race', { recursive: true })
for (const mode of (process.env.RACE_VIEW ? [process.env.RACE_VIEW] : ['desktop', 'phone', 'landscape'])) {
  const mobile = mode !== 'desktop'
  const browser = await (mobile ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(mobile ? { ...devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] } : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}?room=race-ui-${Date.now()}&autoplay=1`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 90000 })
    await page.evaluate(() => {
      const shell = mira.shell
      window.raceProbe = { now: 100, leave: 0, cancel: 0 }
      window.raceState = { id: 'a', revision: 1, phase: 'countdown', remainingMs: 5000, updatedAt: 100, destination: { label: 'North overlook', x: 100, y: 20, z: 100, radius: 12 }, participants: [{ id: 1, name: 'You', status: 'racing' }], winnerId: null, winnerName: null }
      shell.onRaceLeave = () => raceProbe.leave++
      shell.onRaceCancel = () => raceProbe.cancel++
      shell.setRace(raceState, () => raceProbe.now, { id: 1, host: true, connected: true })
    })
    const hud = page.locator('.race-hud')
    const press = name => { const button = hud.getByRole('button', { name, exact: true }); return mobile ? button.tap() : button.click() }
    await hud.waitFor({ state: 'visible' })
    assert.match(await hud.textContent(), /Starts in 5/)
    await page.screenshot({ path: `tests/ui/artifacts/race/${mode}-host.png` })
    await press('Leave race')
    await press('Cancel race')
    assert.deepEqual(await page.evaluate(() => [raceProbe.leave, raceProbe.cancel]), [1, 1])
    await press('Hide')
    await press('Show race')
    await page.evaluate(() => raceProbe.now = 106)
    await page.waitForFunction(() => document.querySelector('.race-status').textContent === 'Waiting for start')
    await page.evaluate(() => mira.shell.setRace({ ...raceState, revision: 2, phase: 'running', updatedAt: 106, remainingMs: 120000 }, () => raceProbe.now, { id: 2, host: false, connected: true }))
    await page.waitForFunction(() => document.querySelector('.race-detail').textContent.startsWith('Watching'))
    assert.equal(await hud.getByRole('button', { name: 'Leave race', exact: true }).count(), 0)
    assert.equal(await hud.getByRole('button', { name: 'Cancel race', exact: true }).count(), 0)
    const box = await hud.boundingBox(), viewport = page.viewportSize()
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height)
    const map = await page.locator('.shell-minimap').boundingBox()
    if (map) assert.ok(box.x + box.width <= map.x || map.x + map.width <= box.x || box.y + box.height <= map.y || map.y + map.height <= box.y, 'race must not overlap minimap')
    await page.screenshot({ path: `tests/ui/artifacts/race/${mode}.png` })
    if (!mobile) {
      await page.locator('canvas').first().click({ position: { x: 700, y: 600 } })
      await page.waitForFunction(() => !!document.pointerLockElement)
      await page.waitForFunction(() => document.querySelector('.race-hud').classList.contains('is-captured'))
      assert.equal(await hud.locator('.race-controls').isVisible(), false)
      await page.evaluate(() => document.exitPointerLock())
    }
    await page.evaluate(() => mira.shell.setRace({ ...raceState, phase: 'finished', winnerName: '<b>Winner</b>', winnerId: 1 }, () => raceProbe.now, { id: 1, host: true, connected: true }))
    assert.equal(await hud.locator('b').count(), 0)
    assert.match(await hud.textContent(), /<b>Winner<\/b> wins/)
    await page.evaluate(() => mira.shell.setRace(null, () => 0, { id: 1, host: false, connected: false }))
    await hud.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(`${mode} race UI passed`)
  } finally { await browser.close() }
}
