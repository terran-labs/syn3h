// Loads the real game in Chromium and checks the adaptive score is the default music, plays
// in the lobby, reacts to play and combat, and that a recording can still be selected.
//   node tests/audio/score-game.mjs [http://127.0.0.1:5188]
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${origin}/?room=score-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 25, null, { timeout: 90000 })
  await page.evaluate(() => syn3h.audio.unlock())
  await page.waitForFunction(() => syn3h.audio.state === 'running')
  await page.waitForTimeout(2500)
  const lobby = await page.evaluate(() => ({ track: syn3h.audio.track, ...syn3h.audio.diagnostics.score, errors: syn3h.audio.errors, requests: performance.getEntriesByType('resource').filter(r => /\.mp3/.test(r.name)).map(r => r.name.split('/').pop()) }))
  console.log('lobby', lobby)
  assert.equal(lobby.track, 'Score'); assert.equal(lobby.playing, true); assert.ok(lobby.mood.intensity < 0.05)
  assert.ok(!lobby.requests.includes('SpaceStation.mp3'), 'the default music must not download a recording')
  // In play, with shots landing nearby, the mood must heat up and the harmony must darken.
  await page.evaluate(() => { syn3h.audio.enabled = true })
  for (let i = 0; i < 12; i++) { await page.evaluate(() => syn3h.audio.play('laserHit')); await page.waitForTimeout(250) }
  await page.waitForTimeout(6000)
  const fight = await page.evaluate(() => syn3h.audio.diagnostics.score)
  console.log('fight', fight)
  assert.ok(fight.mood.heat > 0.4 && fight.mood.intensity > 0.5, 'combat should drive the score')
  assert.ok(['harmonic', 'phrygian'].includes(fight.mode), `combat should darken the mode, got ${fight.mode}`)
  assert.ok(fight.tempo > lobby.tempo + 10)
  // A recording still works and silences the score.
  await page.evaluate(() => syn3h.audio.setTrack('Classic'))
  assert.equal(await page.evaluate(() => syn3h.audio.diagnostics.score.playing), false)
  await page.evaluate(() => syn3h.audio.setTrack('Score'))
  assert.equal(await page.evaluate(() => syn3h.audio.diagnostics.score.playing), true)
  assert.deepEqual(errors, [])
  console.log('score in game ok')
} finally { await browser.close() }
