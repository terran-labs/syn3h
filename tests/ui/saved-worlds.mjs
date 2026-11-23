/** Combined acceptance with an ephemeral Vite proxy and real room server. Run through heavy.sh. */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright-core'
const origin = 'http://127.0.0.1:18114'
let logs = ''
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '18114', '--strictPort'], {
  env: { ...process.env, MIRA_NO_ROOM_SERVER: '', MIRA_ROOM_PORT: '18113' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
})
server.stdout.on('data', x => { logs += x }); server.stderr.on('data', x => { logs += x })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${origin}/presence`); if (response.ok && (await response.json()).version === 1) { ready = true; break } } catch {}
    await wait(200)
  }
  assert.ok(ready, logs)
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
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mira.savedWorlds.v1')).entries[0])
    assert.equal(stored.seed, 777); assert.equal(stored.world.values['terrain.treeCover'], 0)
    assert.ok(!Object.keys(stored.world.values).some(key => key.startsWith('audio.')))
    await page.reload(); await readyPage(page)
    await page.waitForFunction(() => [...document.querySelectorAll('.saved-world-moon')].some(button => !button.hidden))
    // The logo clock starts at its first draw and can advance slower than wall time.
    await page.waitForFunction(() => window.mira.shell.galaxy.logo.introTime > 3.6, null, { timeout: 30000 })
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
    await page.mouse.click(moonBox.x + moonBox.width / 2, moonBox.y + moonBox.height / 2)
    await page.waitForFunction(() => window.mira.shell.dropping)
    await page.waitForFunction(() => !window.mira.shell.dropping && window.mira.shell.started && window.miraNet?.connected, null, { timeout: 30000 })
    assert.equal(await page.evaluate(() => window.mira.params.get('world.seed').value), 777)
    assert.equal(await page.evaluate(() => window.mira.params.get('terrain.treeCover').value), 0)
    assert.equal(await page.evaluate(() => window.mira.shell.roomInput.value), 'lobby')
    assert.equal(await page.evaluate(() => JSON.stringify(window.mira.shell.galaxy.options.worlds.find(world => world.id === 'custom'))), custom)
    assert.equal(await page.evaluate(() => window.mira.shell.galaxy.savedTarget), false)
    // Verify the real visible World footer, not merely a hidden callback fixture.
    await page.evaluate(() => { window.mira.shell.inspector.open = true })
    await page.locator('.wi-card[data-section="world"] .wi-head').click()
    const save = page.locator('[data-wi=save-world]')
    await save.scrollIntoViewIfNeeded(); await save.click()
    const visibleStatus = async pattern => {
      assert.match(await page.locator('.wi-status').textContent(), pattern)
      assert.equal(await page.locator('.wi-status').evaluate(element => {
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node)
          if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
        }
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0
      }), true, 'save feedback is visibly rendered')
    }
    await visibleStatus(/already saved/)
    assert.equal(await page.evaluate(() => window.mira.game.input.suspended), false)
    await page.evaluate(() => window.mira.params.set('terrain.treeCover', 0.1))
    await save.focus(); await page.keyboard.down('Enter')
    assert.equal(await page.evaluate(() => { window.mira.game.input.poll(); return window.mira.game.input.state.fire }), false)
    await page.keyboard.up('Enter'); await visibleStatus(/World saved/)
    await page.evaluate(() => window.mira.params.set('terrain.treeCover', 0.2))
    const special = await page.evaluate(() => window.mira.game.input.state.special)
    await page.keyboard.down('Space')
    assert.equal(await page.evaluate(() => window.mira.game.input.state.special), special)
    await page.keyboard.up('Space'); await visibleStatus(/World saved/)
    await page.evaluate(() => {
      window.mira.params.set('terrain.treeCover', 0.3)
      window.__setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) { if (key === 'mira.savedWorlds.v1') throw new Error('Storage test failure'); return window.__setItem.call(this, key, value) }
    })
    await save.click(); await visibleStatus(/not saved.*Storage test failure/)
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
      await guest.locator('.saved-world-moon').dispatchEvent('click')
      await guest.waitForFunction(() => window.miraNet?.connected)
      await guest.waitForFunction(() => document.querySelector('.shell-toast').textContent.includes('current room'))
      assert.equal(await guest.evaluate(() => window.mira.params.get('world.seed').value), 777)
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
      await guest.evaluate(() => window.mira.shell.showPanel('worlds'))
      await guest.locator('.saved-worlds button[aria-label^="Delete"]').first().dispatchEvent('click')
      assert.equal(await guest.evaluate(() => JSON.parse(localStorage.getItem('mira.savedWorlds.v1')).entries.length), 1)
      assert.equal(await guest.evaluate(() => window.mira.params.get('world.seed').value), 777)
      // The remaining bookmark matches the room and is safe to enter under its lock.
      const entry = guest.locator('.saved-worlds button[data-saved-world]')
      await entry.focus(); await guest.keyboard.press('Enter')
      await guest.waitForFunction(() => !window.mira.shell.menuOpen)
      assert.equal(await guest.evaluate(() => window.mira.params.get('world.seed').value), 777)
      await guest.evaluate(() => window.mira.shell.openMenu())
      assert.equal(await guest.locator('.galaxy-canvas').count(), 1)
      console.log('WebKit: authoritative override message, reduced entry, locked guest save/restore and local delete OK')
    } finally { await safari.close() }
    await page.evaluate(() => window.miraNet.setLocked(false))
    // Throw during application and ensure the borrowed target and input lifecycle recover.
    await page.evaluate(() => {
      const { shell, params } = window.mira
      shell.openMenu(); window.__apply = params.applySnapshot
      params.applySnapshot = () => { throw new Error('Saved restore test failure') }
    })
    await page.locator('.saved-world-moon').dispatchEvent('click')
    await page.waitForFunction(() => window.mira.shell.dropping)
    await page.waitForFunction(() => !window.mira.shell.dropping && !window.mira.shell.savedEntering, null, { timeout: 30000 })
    assert.equal(await page.evaluate(() => window.mira.shell.galaxy.savedTarget), false)
    assert.equal(await page.evaluate(() => window.mira.game.input.suspended), false)
    assert.equal(await page.evaluate(() => JSON.stringify(window.mira.shell.galaxy.options.worlds.find(world => world.id === 'custom'))), custom)
    await page.evaluate(() => { window.mira.params.applySnapshot = window.__apply })
    assert.deepEqual(errors, [])
    console.log('Chromium: save/reload, direct moon drop, snapshot restore, room route and failure recovery OK')
  } finally { await browser.close() }
} finally {
  if (server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); process.kill(-server.pid, 'SIGTERM'); await stopped }
}
