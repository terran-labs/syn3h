/** Integration smoke: inject the initializer so the composition root stays owned by its builder. */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const artifactDir = new URL('./artifacts/', import.meta.url)
await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], reports = []
async function open(phone = false) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('http://127.0.0.1:5187/?room=Red%20Planet')
  await page.waitForFunction(() => window.syn3h?.game.tick > 25)
  await page.evaluate(async () => {
    const { initGameShell } = await import('/src/ui/Shell.ts')
    const s = window.syn3h
    window.testShell = initGameShell(s.game, s.player, s.terrain)
    testShell.shell.onPlay = () => { window.playCount = (window.playCount || 0) + 1 }
    testShell.shell.setStatus(['Red Planet', 'Ready for explorers'])
    s.panel.sync()
  })
  await page.evaluate(() => document.fonts.ready)
  return { context, page }
}
try {
  const { context, page } = await open()
  assert.equal(await page.evaluate(() => testShell.audio.state), 'locked')
  await page.locator('#shell-name').fill('Codex Explorer')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => syn3h.game.input.state.y), 0)
  await page.keyboard.up('KeyW')
  await page.locator('#shell-name').fill('Codex Explorer')
  await page.locator('.shell-invite').click()
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /room=Red\+Planet/)
  await page.screenshot({ path: new URL('desktop-start.png', artifactDir).pathname })
  await page.locator('.shell-play').click()
  await page.waitForFunction(() => testShell.audio.state === 'running' && testShell.audio.loadedSounds === 4)
  assert.equal(await page.evaluate(() => playCount), 1)
  assert.equal(await page.evaluate(() => localStorage.getItem('syn3h.playerName')), 'Codex Explorer')
  assert.deepEqual(await page.evaluate(() => testShell.audio.errors), [])
  const padCheck = await page.evaluate(() => {
    const original = navigator.getGamepads.bind(navigator), input = syn3h.game.input
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, axes: [0.5, -0.6, 0, 0], buttons: [] }] })
    input.external.x = 0.75
    const combined = { ...input.poll() }
    input.external.x = 0
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: original })
    return combined
  })
  assert.equal(padCheck.x, 1); assert.equal(padCheck.y, 0.6)
  const before = await page.evaluate(() => syn3h.player.body.translation())
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW')
  const after = await page.evaluate(() => syn3h.player.body.translation())
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 1)
  await page.keyboard.press('Space')
  assert.equal(await page.evaluate(() => syn3h.game.input.state.special), true)
  await page.mouse.move(640, 400); await page.mouse.down(); await page.waitForFunction(() => syn3h.game.input.state.fire)
  assert.equal(await page.evaluate(() => syn3h.game.input.state.fire), true)
  await page.mouse.up()
  await page.locator('#shell-track').selectOption('Ambient')
  await page.waitForTimeout(2300)
  assert.equal(await page.evaluate(() => testShell.audio.track), 'Ambient')
  await page.locator('#shell-track').selectOption('Carefree')
  await page.waitForTimeout(2300)
  const decks = await page.evaluate(() => [...testShell.audio.decks].map(([track, deck]) => ({ track, paused: deck.element.paused, gain: deck.gain.gain.value })))
  assert.equal(decks.find(d => d.track === 'Carefree').paused, false)
  assert.ok(decks.filter(d => d.track !== 'Carefree').every(d => d.paused && d.gain === 0))
  await page.locator('.shell-mute').click()
  assert.equal(await page.evaluate(() => testShell.audio.isMuted), true)
  await page.locator('.shell-mute').click()
  await page.evaluate(() => {
    const p = syn3h.player.body.translation()
    testShell.audio.play('laserShot', p); testShell.audio.play('laserHit', p); testShell.audio.impact(12, p)
  })
  await page.screenshot({ path: new URL('desktop-driving.png', artifactDir).pathname })
  reports.push({ device: 'desktop', before, after, audio: await page.evaluate(() => ({ state: testShell.audio.state, loaded: testShell.audio.loadedSounds, track: testShell.audio.track, errors: testShell.audio.errors })) })
  // Render the exact engine graph offline to inspect headroom, silence and roughness reproducibly.
  const rendered = await page.evaluate(async () => {
    const { Engine } = await import('/src/audio/Engine.ts')
    const context = new OfflineAudioContext(1, 48000 * 6, 48000)
    const engine = new Engine(context, context.destination)
    engine.update({ speed: 0, throttle: 0, airborne: false })
    const first = context.suspend(1.5).then(() => { engine.update({ speed: 30, throttle: 1, airborne: false }); return context.resume() })
    const second = context.suspend(4).then(() => { engine.update({ speed: 45, throttle: 0.5, airborne: true }); return context.resume() })
    const buffer = await context.startRendering(); await Promise.all([first, second])
    const data = buffer.getChannelData(0)
    let peak = 0, power = 0
    for (const n of data) { peak = Math.max(peak, Math.abs(n)); power += n * n }
    return { samples: Array.from(data), peak, rms: Math.sqrt(power / data.length) }
  })
  assert.ok(rendered.peak < 0.95 && rendered.peak > 0.01)
  assert.ok(rendered.rms > 0.005)
  const wav = Buffer.alloc(44 + rendered.samples.length * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  rendered.samples.forEach((v, i) => wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2))
  await writeFile(new URL('engine-idle-drive-flight.wav', artifactDir), wav)
  reports.push({ offlineAudio: { peak: rendered.peak, rms: rendered.rms } })
  await page.reload(); await page.waitForFunction(() => window.syn3h?.game.tick > 5)
  await page.evaluate(async () => { const { initGameShell } = await import('/src/ui/Shell.ts'); const s = syn3h; window.testShell = initGameShell(s.game, s.player, s.terrain) })
  assert.equal(await page.locator('#shell-name').inputValue(), 'Codex Explorer')
  await context.close()

  const phone = await open(true), mobile = phone.page
  await mobile.screenshot({ path: new URL('phone-start.png', artifactDir).pathname })
  await mobile.locator('.shell-play').tap()
  await mobile.waitForFunction(() => testShell.audio.loadedSounds === 4)
  assert.equal(await mobile.locator('.touch-controls').isVisible(), true)
  const stick = await mobile.locator('.touch-stick').boundingBox(), fire = await mobile.locator('[data-action=fire]').boundingBox()
  const session = await phone.context.newCDPSession(mobile)
  const drivePoint = { x: stick.x + stick.width / 2, y: stick.y + 12, id: 1 }
  const firePoint = { x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 2 }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drivePoint] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drivePoint, firePoint] })
  await mobile.waitForTimeout(900)
  const held = await mobile.evaluate(() => ({ ...syn3h.game.input.state }))
  assert.ok(held.y > 0.8); assert.equal(held.fire, true)
  await mobile.screenshot({ path: new URL('phone-driving.png', artifactDir).pathname })
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await mobile.waitForTimeout(100)
  const released = await mobile.evaluate(() => ({ ...syn3h.game.input.state }))
  assert.equal(released.y, 0); assert.equal(released.fire, false)
  await mobile.locator('[data-action=special]').tap()
  assert.equal(await mobile.evaluate(() => syn3h.game.input.state.special), true)
  const brake = await mobile.locator('[data-action=brakes]').boundingBox()
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: brake.x + 30, y: brake.y + 30, id: 3 }] })
  await mobile.waitForTimeout(100)
  assert.equal(await mobile.evaluate(() => syn3h.game.input.state.brakes), true)
  await mobile.evaluate(() => window.dispatchEvent(new Event('blur')))
  await mobile.waitForTimeout(100)
  assert.equal(await mobile.evaluate(() => syn3h.game.input.state.brakes), false)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.deepEqual(await mobile.evaluate(() => ({ x: scrollX, y: scrollY, scale: visualViewport.scale })), { x: 0, y: 0, scale: 1 })
  reports.push({ device: 'phone', held, released, audio: await mobile.evaluate(() => ({ state: testShell.audio.state, errors: testShell.audio.errors })) })
  await mobile.evaluate(() => testShell.dispose())
  assert.equal(await mobile.locator('.touch-controls').count(), 0)
  assert.equal(await mobile.locator('.syn3h-shell').count(), 0)
  await phone.context.close()
  assert.deepEqual(errors, [])
  await writeFile(new URL('report.json', artifactDir), JSON.stringify({ reports, errors }, null, 2))
  console.log(JSON.stringify({ reports, errors }, null, 2))
} finally { await browser.close() }
