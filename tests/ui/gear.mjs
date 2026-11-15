// Gear chip, help lines and the Bungee's touch buttons. Desktop Chrome and a WebKit iPhone.
// Needs the dev servers from tests/ui/README.md (5187 and 8797). Run through tools/heavy.sh.
import { chromium, devices, webkit } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const out = new URL('./artifacts/gear/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const errors = [], results = {}
const enter = async (page, name) => {
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`))
  await page.goto(`http://127.0.0.1:5187/?room=gear-${name}-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('.syn3h-shell')?.classList.contains('is-playing') && window.syn3hNet?.connected, null, { timeout: 120000 })
  await page.waitForTimeout(1200)
}
const chip = (page) => page.evaluate(() => { const c = document.querySelector('.gear-chip'); return { hidden: c.hidden, text: c.textContent } })
const need = (ok, what) => { if (!ok) errors.push(what) }

// Desktop: the chip appears only when the host allows two kinds of gear, and switches on click and T.
const chrome = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
{
  const page = await chrome.newPage({ viewport: { width: 1280, height: 800 } })
  await enter(page, 'desktop')
  const id = await page.evaluate(() => syn3h.params.all().find(p => /bungee/i.test(p.def.id) && typeof p.value === 'boolean' && /allow|enable|bungee$/i.test(p.def.id))?.def.id)
  results.param = id
  await page.evaluate((id) => syn3h.params.set(id, false), id); await page.waitForTimeout(300)
  need((await chip(page)).hidden, 'chip shows with one gear')
  await page.evaluate((id) => syn3h.params.set(id, true), id); await page.waitForTimeout(300)
  const one = await chip(page); need(!one.hidden && one.text === 'Gear: Tag beam', `chip ${JSON.stringify(one)}`)
  await page.evaluate(() => document.querySelector('.gear-chip').click()); await page.waitForTimeout(200)
  const two = await chip(page); need(two.text === 'Gear: Bungee', `after click ${JSON.stringify(two)}`)
  await page.keyboard.press('t'); await page.waitForTimeout(200)
  need((await chip(page)).text === 'Gear: Tag beam', 'T does not switch the chip')
  await page.keyboard.press('h'); await page.waitForTimeout(400)
  const help = await page.evaluate(() => document.querySelector('.spawn-help')?.textContent ?? '')
  need(/T: switch gear/.test(help) && /LB: let out/.test(help), `help lacks gear lines: ${help.slice(0, 200)}`)
  await page.screenshot({ path: `${out}desktop.png` })
  for (const cue of ['bungeeLaunch', 'bungeeAttach', 'bungeeRelease']) await page.evaluate((cue) => syn3h.audio.cue(cue), cue)
  results.desktop = two
}
await chrome.close()

// Phone: LET OUT and LET GO appear only while a cord is attached; LET GO drops it; LET OUT holds V.
const safari = await webkit.launch()
{
  const context = await safari.newContext({ ...devices['iPhone 14 landscape'] }), page = await context.newPage()
  await enter(page, 'iphone')
  const shown = () => page.evaluate(() => ['letOut', 'letGo'].map(a => !document.querySelector(`.touch-controls [data-action="${a}"]`).hidden))
  need((await shown()).every(v => !v), 'cord buttons show with no cord')
  // Stand in for an attached cord: the real one needs a target and physics time.
  await page.evaluate(() => { window.gearProbe = { let: 0, keys: [] }; const b = syn3hNet.bungee; Object.defineProperty(b, 'attached', { get: () => window.gearProbe.let === 0, configurable: true }); b.letGo = () => { window.gearProbe.let++ }; addEventListener('keydown', e => window.gearProbe.keys.push('down ' + e.code)); addEventListener('keyup', e => window.gearProbe.keys.push('up ' + e.code)) })
  await page.waitForTimeout(400)
  need((await shown()).every(Boolean), 'cord buttons hidden with a cord attached')
  const fits = await page.evaluate(() => [...document.querySelectorAll('.touch-controls button:not([hidden])')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width >= 40 && r.height >= 40 }))
  need(fits, 'touch buttons off screen or too small')
  await page.screenshot({ path: `${out}iphone-cord.png` })
  const box = await page.locator('.touch-controls [data-action="letOut"]').boundingBox()
  await page.locator('.touch-controls [data-action="letOut"]').tap(); await page.waitForTimeout(200)
  await page.locator('.touch-controls [data-action="letGo"]').tap(); await page.waitForTimeout(400)
  const probe = await page.evaluate(() => window.gearProbe)
  // Pointer up and losing capture both release; a second key up is harmless.
  need(probe.keys[0] === 'down KeyV' && probe.keys.at(-1) === 'up KeyV' && probe.keys.filter(k => k.startsWith('down')).length === 1, `LET OUT keys ${probe.keys.join()}`)
  need(probe.let === 1, `LET GO called ${probe.let} times`)
  need((await shown()).every(v => !v), 'cord buttons stay after letting go')
  results.iphone = { probe, box: Boolean(box) }
  await context.close()
}
await safari.close()
console.log(JSON.stringify({ ok: !errors.length, results, errors }))
process.exit(errors.length ? 1 : 0)
