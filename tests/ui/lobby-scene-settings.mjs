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
          if (locations.has(location)) {
            window.lastLobbyRays = value
            window.lobbyRayDraws = (window.lobbyRayDraws ?? 0) + 1
          }
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
      const card = panel.locator('[data-section=lobby-scene]')
      const header = card.getByRole('button', { name: 'Lobby scene' })
      assert.equal(await header.getAttribute('aria-expanded'), 'false')
      await header.click()
      const groups = card.locator('.lobby-scene-group')
      assert.ok(await groups.evaluateAll(folds => folds.every(fold => !fold.open)))

      const registry = await page.evaluate(() => window.mira.params.all()
        .filter(({ def }) => def.lobbyGroup)
        .map(({ def }) => ({ id: def.id, scope: def.scope, group: def.lobbyGroup })))
      assert.equal(registry.length, 49)
      assert.ok(registry.every(({ scope }) => scope === 'client'))
      const rendered = await groups.locator('.wi-row').evaluateAll(rows => rows.map(row => ({
        id: row.dataset.id, scope: 'client', group: row.closest('details').dataset.group,
      })))
      const byId = (a, b) => a.id.localeCompare(b.id)
      assert.deepEqual(rendered.sort(byId), registry.sort(byId))
      for (const [group, ids] of Object.entries({
        Orbits: ['lobby.orbitInnerRadius', 'lobby.orbitGapTaper', 'lobby.orbitMinGap'],
        Camera: ['lobby.pitchReturn'],
        'Mira name': ['lobby.logo.spring', 'lobby.logo.damping', 'lobby.logo.lag', 'lobby.logo.planeFade'],
      })) {
        for (const id of ids) assert.ok(rendered.some(row => row.id === id && row.group === group), id)
      }
      await page.screenshot({ path: `${out}/${width}x${height}-settled.png`, animations: 'disabled' })
      assert.equal(await groups.locator('.wi-row > .wi-reset-row').count(), registry.length)
      assert.equal(await page.locator('.world-inspector:not(.lobby-settings) .lobby-scene-group').count(), 0)

      const sun = card.locator('[data-group="Sun"]')
      await sun.locator('summary').click()
      const ray = sun.locator('input[type=range]')
      await ray.waitFor({ state: 'visible' })
      if (phone) {
        // Wait for a run of frames without a Galaxy draw before changing the slider.
        await page.waitForFunction(() => {
          const draws = window.lobbyRayDraws
          const previous = window.lobbyRayCheck
          const frames = previous?.draws === draws ? previous.frames + 1 : 0
          window.lobbyRayCheck = { draws, frames }
          return frames >= 5
        })
      }
      const original = await page.evaluate(() => window.lastLobbyRays)
      await ray.evaluate(input => {
        input.value = '0'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.waitForFunction(() => window.lastLobbyRays === 0)
      await sun.getByRole('button', { name: /Reset Lobby sun/ }).click()
      await page.waitForFunction(value => window.lastLobbyRays === value, original)
      await page.screenshot({ path: `${out}/${width}x${height}-sun.png` })

      await sun.locator('summary').click()
      const name = card.locator('[data-group="Mira name"]')
      await name.locator('summary').click()
      const placement = name.getByRole('group', { name: 'Name placement' })
      assert.deepEqual((await placement.locator('button').evaluateAll(buttons => buttons.map(button => Number(button.dataset.value)))).sort(), [0, 1, 2, 3, 4, 6, 7])
      await placement.getByRole('button', { name: 'Flat', exact: true }).click()
      assert.equal(await page.evaluate(() => window.mira.params.get('lobby.wordmark').value), 0)
      await name.getByRole('button', { name: /^Reset Name placement to / }).click()
      assert.equal(await placement.getByRole('button', { name: 'Along an orbit' }).getAttribute('aria-pressed'), 'true')
      await page.screenshot({ path: `${out}/${width}x${height}-name.png` })

      await name.locator('summary').click()
      const opening = card.locator('[data-group="Opening"]')
      await opening.locator('summary').click()
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
