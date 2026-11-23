/**
 * Wings over water and lava: do the buggy's open wings stay visible from every angle?
 * Flies a buggy with wings open about 15 m above the sea (archipelago) and the lava sea
 * (volcanic), orbits the camera round it at low and high elevations, and writes a contact
 * sheet per planet. Headed Chrome, one browser.
 *
 *   tools/heavy.sh node tools/wings-over-liquid.mjs http://127.0.0.1:5292/ /tmp/out
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const [base = 'http://127.0.0.1:5292/', out = '/tmp/wings-over-liquid'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ANGLES = [[0, -4], [60, 2], [120, 8], [180, 15], [240, 30], [300, 50]]
try {
  for (const [planet, kind] of [['archipelago', 'water'], ['volcanic', 'lava']]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    await page.routeWebSocket(/\/ws/, s => s.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&planet=${planet}&seed=1`)
    await page.waitForFunction(() => window.mira?.game.tick > 10, null, { timeout: 120000 })
    await page.evaluate(kind => {
      const s = window.mira, t = s.terrain
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 15); s.params.set('sun.dayLength', 0)
      const p0 = s.player.body.translation()
      let spot = null
      for (let r = 50; r < 1500 && !spot; r += 10) for (let i = 0; i < 36; i++) {
        const a = i / 36 * Math.PI * 2, x = p0.x + Math.cos(a) * r, z = p0.z + Math.sin(a) * r
        if (t.liquidKindAt?.(x, z) === kind && t.liquidHeightAt(x, z) - t.heightAt(x, z) > 8) { spot = { x, z, y: t.liquidHeightAt(x, z) }; break }
      }
      window.wingSpot = spot
      s.player.teleport({ x: spot.x, y: spot.y + 15, z: spot.z }, 0)
      for (const el of document.body.querySelectorAll('*')) if (!el.contains(document.querySelector('canvas')) && el !== document.querySelector('canvas')) el.style.visibility = 'hidden'
    }, kind)
    await page.keyboard.down('Space')
    await page.waitForTimeout(1200)
    const frames = []
    for (const [az, el] of ANGLES) {
      await page.evaluate(([az, el]) => {
        const s = window.mira, V = s.game.camera.position.constructor, p = s.player.body.translation()
        // Hold the buggy where it is while the camera moves round it.
        s.player.body.setTranslation({ x: window.wingSpot.x, y: window.wingSpot.y + 15, z: window.wingSpot.z }, true)
        s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        const a = az * Math.PI / 180, e = el * Math.PI / 180, d = 9
        s.camera.setCinematicPose(new V(p.x + Math.cos(a) * Math.cos(e) * d, p.y + Math.sin(e) * d, p.z + Math.sin(a) * Math.cos(e) * d), new V(p.x, p.y, p.z))
      }, [az, el])
      await page.waitForTimeout(1500)
      const path = `${out}/${planet}-${az}-${el}.png`
      await page.screenshot({ path })
      frames.push(path)
    }
    const wingsOpen = await page.evaluate(() => window.mira.player.wingsOpen)
    console.log(planet, 'wingsOpen', wingsOpen)
    await page.keyboard.up('Space')
    await page.close()
    // Contact sheet, 3 by 2.
    const inputs = frames.flatMap(f => ['-i', f])
    const layout = '0_0|w0_0|w0+w0_0|0_h0|w0_h0|w0+w0_h0'
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `xstack=inputs=6:layout=${layout}`, `${out}/${planet}-sheet.png`])
  }
} finally { await browser.close() }
