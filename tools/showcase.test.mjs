// node --test tools/showcase.test.mjs
// Pure parts of the release showcase. vite.config.ts excludes tools/** from vitest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_LIMITS, MAX_GIF_BYTES, SCENES, SCENE_IDS, buildManifest, concatScript, frameStats,
  gifArgs, judgeFrame, missingFeature, parseArgs, sceneRoom, sceneUrl,
} from './lib/showcase-scenes.mjs'

const solid = (r, g, b, n = 1000) => Buffer.from(Array.from({ length: n }, () => [r, g, b]).flat())
const noise = (n = 4000, seed = 1) => {
  let x = seed
  const next = () => (x = (x * 1103515245 + 12345) % 2147483648) % 256
  return Buffer.from(Array.from({ length: n * 3 }, next))
}

test('scene list is the agreed order with unique ids and fixed seeds', () => {
  assert.deepEqual(SCENE_IDS, [
    'lobby', 'buggy-volcano', 'wings-glide', 'bots-pursuit', 'tag-beam',
    'jet-flight', 'hovercraft-lava', 'lava-night', 'king-of-the-hill', 'other-world',
  ])
  for (const scene of SCENES) assert.ok(Number.isInteger(scene.seed), scene.id)
})

test('scene titles keep to the wording rule', () => {
  const banned = /\b(laser|lasers|fire|shoot|weapon|hit|kill|death|dead)\b/i
  for (const scene of SCENES) assert.doesNotMatch(scene.title, banned, scene.id)
})

test('each scene gets its own room per run', () => {
  const rooms = SCENES.map((s) => sceneRoom(s.id, 'Run 42!'))
  assert.equal(new Set(rooms).size, rooms.length)
  assert.equal(sceneRoom('lobby', 'Run 42!'), 'showcase-lobby-run42')
  assert.ok(rooms.every((r) => r.length <= 40 && /^[a-z0-9-]+$/.test(r)))
})

test('scene urls carry room, seed, planet and vehicle; only gameplay autoplays', () => {
  const lobby = new URL(sceneUrl('http://127.0.0.1:5348/', SCENES[0], 'x'))
  assert.equal(lobby.searchParams.get('autoplay'), null)
  assert.equal(lobby.searchParams.get('seed'), '7')
  const jet = new URL(sceneUrl('http://127.0.0.1:5348/', SCENES.find((s) => s.id === 'jet-flight'), 'x'))
  assert.equal(jet.searchParams.get('vehicle'), 'jet')
  assert.equal(jet.searchParams.get('planet'), 'volcanic')
  assert.equal(jet.searchParams.get('autoplay'), '1')
  assert.equal(jet.searchParams.get('room'), 'showcase-jet-flight-x')
})

test('missing features skip a scene with a reason', () => {
  const all = { params: ['sun.timeOfDay', 'bots.count', 'laser.speed', 'game.mode'], vehicles: [], planets: ['volcanic', 'desert'], net: true, cinematic: true }
  const bots = SCENES.find((s) => s.id === 'bots-pursuit')
  assert.equal(missingFeature(bots, all), null)
  assert.equal(missingFeature(bots, { ...all, params: [] }), 'build lacks param:bots.count')
  assert.equal(missingFeature(bots, { ...all, cinematic: false }), 'build lacks camera:cinematic')
  const hill = SCENES.find((s) => s.id === 'king-of-the-hill')
  assert.equal(missingFeature(hill, { ...all, net: false }), 'build lacks net')
  assert.equal(missingFeature({ requires: ['planet:alpine'] }, all), 'build lacks planet:alpine')
  assert.equal(missingFeature({ requires: ['mystery:x'] }, all), 'build lacks mystery:x')
})

test('frame statistics reject black, flat and single colour frames', () => {
  assert.match(judgeFrame(frameStats(solid(0, 0, 0))).reason, /too dark/)
  assert.match(judgeFrame(frameStats(solid(120, 60, 30))).reason, /too flat/)
  // Two colours far apart in luma: not flat, but nearly all one bucket.
  const mostly = Buffer.concat([solid(200, 200, 200, 950), solid(0, 0, 0, 50)])
  assert.match(judgeFrame(frameStats(mostly)).reason, /nearly one colour/)
  const ok = judgeFrame(frameStats(noise()))
  assert.deepEqual(ok, { ok: true, reason: null })
})

test('frame statistics measure luma and buckets', () => {
  const s = frameStats(Buffer.concat([solid(255, 255, 255, 500), solid(0, 0, 0, 500)]))
  assert.equal(s.meanLuma, 127.5)
  assert.equal(s.lumaStdDev, 127.5)
  assert.equal(s.dominantShare, 0.5)
  assert.equal(s.colourBuckets, 2)
  assert.throws(() => frameStats(Buffer.alloc(0)), /Empty frame/)
})

test('a scene may relax a limit without changing the default', () => {
  const dim = { meanLuma: 9, lumaStdDev: 30, dominantShare: 0.4, colourBuckets: 60 }
  assert.equal(judgeFrame(dim).ok, false)
  assert.equal(judgeFrame(dim, { ...FRAME_LIMITS, ...SCENES[0].limits }).ok, true)
})

test('concat script holds each still once, the last included', () => {
  assert.equal(concatScript(['/o/a.png', '/o/b.png'], 1.5),
    "file '/o/a.png'\nduration 1.5\nfile '/o/b.png'\nduration 1.5\n")
  assert.throws(() => concatScript([]), /No stills/)
  assert.throws(() => concatScript(["/o/it's.png"]), /Unsafe/)
})

test('gif arguments loop forever and use a generated palette at 960 x 540', () => {
  const args = gifArgs({ list: '/o/l.txt', output: '/o/x.gif' })
  const filter = args[args.indexOf('-filter_complex') + 1]
  assert.match(filter, /scale=960:540/)
  assert.match(filter, /palettegen/)
  assert.match(filter, /paletteuse/)
  assert.equal(args[args.indexOf('-loop') + 1], '0')
  assert.equal(args.at(-1), '/o/x.gif')
  assert.equal(MAX_GIF_BYTES, 10485760)
})

test('manifest records build identity, files sorted, and skips with reasons', () => {
  const m = buildManifest({
    version: 'v26.11.1401', hold: 1.5, generatedAt: 't', browser: { headless: false },
    build: { id: 'b', commit: 'c', note: 'n' },
    files: [{ file: 'z.png', bytes: 1, sha256: 'a' }, { file: 'a.gif', bytes: 2, sha256: 'b' }],
    captured: [{ id: 'lobby' }, { id: 'jet-flight' }],
    skipped: [{ id: 'wings-glide', reason: 'build lacks param:liquid.wingLift' }],
  })
  assert.equal(m.commit, 'c')
  assert.equal(m.buildId, 'b')
  assert.deepEqual(m.files.map((f) => f.file), ['a.gif', 'z.png'])
  assert.deepEqual(m.gif.order, ['lobby.png', 'jet-flight.png'])
  assert.equal(m.skipped[0].reason, 'build lacks param:liquid.wingLift')
})

test('argument parser accepts pairs and flags and rejects unknown names', () => {
  assert.deepEqual(parseArgs(['--version', 'v1', '--headless'], ['version', 'headless']), { version: 'v1', headless: true })
  assert.throws(() => parseArgs(['--vresion', 'v1'], ['version']), /Unknown option/)
  assert.throws(() => parseArgs(['v1'], ['version']), /Unexpected argument/)
})
