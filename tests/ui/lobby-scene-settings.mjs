// Run against a Vite test server with MIRA_URL set. Checks registry coverage and real
// WebGL redraws on both a reduced-motion phone and an animated desktop.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, devices } from 'playwright-core'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5173/'
const out = process.env.MIRA_SCENE_ARTIFACTS ?? 'tests/ui/artifacts/lobby-scene-settings'
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    const phone = width === 390
    const page = await browser.newPage({
      ...(phone ? devices['iPhone 14'] : {}),
      viewport: { width, height },
      reducedMotion: phone ? 'reduce' : 'no-preference',
    })
    try {
      await page.addInitScript(() => {
        const locations = new WeakMap()
        const { getUniformLocation, uniform1f } = WebGL2RenderingContext.prototype
        WebGL2RenderingContext.prototype.getUniformLocation = function (program, name) {
          const location = getUniformLocation.call(this, program, name)
          if (location && name === 'uRays') locations.set(location, name)
          return location
        }
        WebGL2RenderingContext.prototype.uniform1f = function (location, value) {
          if (locations.has(location)) window.lastLobbyRays = value
          uniform1f.call(this, location, value)
        }
      })
      const url = new URL(base)
      url.search = '?intro=0&gfx=3'
      await page.goto(url.href)
      await page.waitForFunction(() => typeof window.lastLobbyRays === 'number', null, { timeout: 120000 })
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
      const gear = page.getByRole('button', { name: 'Settings', exact: true })
      await gear.click()
      const panel = page.locator('#lobby-settings')
      const groups = panel.locator('.lobby-scene-group')
      assert.equal(await groups.locator('.wi-head[aria-expanded=true]').count(), 0)

      const registry = await page.evaluate(() => window.mira.params.all()
        .filter(({ def }) => def.lobbyGroup)
        .map(({ def }) => ({ id: def.id, scope: def.scope, group: def.lobbyGroup })))
      assert.ok(registry.length > 0)
      assert.ok(registry.every(({ scope }) => scope === 'client'))
      const rendered = await groups.locator('.wi-row').evaluateAll(rows => rows.map(row => ({
        id: row.dataset.id, scope: 'client', group: row.closest('.wi-card').querySelector('h3').textContent,
      })))
      const byId = (a, b) => a.id.localeCompare(b.id)
      assert.deepEqual(rendered.sort(byId), registry.sort(byId))
      assert.equal(await groups.locator('.lobby-scene-reset button').count(), registry.length)
      assert.equal(await page.locator('.world-inspector:not(.lobby-settings) .lobby-scene-group').count(), 0)

      const sun = groups.filter({ has: page.getByRole('heading', { name: 'Sun', exact: true }) })
      await sun.locator('.wi-head').click()
      const ray = sun.locator('input[type=range]')
      await ray.waitFor({ state: 'visible' })
      const original = await page.evaluate(() => window.lastLobbyRays)
      await ray.evaluate(input => {
        input.value = '0'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.waitForFunction(() => window.lastLobbyRays === 0)
      await sun.getByRole('button', { name: /Reset Lobby sun/ }).click()
      await page.waitForFunction(value => window.lastLobbyRays === value, original)
      await page.screenshot({ path: `${out}/${width}x${height}-sun.png` })

      const name = groups.filter({ has: page.getByRole('heading', { name: 'Mira name', exact: true }) })
      await name.locator('.wi-head').click()
      const placement = name.getByRole('group', { name: 'Name placement' })
      assert.deepEqual((await placement.locator('button').evaluateAll(buttons => buttons.map(button => Number(button.dataset.value)))).sort(), [0, 1, 2, 3, 4, 6, 7])
      await placement.getByRole('button', { name: 'Flat', exact: true }).click()
      assert.equal(await page.evaluate(() => window.mira.params.get('lobby.wordmark').value), 0)
      await name.getByRole('button', { name: 'Reset Name placement' }).click()
      assert.equal(await placement.getByRole('button', { name: 'Along an orbit' }).getAttribute('aria-pressed'), 'true')
      await page.screenshot({ path: `${out}/${width}x${height}-name.png` })

      const opening = groups.filter({ has: page.getByRole('heading', { name: 'Opening', exact: true }) })
      await opening.locator('.wi-head').click()
      const preview = opening.getByRole('group', { name: 'Opening preview' })
      assert.equal(await preview.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed'), 'true')
      await preview.getByRole('button', { name: 'On' }).click()
      const replay = opening.getByRole('button', { name: 'Replay opening' })
      if (phone) {
        assert.ok(await replay.isDisabled())
      } else {
        await replay.click()
        await page.waitForFunction(() => document.documentElement.dataset.opening === 'playing')
        await panel.waitFor({ state: 'detached' })
      }
      console.log(`${width}×${height}: lobby groups, reset, held-frame redraw and opening preview passed`)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
