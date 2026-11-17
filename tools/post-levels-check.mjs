/**
 * Which post effects exist at each of the six quality levels, in the real game. Functional
 * only: no timings. Run serially through tools/heavy.sh.
 *
 *   tools/heavy.sh node tools/post-levels-check.mjs URL OUTPUT_DIR [--webgl]
 *
 * The quality level owns the tier and, through each strength, which effects exist; the post
 * chain follows. For every level this sets the level as a player
 * would, lets the chain settle and asserts:
 *
 *   tier      the chain's tier equals the level's (off, base, lite, lite, full, full).
 *   effects   exactly the effects whose strength is above 0 are in the pipeline, and none
 *             on off or base.
 *   rebuild   the chain builds at most once for the change and never while nothing changes.
 *   budget    with the governor's post budget spent the chain falls to the look alone, and
 *             returns when the budget does.
 *
 * WebGL starts at Medium and limits automatic climbs to it; manual choices still test all six.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [base, out] = process.argv.slice(2)
assert.ok(base && out, 'URL and output directory required')
mkdirSync(out, { recursive: true })
const webgl = process.argv.includes('--webgl')
const TIER = ['off', 'base', 'lite', 'lite', 'full', 'full']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { backend: null, ceiling: null, levels: [], budget: null, errors: [] }
let failure = null
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('room', `post-levels-${Date.now()}`)
  if (webgl) url.searchParams.set('webgl', '1')
  await page.goto(url.href, { timeout: 120000 })
  await page.waitForFunction(() => window.syn3h?.game?.tick > 150, null, { timeout: 120000 })
  const start = await page.evaluate(() => {
    const s = window.syn3h, q = s.game.quality
    s.params.set('bots.count', 0); s.params.set('sun.dayLength', 0); s.params.set('sun.timeOfDay', 15)
    q.setAuto(false)
    // A pinned level still lets the governor fade and shed the post budget when frames are
    // slow, as headless frames are. Hold it full here; the budget case below sets it itself.
    window.__budget = 1
    Object.defineProperty(q, 'postBudget', { configurable: true, get: () => window.__budget })
    return { backend: s.game.backend, ceiling: q.getQualityState().ceiling }
  })
  Object.assign(report, start)
  if (webgl) { assert.equal(report.backend, 'webgl'); assert.equal(report.ceiling, 2, 'WebGL automatic ceiling is Medium') }
  const read = () => page.evaluate(() => {
    const s = window.syn3h, g = s.game, c = g.postChain, b = c.built
    const v = id => s.params.get(id)?.value
    const [, tier, motion, compose, glow, shafts, flare, ao, gi, clouds, temporal] = (b?.key ?? '').split('|')
    const on = x => x === 'true'
    return {
      level: g.quality.getQualityState().level, allowed: g.quality.postTier, tier: c.tier, builds: c.builds, keyTier: tier ?? null,
      built: { motion: on(motion), compose: on(compose), glow: on(glow), shafts: on(shafts), flare: on(flare), ao: on(ao), gi: on(gi), clouds: on(clouds), temporal: on(temporal), contact: !!b?.sssNode },
      wanted: { motion: v('post.motionBlur') > 0, compose: v('post.motionBlur') > 0 || v('post.heat') > 0, glow: v('post.bloom') > 0, shafts: v('post.shafts') > 0 || v('post.flare') > 0,
        flare: v('post.flare') > 0, ao: v('post.ao') > 0, gi: v('post.gi') > 0, temporal: !!v('post.temporal'), contact: v('post.contact') > 0, cloudsStrength: v('post.clouds') > 0 },
      on: v('post.on'),
    }
  })
  for (let level = 0; level <= 5; level++) {
    const before = await read()
    await page.evaluate(level => window.syn3h.game.quality.setLevel(level), level)
    await page.waitForTimeout(2500)
    const settled = await read()
    await page.waitForTimeout(2500)
    const later = await read()
    await page.screenshot({ path: `${out}/level-${level}.png` })
    const row = { level, before: before.builds, settled, laterBuilds: later.builds }
    report.levels.push(row)
    assert.equal(settled.level, level, `level ${level} applied`)
    assert.equal(settled.allowed, TIER[level], `level ${level} allows ${TIER[level]}`)
    assert.equal(settled.tier, TIER[level], `chain tier at level ${level}`)
    assert.ok(settled.builds - before.builds <= 1, `at most one rebuild entering level ${level} (${settled.builds - before.builds})`)
    assert.equal(later.builds, settled.builds, `no rebuild while level ${level} is steady`)
    if (TIER[level] === 'off') continue
    const effects = TIER[level] === 'lite' || TIER[level] === 'full'
    for (const name of ['motion', 'compose', 'glow', 'shafts', 'flare', 'ao', 'gi', 'temporal', 'contact']) {
      // Contact shadows also need a shadow-casting sun in the scene; only its absence is asserted on.
      if (name === 'contact' && effects && settled.wanted.contact) continue
      assert.equal(settled.built[name], effects && settled.wanted[name], `${name} at level ${level}`)
    }
    // Clouds also need weather to supply cover; strength 0 or a tier without effects must remove them.
    if (!effects || !settled.wanted.cloudsStrength) assert.equal(settled.built.clouds, false, `clouds at level ${level}`)
  }
  // Budget: spend it, expect the look alone; return it, expect the level's tier back.
  const top = Math.min(report.ceiling, 4)
  if (TIER[top] === 'lite' || TIER[top] === 'full') {
    await page.evaluate(top => { window.syn3h.game.quality.setLevel(top); window.__budget = 0 }, top)
    await page.waitForTimeout(1500); const spent = await read()
    await page.evaluate(() => { window.__budget = 1 })
    await page.waitForFunction(tier => window.syn3h.game.postChain.tier === tier, TIER[top], { timeout: 30000 }); const back = await read()
    report.budget = { top, spent: spent.tier, back: back.tier }
    assert.equal(spent.tier, 'base', 'a spent budget leaves the look alone')
    assert.equal(back.tier, TIER[top], 'the tier returns with the budget')
  }
  assert.deepEqual(report.errors, [], 'no page or GPU errors')
} catch (error) { failure = String(error?.stack ?? error); process.exitCode = 1 }
finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, failure }, null, 2))
  console.log(JSON.stringify({ backend: report.backend, ceiling: report.ceiling, failure, errors: report.errors.slice(0, 5), budget: report.budget,
    levels: report.levels.map(l => l.skipped ? l : { level: l.level, tier: l.settled.tier, rebuilds: l.settled.builds - l.before, built: Object.entries(l.settled.built).filter(([, v]) => v).map(([k]) => k) }) }, null, 1))
  await browser.close()
}
