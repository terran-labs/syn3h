/**
 * Does a vehicle touching water blur the screen? Drive a buggy from the shore into shallow
 * water with the camera above the surface; capture a frame just before the wheels get wet and
 * one just after, and compare their sharpness (variance of the Laplacian of luminance, whole
 * frame and the horizon band). Headed Chrome, one browser.
 *
 *   tools/heavy.sh node tools/contact-blur-check.mjs http://127.0.0.1:5292/ /tmp/out [--phone]
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const [base = 'http://127.0.0.1:5292/', out = '/tmp/contact-blur', ...flags] = process.argv.slice(2)
const phone = flags.includes('--phone')
await mkdir(out, { recursive: true })

/** Variance of a 4-neighbour Laplacian over rows [y0, y1) of a greyscale image. */
async function sharpness(path, band) {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  const y0 = Math.max(1, Math.floor(h * band[0])), y1 = Math.min(h - 1, Math.floor(h * band[1]))
  let n = 0, sum = 0, sum2 = 0
  for (let y = y0; y < y1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const l = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i]
    sum += l; sum2 += l * l; n++
  }
  const mean = sum / n
  return +(sum2 / n - mean * mean).toFixed(1)
}

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = {}
try {
  for (const [label, quality] of [['ultra', 4], ['medium', 2]]) {
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: phone ? 3 : 1 })
    await page.routeWebSocket(/\/ws/, socket => socket.close())
    await page.goto(`${base}?autoplay=1&vehicle=buggy&planet=archipelago&seed=1`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 10, null, { timeout: 120000 })
    const setup = await page.evaluate(quality => {
      const s = window.syn3h, t = s.terrain
      s.params.set('bots.count', 0); s.params.set('sun.timeOfDay', 12); s.params.set('sun.dayLength', 0); s.params.set('gfx.quality', quality); s.params.set('gfx.auto', false)
      // Shallow water with dry land 25 m away along some heading.
      const p0 = s.player.body.translation()
      for (let r = 20; r < 1500; r += 5) for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2, x = p0.x + Math.cos(a) * r, z = p0.z + Math.sin(a) * r
        if (t.liquidKindAt?.(x, z) !== 'water') continue
        const d = t.liquidHeightAt(x, z) - t.heightAt(x, z)
        if (d < 0.3 || d > 0.8) continue
        for (let j = 0; j < 24; j++) {
          const b = (j / 24) * Math.PI * 2, lx = x + Math.cos(b) * 25, lz = z + Math.sin(b) * 25
          if (t.liquidKindAt?.(lx, lz)) continue
          // Face from the land point toward the water point.
          const heading = Math.atan2(x - lx, z - lz)
          return { x, z, lx, lz, heading }
        }
      }
      return null
    }, quality)
    if (!setup) { report[label] = { error: 'no shallow water' }; await page.close(); continue }
    // Try both heading conventions: keep the one whose first metres approach the water.
    await page.evaluate(({ lx, lz, heading, x, z }) => {
      const s = window.syn3h, t = s.terrain
      const try1 = h => { s.player.teleport({ x: lx, y: t.heightAt(lx, lz) + 1.2, z: lz }, h); const q = s.player.body.rotation(); const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y); return fx * (x - lx) + fz * (z - lz) }
      let h = heading
      if (try1(h) < 0) h = heading + Math.PI
      try1(h)
      s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      window.contact = { wet: false, at: 0, peak: 0 }
      // The old splash blur's strength each frame (absent once removed): the direct evidence.
      const chain = s.game.postChain
      window.contactProbe = s.game.add({
        postPhysics() { if (!window.contact.wet && s.player.liquidState.wasImmersed) { window.contact.wet = true; window.contact.at = performance.now() } },
        update() { if (window.contact.wet) window.contact.peak = Math.max(window.contact.peak, chain?.u?.plunge?.value ?? 0) },
      })
      const canvas = document.querySelector('canvas')
      for (const el of document.body.querySelectorAll('*')) if (!el.contains(canvas) && el !== canvas) el.style.visibility = 'hidden'
    }, setup)
    await page.waitForTimeout(1500)
    await page.evaluate(() => { const i = window.syn3h.game.input.external; i.y = 1; i.x = 0; i.brakes = false })
    // Frame before contact: capture repeatedly, keeping the last one taken while still dry.
    const before = `${out}/${label}-before${phone ? '-phone' : ''}.png`
    let wet = false
    for (let i = 0; i < 80 && !wet; i++) {
      await page.screenshot({ path: `${out}/tmp.png` })
      wet = await page.evaluate(() => window.contact.wet)
      if (!wet) await sharp(`${out}/tmp.png`).toFile(before)
    }
    const during = `${out}/${label}-during${phone ? '-phone' : ''}.png`
    await page.screenshot({ path: during })
    const state = await page.evaluate(() => {
      const s = window.syn3h, c = s.game.camera.position
      return { blurPeakAfterContact: +window.contact.peak.toFixed(3), wet: window.contact.wet, msSinceContact: Math.round(performance.now() - window.contact.at), cameraAboveSurface: +(c.y - (s.terrain.liquidHeightAt?.(c.x, c.z) ?? -Infinity)).toFixed(2), motionBlur: s.params.get('post.motionBlur')?.value, plunge: s.params.get('post.plunge')?.value ?? 'removed' }
    })
    report[label] = {
      ...state,
      sharpness: { before: await sharpness(before, [0, 1]), during: await sharpness(during, [0, 1]) },
      horizonBand: { before: await sharpness(before, [0.3, 0.55]), during: await sharpness(during, [0.3, 0.55]) },
      shots: [before, during],
    }
    console.log(label, JSON.stringify(report[label]))
    await page.close()
  }
} finally {
  await browser.close()
  await writeFile(`${out}/report${phone ? '-phone' : ''}.json`, JSON.stringify(report, null, 2))
}
