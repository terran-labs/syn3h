// The lobby before the physics engine (src/core/physicsGate.ts, createLobby in src/ui/Shell.ts).
// Bugs caught: the lobby held back until the 3 MB physics engine has arrived; a planet tap or
// Play before it arrives that does nothing, errors or is lost; a failed download that leaves the
// page needing a reload, or a retry that needs one; a slow download that never lets the player in.
// Three cases on the dev server, where the engine is part of a script, so its download is
// rehearsed through the dev-only window.__miraRehearsePhysics hook (src/main.ts):
//  - blocked: the lobby is drawn and usable (Welcome, Updates, Settings open and close); a planet
//    tap waits with the "Preparing world" line, then says calmly that the engine has not arrived
//    and offers to try again; unblocked, Try again enters the world in the same page.
//  - slow (25 s): a tap waits, then enters by itself.
//  - fails once: the gate retries by itself and enters without a click.
// The real file blocked in a production build is tools/physics-wasm-check.mjs.
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/lobby-before-physics.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { settledLobby, waitForState } from './stateWait.mjs'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const tapPlanet = async page => { await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter') }
const entered = (page, what) => waitForState(page, what, () => window.mira?.shell?.playing && !window.mira.shell.transitioning && window.mira.game.tick > 10, undefined, 180)
const line = page => page.evaluate(() => { const l = document.querySelector('.entry-wait'); return l ? { text: l.querySelector('span').textContent, retry: !l.querySelector('button').hidden } : null })

async function open(rehearse, viewport) {
  const page = await browser.newPage({ viewport })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(r => { window.__miraRehearsePhysics = r }, rehearse)
  await page.goto(`${base}?room=lobby-physics-${Date.now()}`)
  await settledLobby(page)
  return { page, errors }
}

try {
  // Blocked: the lobby works without the engine, and a retry in place gets in.
  {
    const { page, errors } = await open({ blocked: true }, { width: 1280, height: 800 })
    assert.ok(await page.evaluate(() => !window.mira.player && window.mira.physics.state !== 'ready'), 'the lobby is up while the engine has not arrived')
    for (const [name, opener, closer, shown] of [
      ['Welcome', '.lobby-gear-dock .lobby-about', 'dialog.lobby-sheet-about .lobby-sheet-close', 'dialog.lobby-sheet-about[open]'],
      ['Updates', '.lobby-version', 'dialog.lobby-sheet-updates .lobby-sheet-close', 'dialog.lobby-sheet-updates[open]'],
      ['Settings', '.lobby-gear', '.lobby-settings-close', '#lobby-settings:not([hidden])'],
    ]) {
      await page.locator(opener).first().click()
      await waitForState(page, `${name} open`, sel => !!document.querySelector(sel), shown, 20)
      await page.locator(closer).first().click()
      await waitForState(page, `${name} closed`, sel => !document.querySelector(sel), shown, 20)
    }
    const origin = await page.evaluate(() => performance.timeOrigin)
    await tapPlanet(page)
    await waitForState(page, 'the wait line on the tap', () => !!document.querySelector('.entry-wait'), undefined, 5)
    await waitForState(page, 'the calm message and Try again', () => !document.querySelector('.entry-wait button')?.hidden, undefined, 60)
    const shown = await line(page)
    assert.match(shown.text, /physics engine has not arrived\. Trying again in \d+ s\./, `a plain message (${shown.text})`)
    assert.equal(await page.evaluate(() => window.mira.shell.playing), false, 'not entered without the engine')
    await page.screenshot({ path: '/tmp/mira-browser-checks/lobby-before-physics-blocked.png' })
    await page.evaluate(() => { window.__miraRehearsePhysics.blocked = false })
    await page.getByRole('button', { name: 'Try again now' }).click()
    await entered(page, 'in the world after Try again')
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin, 'the same page: no reload')
    assert.equal(await page.evaluate(() => document.querySelector('.entry-wait')), null, 'the wait line has gone')
    assert.deepEqual(errors, [])
    console.log('blocked: ok')
    await page.close()
  }
  // Slow (25 s, past the opening): a tap waits with the line and enters by itself (phone size).
  {
    const { page, errors } = await open({ delayMs: 25000 }, { width: 390, height: 844 })
    const ready = await page.evaluate(() => window.mira.physics.state === 'ready')
    await tapPlanet(page)
    if (!ready) {
      await waitForState(page, 'the wait line on the tap', () => !!document.querySelector('.entry-wait'), undefined, 5)
      const shown = await line(page)
      assert.equal(shown.text, 'Preparing world'); assert.equal(shown.retry, false, 'no retry offered while it is only slow')
    }
    await entered(page, 'in the world once the engine arrived')
    assert.deepEqual(errors, [])
    console.log(`slow: ok${ready ? ' (the engine was already in when the lobby settled)' : ''}`)
    await page.close()
  }
  // Fails once: retried by itself, no click.
  {
    const { page, errors } = await open({ delayMs: 1500, failures: 1 }, { width: 1280, height: 800 })
    await tapPlanet(page)
    await entered(page, 'in the world after the automatic retry')
    assert.equal(await page.evaluate(() => window.mira.physics.attempts), 2, 'one failure, one retry')
    assert.deepEqual(errors, [])
    console.log('fails once: ok')
    await page.close()
  }
} finally { await browser.close() }
