// Screenshots of the World card's day length control (desktop and phone) and of the sky at four
// hours on an inner and an outer planet. MIRA_URL=http://127.0.0.1:PORT/ node tests/ui/day-length-capture.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/day-length'
await mkdir(out, { recursive: true })
for (const mode of ['desktop', 'phone']) {
  const browser = await (mode === 'phone' ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(mode === 'phone' ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.MIRA_URL}?autoplay=1&room=daylen-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden' })
    const live = await page.evaluate(async () => {
      const d = await import('/src/world/sky/dayCycle.ts'), { params } = await import('/shared/params.ts')
      const a = d.currentHour(); await new Promise(r => setTimeout(r, 2000)); const b = d.currentHour()
      return { planet: (await import('/src/world/planets.ts')).currentPlanet().id, setting: params.get('sun.dayLength').value, day: d.effectiveDayLength(), hourA: a, hourB: b, perSecond: (b - a) / 2 }
    })
    console.log(JSON.stringify({ mode, live }))
    const rail = page.locator('.world-inspector')
    if (mode === 'phone' && !await rail.isVisible()) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await rail.waitFor({ state: 'visible' })
    const shoot = async (name) => {
      await page.evaluate(() => { mira.shell.inspector.revealCard('world'); const f = document.querySelector('.wi-card[data-section=world] [data-group="Sun"]'); if (f) f.open = true })
      const row = rail.locator('[data-id="sun.dayLength"]')
      await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
      await page.screenshot({ path: `${out}/${mode}-${name}.png` })
      console.log(JSON.stringify({ mode, name, text: (await row.innerText()).replace(/\s+/g, ' ') }))
    }
    await shoot('card-orbit')
    await page.evaluate(async () => (await import('/shared/params.ts')).params.set('sun.dayLength', 1200))
    await shoot('card-override')
    await page.evaluate(async () => (await import('/shared/params.ts')).params.set('sun.dayLength', -1))
    if (mode === 'desktop') {
      // Close the panels for the sky.
      await page.evaluate(() => document.querySelector('.world-inspector')?.setAttribute('hidden', ''))
      for (const planet of ['volcanic', 'ice']) {
        for (const hour of [6, 12, 18, 0]) {
          await page.evaluate(async ({ planet, hour }) => {
            const { applyPlanet } = await import('/src/world/planets.ts'), { params } = await import('/shared/params.ts')
            params.set('bots.count', 0); applyPlanet(planet, 12345); params.set('sun.dayLength', 0); params.set('sun.timeOfDay', hour)
          }, { planet, hour })
          await page.waitForTimeout(hour === 6 ? 6000 : 2500)
          await page.screenshot({ path: `${out}/sky-${planet}-${String(hour).padStart(2, '0')}h.png` })
        }
      }
      const tips = await page.evaluate(() => [...document.querySelectorAll('.galaxy-label')].map(c => `${c.dataset.world}: ${c.title.split('.').find(s => s.includes('day')) ?? c.title}`))
      console.log(JSON.stringify({ tips }))
    }
    console.log(JSON.stringify({ mode, errors }))
  } finally { await browser.close() }
}
