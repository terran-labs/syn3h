// Saved worlds, against a real room server. Bugs caught: saving a world loses its seed or a
// setting, or stores the player's own audio settings with it; a saved world missing from the
// galaxy (its moon) after a reload; and the other checks below, through a room another player
// joins.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs saved-worlds
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright-core'
import { serverUrl } from './lib/server.mjs'
import { settledLobby, waitForState } from './stateWait.mjs'
const origin = serverUrl('saved-worlds').replace(/\/$/, '')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const savedEntries = page => page.evaluate(() => JSON.parse(localStorage.getItem('mira.savedWorlds.v1')).entries)
const visibleToast = page => page.locator('.shell-toast:not([hidden])').allTextContents()
try {
  // The room server answers behind the dev server (its /presence), or there is nothing to test.
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) {
    try { const response = await fetch(`${origin}/presence`); ready = response.ok && (await response.json()).version === 1 } catch {}
    if (!ready) await wait(200)
  }
  assert.ok(ready, `no room server behind ${origin}: run it through tools/browser-checks.mjs saved-worlds`)
  await mkdir('tests/ui/artifacts/saved-worlds', { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const readyPage = page => page.waitForFunction(() => window.mira?.shell?.galaxy?.live && document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
    await page.goto(origin); await readyPage(page)
    await page.evaluate(() => {
      const { shell, params } = window.mira
      shell.stopAttract(); params.set('terrain.look', 2); params.set('world.seed', 777); params.set('terrain.treeCover', 0)
      shell.inspector.open = true
    })
    await page.locator('[data-wi=save-world]').dispatchEvent('click')
    const [stored] = await savedEntries(page)
    assert.equal(stored.seed, 777); assert.equal(stored.world.values['terrain.treeCover'], 0)
    assert.ok(!Object.keys(stored.world.values).some(key => key.startsWith('audio.')))
    await page.reload(); await readyPage(page)
    await page.waitForFunction(() => [...document.querySelectorAll('.saved-world-moon')].some(button => !button.hidden))
    // The settled lobby (the opening skipped), as a player sees it, for the screenshot.
    await settledLobby(page)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: 'tests/ui/artifacts/saved-worlds/desktop.png' })
    assert.equal(await page.locator('.saved-world-moon').count(), 1)
    await page.evaluate(() => { window.mira.shell.stopAttract(); window.mira.params.set('world.seed', 888) })
    const custom = await page.evaluate(() => JSON.stringify(window.mira.shell.galaxy.options.worlds.find(world => world.id === 'custom')))
    // An invitation cannot be replaced by different saved settings, even with the same recipe.
    await page.evaluate(() => { window.mira.shell.invited = true })
    await page.locator('.saved-world-moon').dispatchEvent('click')
    assert.equal(await page.evaluate(() => window.mira.shell.dropping), false)
    assert.equal(await page.evaluate(() => window.mira.params.get('world.seed').value), 888)
    await page.evaluate(() => { window.mira.shell.invited = false })
    const moonBox = await page.locator('.saved-world-moon').boundingBox()
    assert.ok(moonBox)
    // The room the player is in (the public room shows as empty, 39f704a7): a drop keeps it.
    const roomBefore = await page.evaluate(() => window.mira.shell.roomInput.value)
    await page.mouse.click(moonBox.x + moonBox.width / 2, moonBox.y + moonBox.height / 2)
    await page.waitForFunction(() => window.mira.shell.dropping)
    await page.waitForFunction(() => !window.mira.shell.dropping && window.mira.shell.started && window.miraNet?.connected, null, { timeout: 30000 })
    assert.equal(await page.evaluate(() => window.mira.params.get('world.seed').value), 777)
    assert.equal(await page.evaluate(() => window.mira.params.get('terrain.treeCover').value), 0)
    assert.equal(await page.evaluate(() => window.mira.shell.roomInput.value), roomBefore, 'a saved world opens in the room the player was in')
    assert.equal(await page.evaluate(() => JSON.stringify(window.mira.shell.galaxy.options.worlds.find(world => world.id === 'custom'))), custom)
    assert.equal(await page.evaluate(() => window.mira.shell.galaxy.savedTarget), false)
    // Verify the real visible World footer, not merely a hidden callback fixture.
    // The panels, as a player opens them on a desktop: Escape frees the cursor and shows them.
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await waitForState(page, 'the panels shown', () => getComputedStyle(document.querySelector('.world-inspector')).opacity === '1', undefined, 15)
    await page.locator('.wi-card[data-section="world"] .wi-head').click()
    const save = page.locator('[data-wi=save-world]')
    await save.scrollIntoViewIfNeeded(); await save.click()
    const visibleStatus = async () => {
      const text = await page.locator('.wi-status').evaluate(element => {
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node)
          if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return ''
        }
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 ? element.textContent.trim() : ''
      })
      assert.ok(text, 'save feedback is visibly rendered')
      return text
    }
    const duplicateStatus = await visibleStatus()
    assert.deepEqual(await savedEntries(page), [stored], 'saving the same world does not add or replace a bookmark')
    assert.equal(await page.evaluate(() => window.mira.game.input.suspended), false)
    await page.evaluate(() => window.mira.params.set('terrain.treeCover', 0.1))
    await save.focus(); await page.keyboard.down('Enter')
    assert.equal(await page.evaluate(() => { window.mira.game.input.poll(); return window.mira.game.input.state.fire }), false)
    await page.keyboard.up('Enter')
    assert.notEqual(await visibleStatus(), duplicateStatus, 'saving a new snapshot gives different feedback from a duplicate')
    assert.ok((await savedEntries(page)).some(entry => entry.world.values['terrain.treeCover'] === 0.1), 'Enter saves the changed snapshot')
    await page.evaluate(() => window.mira.params.set('terrain.treeCover', 0.2))
    const special = await page.evaluate(() => window.mira.game.input.state.special)
    await page.keyboard.down('Space')
    assert.equal(await page.evaluate(() => window.mira.game.input.state.special), special)
    await page.keyboard.up('Space')
    const savedStatus = await visibleStatus()
    const beforeFailure = await savedEntries(page)
    assert.ok(beforeFailure.some(entry => entry.world.values['terrain.treeCover'] === 0.2), 'Space saves the changed snapshot')
    await page.evaluate(() => {
      window.mira.params.set('terrain.treeCover', 0.3)
      window.__setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) { if (key === 'mira.savedWorlds.v1') throw new Error('Storage test failure'); return window.__setItem.call(this, key, value) }
    })
    await save.click()
    assert.notEqual(await visibleStatus(), savedStatus, 'failed storage gives different feedback from success')
    assert.deepEqual(await savedEntries(page), beforeFailure, 'failed storage preserves the saved snapshots')
    await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; document.activeElement.blur() })
    await page.keyboard.down('Enter')
    assert.equal(await page.evaluate(() => { window.mira.game.input.poll(); return window.mira.game.input.state.fire }), true)
    await save.focus(); await page.keyboard.up('Enter')
    assert.equal(await page.evaluate(() => { window.mira.game.input.poll(); return window.mira.game.input.state.fire }), false)
    await page.evaluate(id => {
      const { shell, params } = window.mira
      for (const entry of shell.savedWorlds.read().entries) if (entry.id !== id) shell.savedWorlds.remove(entry.id)
      shell.refreshSavedWorlds(); params.set('terrain.treeCover', 0); shell.inspector.open = false
    }, stored.id)
    console.log('Save feedback: visible success/duplicate/storage error; Enter/Space activation and key release isolated')
    // A second browser enters the existing authoritative room with different saved settings.
    const safari = await webkit.launch()
    try {
      const guest = await safari.newPage({ viewport: { width: 390, height: 844 } })
      guest.on('pageerror', error => errors.push(error.message))
      await guest.goto(origin); await readyPage(guest)
      await guest.evaluate(() => {
        const { shell, params } = window.mira
        shell.stopAttract(); params.set('terrain.look', 2); params.set('world.seed', 999)
        shell.saveWorld()
      })
      await guest.waitForFunction(() => [...document.querySelectorAll('.saved-world-moon')].some(button => !button.hidden))
      await guest.screenshot({ path: 'tests/ui/artifacts/saved-worlds/phone-webkit.png' })
      await guest.emulateMedia({ reducedMotion: 'reduce' })
      const [beforeJoin] = await visibleToast(guest)
      await guest.locator('.saved-world-moon').dispatchEvent('click')
      await guest.waitForFunction(() => window.miraNet?.connected)
      await waitForState(guest, 'the authoritative room settings and visible feedback', previous => {
        const text = document.querySelector('.shell-toast:not([hidden])')?.textContent.trim()
        return window.mira.params.get('world.seed').value === 777 && text && text !== previous
      }, beforeJoin?.trim(), 30)
      await page.evaluate(() => window.miraNet.setLocked(true))
      await guest.waitForFunction(() => !window.miraNet.canEditWorld)
      await guest.evaluate(() => { window.mira.shell.openMenu(); window.mira.shell.inspector.open = true })
      assert.equal(await guest.locator('[data-wi=save-world]').isEnabled(), true)
      await guest.locator('[data-wi=save-world]').dispatchEvent('click')
      assert.equal(await guest.evaluate(() => JSON.parse(localStorage.getItem('mira.savedWorlds.v1')).entries.length), 2)
      const firstId = await guest.evaluate(() => JSON.parse(localStorage.getItem('mira.savedWorlds.v1')).entries[0].id)
      await guest.locator(`.saved-world-moon[data-saved-world="${firstId}"]`).dispatchEvent('click')
      assert.equal(await guest.evaluate(() => window.mira.shell.dropping), false)
      assert.equal(await guest.evaluate(() => window.mira.params.get('world.seed').value), 777)
      // (Deleting and entering a bookmark from the Worlds panel was checked here; that panel is
      // not offered while OFFER_CUSTOM_PLANET is off, so no player can reach it.)
      await guest.evaluate(() => window.mira.shell.openMenu())
      assert.equal(await guest.locator('.galaxy-canvas').count(), 1)
      console.log('WebKit: authoritative override message, reduced entry, locked guest save and restore OK')
    } finally { await safari.close() }
    await page.evaluate(() => window.miraNet.setLocked(false))
    // Throw during application and ensure the borrowed target and input lifecycle recover.
    await page.evaluate(() => {
      const { shell, params } = window.mira
      // Away from the saved world first: a tap on the world a player is already in only returns
      // to it (Shell.tapWorld), and this needs a drop.
      shell.openMenu(); shell.stopAttract(); params.set('world.seed', 888); window.__apply = params.applySnapshot
      window.__restoreAttempted = false
      params.applySnapshot = () => { window.__restoreAttempted = true; throw new Error('Saved restore test failure') }
    })
    // Back in the lobby: a tap during its return flight is ignored, so wait for it to settle.
    await settledLobby(page)
    const moon = await page.locator('.saved-world-moon').boundingBox()
    const [beforeRestore] = await visibleToast(page)
    await page.mouse.click(moon.x + moon.width / 2, moon.y + moon.height / 2)
    // The failed restore ends the drop at once (too quickly to catch it under way): the player is
    // told, and nothing is left held.
    await waitForState(page, 'the failed drop to recover and say so', previous => {
      const text = document.querySelector('.shell-toast:not([hidden])')?.textContent.trim()
      return window.__restoreAttempted && !window.mira.shell.dropping && !window.mira.shell.savedEntering && text && text !== previous
    }, beforeRestore?.trim(), 30)
    assert.equal(await page.evaluate(() => window.mira.shell.galaxy.savedTarget), false)
    assert.equal(await page.evaluate(() => window.mira.game.input.suspended), false)
    assert.equal(await page.evaluate(() => JSON.stringify(window.mira.shell.galaxy.options.worlds.find(world => world.id === 'custom'))), custom)
    await page.evaluate(() => { window.mira.params.applySnapshot = window.__apply })
    assert.deepEqual(errors, [])
    console.log('Chromium: save/reload, direct moon drop, snapshot restore, room route and failure recovery OK')
  } finally { await browser.close() }
} finally { /* the runner stops its servers */ }
