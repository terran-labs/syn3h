// Fire the Grapple at real terrain, then let go using the control the HUD offers.
// /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs hud-column
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { serverUrl } from './lib/server.mjs'
import { waitForState } from './stateWait.mjs'

const base = serverUrl('hud-column')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const views = [
  { name: 'captured keyboard', options: { viewport: { width: 1280, height: 800 } } },
  { name: 'phone touch', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
]

try {
  for (const { name, options } of views) {
    const page = await browser.newPage(options)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`${base}?autoplay=1&room=grapple-${Date.now()}`)
      await waitForState(page, 'play and room input', () => window.mira?.shell.playing &&
        !mira.shell.transitioning && !mira.game.input.suspended && window.miraNet?.connected, undefined, 120)
      await page.locator('.boot-veil').waitFor({ state: 'hidden' })
      const hook = page.locator('.touch-actions button[data-action=fire]')
      const touch = options.hasTouch
      if (touch) await hook.waitFor({ state: 'visible' })
      const idleActionName = touch ? await hook.getAttribute('aria-label') : null
      await page.evaluate(() => {
        mira.params.set('bots.count', 0)
        mira.params.set('camera.mode', 2) // Orbit keeps the chosen angle.
        miraNet.gear.select('bungee')
      })

      const releaseButton = page.locator('.gear-actions button[data-action=release]')
      const releaseKey = page.locator('.gear-selector .gs-release kbd')
      const readKey = async keycap => {
        await keycap.waitFor({ state: 'visible' })
        await waitForState(page, 'the keycap to be drawn', element =>
          element.checkVisibility({ opacityProperty: true, visibilityProperty: true }), await keycap.elementHandle(), 15)
        const key = (await keycap.textContent()).trim()
        assert.ok(key, 'the keycap names an input')
        return key
      }
      let launchKey, hookLabel
      if (touch) {
        await waitForState(page, 'the Grapple action to be announced', previous => {
          const label = document.querySelector('.touch-actions button[data-action=fire]')?.getAttribute('aria-label')
          return miraNet.gear.current === 'bungee' && label?.trim() && label !== previous
        }, idleActionName, 15)
        hookLabel = await hook.getAttribute('aria-label')
      } else {
        launchKey = await readKey(page.locator('.gs-hints [data-action=launch] kbd').filter({ hasText: /^[a-z]$/i }))
        await page.mouse.click(options.viewport.width / 2, options.viewport.height * 0.375)
        await waitForState(page, 'the game to capture the cursor', () =>
          document.pointerLockElement === mira.game.canvas, undefined, 15)
      }
      assert.equal(await (touch ? releaseButton : releaseKey).isVisible(), false, `${name}: no release action without a cord`)

      // Aim into the ground without replacing the input, raycast, hook, or cord.
      await page.evaluate(() => mira.camera.look(0, 1000))
      await waitForState(page, 'the view to point into the ground', () => {
        const camera = mira.game.camera
        return camera.getWorldDirection(camera.position.clone()).y < -0.7
      }, undefined, 15)

      const before = await page.evaluate(() => ({ ...miraNet.bungee.stats }))
      if (touch) await hook.tap()
      else {
        await page.keyboard.down(launchKey)
        try {
          await waitForState(page, 'the keyboard launch', launched => miraNet.bungee.stats.launched > launched,
            before.launched, 15)
        } finally { await page.keyboard.up(launchKey) }
      }
      await waitForState(page, 'the hook to attach to terrain', () => miraNet.bungee.attached, undefined, 15)
      const attached = await page.evaluate(() => ({ ...miraNet.bungee.stats }))
      assert.equal(attached.launched, before.launched + 1, `${name}: one hook launched`)
      assert.equal(attached.attachedGround, before.attachedGround + 1, `${name}: the hook caught terrain`)

      if (touch) {
        await releaseButton.waitFor({ state: 'visible' })
        assert.ok((await releaseButton.getAttribute('aria-label'))?.trim(), 'the touch release action has a name')
        await releaseButton.tap()
      } else {
        await page.keyboard.press(await readKey(releaseKey))
      }
      await waitForState(page, 'the cord and held actions to clear', () =>
        !miraNet.bungee.mine && miraNet.bungee.reel === 0 && !mira.game.input.state.fire, undefined, 15)
      assert.equal(await page.evaluate(() => miraNet.bungee.stats.released), attached.released + 1,
        `${name}: the advertised action released the attached cord once`)
      await (touch ? releaseButton : releaseKey).waitFor({ state: 'hidden' })
      if (touch) {
        await waitForState(page, 'the Hook action to return', label =>
          document.querySelector('.touch-actions button[data-action=fire]')?.getAttribute('aria-label') === label, hookLabel, 15)
        await hook.tap({ trial: true })
      } else assert.ok(await page.evaluate(() => document.pointerLockElement === mira.game.canvas),
        'releasing the cord keeps the cursor captured')
      assert.deepEqual(errors, [], `${name}: no page errors`)
      console.log(`${name}: Grapple attached, released, and returned to idle`)
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
