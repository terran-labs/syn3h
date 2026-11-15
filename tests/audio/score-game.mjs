// Checks the recorded default, persistent choices, and the selectable adaptive score.
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
  assert.equal(await page.evaluate(() => syn3h.audio.track), 'SpaceStation')
  const preferences = await page.evaluate(async () => {
    const { GameAudio } = await import('/src/audio/index.ts')
    const { scoreTagNotes, scoreConvoy, scoreTerrain, scoreWeather } = await import('/src/audio/score/Score.ts')
    const layers = [scoreTagNotes, scoreConvoy, scoreTerrain, scoreWeather].map(p => p.value)
    const restored = []
    for (const choice of ['Score', 'Classic', 'invalid', 'toString']) {
      localStorage.setItem('syn3h.musicTrack', choice)
      const audio = new GameAudio(syn3h.game.camera)
      restored.push(audio.track)
      audio.dispose()
    }
    localStorage.removeItem('syn3h.musicTrack')
    return { layers, restored }
  })
  assert.deepEqual(preferences.layers, [true, true, true, true])
  assert.deepEqual(preferences.restored, ['Score', 'Classic', 'SpaceStation', 'SpaceStation'])
  await page.evaluate(() => syn3h.audio.unlock())
  await page.waitForFunction(() => syn3h.audio.state === 'running')
  assert.equal(await page.evaluate(() => syn3h.audio.diagnostics.score.playing), false)
  await page.evaluate(() => syn3h.audio.setTrack('Score'))
  assert.equal(await page.evaluate(() => localStorage.getItem('syn3h.musicTrack')), 'Score')
  await page.waitForTimeout(2500)
  const lobby = await page.evaluate(() => ({ track: syn3h.audio.track, ...syn3h.audio.diagnostics.score, errors: syn3h.audio.errors, requests: performance.getEntriesByType('resource').filter(r => /\.mp3/.test(r.name)).map(r => r.name.split('/').pop()) }))
  console.log('lobby', lobby)
  assert.equal(lobby.track, 'Score'); assert.equal(lobby.playing, true); assert.ok(lobby.mood.intensity < 0.05)
  assert.ok(lobby.requests.includes('SpaceStation.mp3'), 'the default title recording loads')
  assert.equal(await page.evaluate(() => [...syn3h.audio.decks.values()].every(deck => deck.element.paused)), true, 'recordings stop after the score crossfade')
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
  await page.evaluate(async () => {
    syn3h.audio.setMuted(true)
    syn3h.params.set('audio.score.convoy', false)
    syn3h.params.set('audio.score.lite', true)
    await syn3h.audio.setTrack('Classic')
    await syn3h.audio.setTrack('Score')
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
