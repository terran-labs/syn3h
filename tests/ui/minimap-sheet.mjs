// A comparison sheet of minimap marks: two builds side by side (for example the current
// trunk and a redesign), on four worlds, desktop and phone, at 1x and 3x device pixel ratio.
// One fixed scene per world: you, people and bots on the map (one of them "it"), single
// vehicles beyond the rim near, middle and far, and a crowd of twelve on the rim.
//   SHEET=current=http://127.0.0.1:5395/,new=http://127.0.0.1:5393/ node tests/ui/minimap-sheet.mjs
//   SHEET=new=http://127.0.0.1:5393/ SHEET_REUSE=current node tests/ui/minimap-sheet.mjs   (recapture one build only)
// A build that knows Minimap.markStyle is also captured in its alternative form ('kite').
// Writes tests/ui/artifacts/minimap-sheet/*.png and sheet.png. Look at it.
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const builds = (process.env.SHEET ?? 'new=http://127.0.0.1:5393/').split(',').map((pair) => pair.split(/=(.*)/s).slice(0, 2))
const worlds = (process.env.SHEET_WORLDS ?? 'volcanic,ice,archipelago,obsidian').split(',')
const out = 'tests/ui/artifacts/minimap-sheet'
await mkdir(out, { recursive: true })
const devices = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const shots = []

/** Fixed scene around the player, in the map's own entity format. */
function scene() {
  const s = window.mira, m = s.shell.minimap, p = s.player.object.position, size = s.terrain.size
  if (window.miraNet?.ctx) window.miraNet.ctx.setMapEntities = undefined
  const rim = 0.77 * size / 2, far = size * Math.SQRT1_2, reach = (f) => rim + f * (far - rim)
  const at = (deg, d, more) => ({ x: p.x + Math.cos(deg * Math.PI / 180) * d, z: p.z + Math.sin(deg * Math.PI / 180) * d, heading: (deg * 7) % 6.28, ...more })
  const person = (color, accent) => ({ kind: 'person', color, accent }), bot = (color) => ({ kind: 'bot', color, accent: '#ffffff' })
  const tints = ['#ff8c1a', '#46c46b', '#9b5de5', '#e94f37', '#2ec4d6', '#f2c14e', '#7a8cff', '#ff5fa2', '#8bd346', '#c08552']
  const list = [
    at(-40, rim * .5, person('#e0457b', '#ffd400')), at(150, rim * .6, { ...person('#2a7de1', '#ffffff'), it: true }),
    at(60, rim * .45, bot('#ff8c1a')), at(210, rim * .3, bot('#46c46b')), at(300, rim * .7, bot('#9b5de5')),
    at(-15, rim * 1.04, person('#f2c14e', '#1d1d1d')), at(225, reach(.5), bot('#e94f37')), at(-45, reach(.95), person('#7a8cff', '#ffffff')), at(135, reach(.9), bot('#2ec4d6')),
    // The crowd: three people and nine bots within 45 degrees, just past the rim.
    ...Array.from({ length: 12 }, (_, i) => at(95 + i * 3.8, rim * (1.03 + (i % 4) * .04), i % 4 === 1 ? person(['#ff5fa2', '#8bd346', '#c08552'][i >> 2], '#ffffff') : bot(tints[i % tints.length]))),
  ]
  m.setEntities(list); m.draw()
}

try {
  // SHEET_REUSE=current takes that build's earlier captures from disk instead of capturing again.
  for (const label of (process.env.SHEET_REUSE ?? '').split(',').filter(Boolean)) for (const world of worlds) for (const device of Object.keys(devices)) for (const ratio of [1, 3]) {
    shots.push({ name: `${label}-${world}-${device}-${ratio}x`, label, world, device, ratio })
  }
  for (const [label, url] of builds) for (const world of worlds) for (const [device, options] of Object.entries(devices)) {
    const context = await browser.newContext(options)
    const page = await context.newPage()
    await page.goto(`${url}?autoplay=1&planet=${world}&room=sheet-${label}-${world}-${device}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 180000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    await page.evaluate(() => { const p = window.mira.params; p.set('bots.count', 0); p.set('gfx.auto', false) })
    if (await page.locator('.world-inspector').isVisible() && await page.locator('.inspector-toggle').isVisible()) await page.locator('.inspector-toggle').click()
    const cdp = await context.newCDPSession(page)
    const forms = await page.evaluate(() => 'markStyle' in window.mira.shell.minimap.constructor ? ['dart', 'kite'] : [''])
    for (const ratio of [1, 3]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...options.viewport, deviceScaleFactor: ratio, mobile: Boolean(options.isMobile) })
      await page.waitForTimeout(600)
      for (const form of forms) {
        if (form) await page.evaluate((f) => { window.mira.shell.minimap.constructor.markStyle = f }, form)
        await page.evaluate(scene)
        await page.waitForTimeout(150)
        const box = await page.locator('.shell-minimap').boundingBox(), pad = 16
        const name = `${label}${form && form !== 'dart' ? `-${form}` : ''}-${world}-${device}-${ratio}x`
        // CDP's own capture honours the emulated pixel ratio; Playwright's does not.
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad, scale: 1 } })
        await writeFile(`${out}/${name}.png`, Buffer.from(shot.data, 'base64'))
        shots.push({ name, label: `${label}${form && form !== 'dart' ? ` (${form})` : ''}`, world, device, ratio })
      }
    }
    await context.close()
    console.log(`${label} ${world} ${device}: captured`)
  }
  // The sheet: one row per world and device, columns per build and ratio, 3x shown at full size.
  const columns = [...new Set(shots.map((s) => `${s.label}|${s.ratio}`))].sort((a, b) => Number(a.split('|')[1]) - Number(b.split('|')[1]))
  const rows = [...new Set(shots.map((s) => `${s.world}|${s.device}`))]
  const cell = (row, col) => { const s = shots.find((s) => `${s.world}|${s.device}` === row && `${s.label}|${s.ratio}` === col); return s ? `<td><img src="file://${resolve(out, s.name + '.png')}" style="width:${s.ratio === 3 ? 'auto' : 'auto'}"></td>` : '<td></td>' }
  const html = `<html><body style="margin:0;background:#11161c;color:#dfe9f2;font:14px system-ui"><table cellspacing="8">
    <tr><th></th>${columns.map((c) => `<th>${c.split('|')[0]} · ${c.split('|')[1]}x</th>`).join('')}</tr>
    ${rows.map((r) => `<tr><th style="writing-mode:vertical-rl">${r.replace('|', ' · ')}</th>${columns.map((c) => cell(r, c)).join('')}</tr>`).join('')}
  </table></body></html>`
  await writeFile(`${out}/sheet.html`, html)
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(`file://${resolve(out, 'sheet.html')}`)
  await page.screenshot({ path: `${out}/sheet.png`, fullPage: true })
  console.log(`minimap-sheet: ${out}/sheet.png`)
} finally { await browser.close() }
