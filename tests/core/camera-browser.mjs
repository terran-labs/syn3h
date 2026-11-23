import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  await page.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
  await page.goto('http://localhost:5186/?autoplay=1')
  await page.waitForFunction(() => window.mira?.game.tick > 20)
  const read = () => page.evaluate(() => { const s = window.mira, c = s.game.camera; return { mode: s.params.get('camera.mode').value, visible: s.player.object.visible, fov: c.fov, distance: s.params.get('camera.distance').value, clearance: c.position.y - s.terrain.heightAt(c.position.x, c.position.z) } })
  await page.keyboard.press('KeyC'); await page.waitForTimeout(700)
  const cockpit = await read()
  if (cockpit.mode !== 1 || cockpit.visible || Math.abs(cockpit.fov - 70) > 1) throw new Error('Cockpit toggle failed')
  await page.mouse.click(500, 400, { button: 'right' }); await page.waitForTimeout(300)
  const chase = await read()
  if (chase.mode !== 0 || !chase.visible) throw new Error('Original RMB toggle failed')
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(800)
  const scope = await read(); await page.keyboard.up('KeyZ')
  if (scope.fov > 25) throw new Error('Scope failed')
  await page.mouse.wheel(0, -100); const zoom = await read()
  if (zoom.distance >= chase.distance) throw new Error('Wheel zoom failed')
  const clearances = []
  for (let mode = 0; mode <= 4; mode++) {
    await page.evaluate(mode => { const s = window.mira; s.params.set('camera.mode', mode); s.player.teleport({ x: 0, y: -20, z: 0 }) }, mode)
    await page.waitForTimeout(100); clearances.push((await read()).clearance)
  }
  if (clearances.some(x => x < 0.499)) throw new Error('Camera below terrain')
  console.log(JSON.stringify({ cockpit, chase, scope, zoom, clearances }, null, 2))
} finally { await browser.close() }
