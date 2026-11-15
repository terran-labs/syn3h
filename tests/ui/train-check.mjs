import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const out = 'output/playwright/ux-train'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${process.env.SYN3H_URL}?room=ux-train-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.audio, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  assert.deepEqual(await page.locator('#game-mode option').allTextContents(), ['Tag game', 'King of the Hill', 'Explore'])
  assert.equal(await page.locator('.wi-vehicle-select').getAttribute('aria-label'), 'Vehicle')
  await page.screenshot({ path: `${out}/lobby-desktop.png` })
  const result = await page.evaluate(async () => {
    const { Engine } = await import('/src/audio/Engine.ts')
    const levels = []
    for (const kind of ['buggy-syn3h', 'jet', 'hovercraft', 'tank']) {
      const ctx = new OfflineAudioContext(1, 44100 * 2, 44100)
      const engine = new Engine(ctx, ctx.destination)
      const motion = { kind, speed: 35, throttle: 1, airborne: false, slip: 8, wings: true }
      engine.update(motion)
      const mute = ctx.suspend(.5).then(() => { engine.update({ ...motion, zorbed: true }); return ctx.resume() })
      const resume = ctx.suspend(1.2).then(() => { engine.update(motion); return ctx.resume() })
      const buffer = await ctx.startRendering(); await Promise.all([mute, resume])
      const data = buffer.getChannelData(0)
      const rms = (a,b) => { let sum=0; for(let i=Math.floor(a*44100);i<b*44100;i++)sum+=data[i]**2; return Math.sqrt(sum/((b-a)*44100)) }
      levels.push({ kind, before:rms(.3,.45), muted:rms(.8,1.1), after:rms(1.5,1.8) })
      engine.dispose(true)
    }
    const audio = syn3h.audio, cues = [], impacts = []
    const originalCue = audio.cue, originalImpact = audio.impact, enabled = audio.enabled, terrain = audio.terrain
    const vehicle = { object: {position: {x:0,y:0,z:0}}, wingsOpen:false, landedThisStep:false, landingImpact:12, zorbed:false }
    try {
      audio.enabled=true; audio.terrain=undefined
      audio.cue=name=>cues.push(name); audio.impact=strength=>impacts.push(strength)
      audio.vehicleEvents(vehicle)
      vehicle.zorbed=true; vehicle.wingsOpen=true; vehicle.landedThisStep=true; audio.vehicleEvents(vehicle)
      vehicle.zorbed=false; audio.vehicleEvents(vehicle)
      const mutedEvents={cues:[...cues],impacts:[...impacts]}
      vehicle.wingsOpen=false; vehicle.landedThisStep=false; audio.vehicleEvents(vehicle)
      return {levels,mutedEvents,cues,impacts}
    } finally { audio.cue=originalCue; audio.impact=originalImpact; audio.enabled=enabled; audio.terrain=terrain; audio.events.delete(vehicle) }
  })
  for(const level of result.levels) { assert.ok(level.before>.0001); assert.equal(level.muted,0); assert.ok(level.after>.0001) }
  assert.deepEqual(result.mutedEvents,{cues:[],impacts:[]})
  assert.deepEqual(result.cues,['retract'])
  await writeFile(`${out}/audio.json`,JSON.stringify(result,null,2))
  console.log('Mode gating, label, four vehicle audio fades, cue suppression and resume passed',result)
} finally { await browser.close() }
