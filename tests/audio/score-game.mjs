// Checks the generated score in the game: default layers, the lobby state, how play drives it, and that choices persist.
//   node tests/audio/score-game.mjs [http://127.0.0.1:5188]
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const origin = (process.argv[2] ?? process.env.SYN3H_URL ?? 'http://127.0.0.1:5188').replace(/\/$/, '')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${origin}/?room=score-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 25, null, { timeout: 90000 })
  const preferences = await page.evaluate(async () => {
    const { scoreTagNotes, scoreConvoy, scoreTerrain, scoreWeather } = await import('/src/audio/score/Score.ts')
    const layers = [scoreTagNotes, scoreConvoy, scoreTerrain, scoreWeather].map(p => p.value)
    return { layers }
  })
  assert.deepEqual(preferences.layers, [true, true, true, true])
  await page.evaluate(() => syn3h.audio.unlock())
  await page.waitForFunction(() => syn3h.audio.state === 'running')
  await page.waitForTimeout(2500)
  const lobby = await page.evaluate(() => ({ ...syn3h.audio.diagnostics.score, errors: syn3h.audio.errors, requests: performance.getEntriesByType('resource').filter(r => /\.(mp3|wav|ogg)$/.test(r.name)).map(r => r.name.split('/').pop()) }))
  console.log('lobby', lobby)
  assert.equal(lobby.playing, true); assert.ok(lobby.mood.intensity > 0.1 && lobby.mood.intensity < 0.3, 'the lobby holds its quiet, moving state')
  assert.deepEqual(lobby.requests, [], 'no audio file loads')
  // In play, with shots landing nearby, the mood must heat up and the harmony must darken.
  await page.evaluate(() => { syn3h.audio.enabled = true })
  for (let i = 0; i < 12; i++) { await page.evaluate(() => syn3h.audio.play('laserHit')); await page.waitForTimeout(250) }
  await page.waitForTimeout(6000)
  const fight = await page.evaluate(() => syn3h.audio.diagnostics.score)
  console.log('fight', fight)
  assert.ok(fight.mood.heat > 0.4 && fight.mood.intensity > 0.5, 'combat should drive the score')
  assert.ok(['harmonic', 'phrygian'].includes(fight.mode), `combat should darken the mode, got ${fight.mode}`)
  assert.ok(fight.tempo > lobby.tempo + 4, 'a chase is faster than the lobby, which now keeps a moving pulse of its own')
  await page.evaluate(async () => {
    syn3h.audio.setMuted(true)
    syn3h.params.set('audio.score.convoy', false)
    syn3h.params.set('audio.score.lite', true)
  })
  await page.waitForTimeout(2500)
  const choices = await page.evaluate(() => ({
    muted: syn3h.audio.isMuted,
    convoy: syn3h.params.get('audio.score.convoy').value,
    lite: syn3h.params.get('audio.score.lite').value,
  }))
  assert.deepEqual(choices, { muted: true, convoy: false, lite: true })
  assert.deepEqual(errors, [])
  console.log('score in game ok')
} finally { await browser.close() }
