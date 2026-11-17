// node --test tools/showcase.test.mjs
// Pure parts of the release showcase. vite.config.ts excludes tools/** from vitest.
// Invariants only: a capture is a real picture, the manifest names what was captured, and the
// README block shows the version it really comes from. Shot staging and composition are
// checked by running the tool and looking at the pictures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_LIMITS, README_END, README_START, SHOTS, SHOT_IDS, assetNames, buildManifest, frameStats, frozenIdFor,
  hudModeOf, judgeFrame, missingFeature, parseArgs, renderReadmeSection, replaceReadmeSection, sceneRoom, sceneUrl, selectShots,
} from './lib/showcase-scenes.mjs'

const solid = (r, g, b, n = 1000) => Buffer.from(Array.from({ length: n }, () => [r, g, b]).flat())
const noise = (n = 4000, seed = 1) => {
  let x = seed
  const next = () => (x = (x * 1103515245 + 12345) % 2147483648) % 256
  return Buffer.from(Array.from({ length: n * 3 }, next))
}

test('a black, blank or single colour frame is rejected; a real picture passes', () => {
  assert.equal(judgeFrame(frameStats(solid(0, 0, 0)), FRAME_LIMITS).ok, false)
  assert.equal(judgeFrame(frameStats(solid(255, 255, 255)), FRAME_LIMITS).ok, false)
  assert.equal(judgeFrame(frameStats(solid(200, 80, 40)), FRAME_LIMITS).ok, false)
  assert.equal(judgeFrame(frameStats(noise()), FRAME_LIMITS).ok, true)
})

test('shot ids are unique and every shot can be opened', () => {
  assert.equal(new Set(SHOT_IDS).size, SHOT_IDS.length)
  for (const shot of SHOTS) {
    const url = new URL(sceneUrl('http://127.0.0.1:5348/', shot, 'run1'))
    assert.equal(url.searchParams.get('room'), sceneRoom(shot.id, 'run1'))
    assert.equal(url.searchParams.get('autoplay'), shot.hud === 'lobby' ? null : '1', shot.id)
  }
  assert.throws(() => selectShots(['no-such-shot']))
})

test('gameplay shows the driving interface; the hidden interface is only ever an extra', () => {
  for (const shot of SHOTS) {
    if (shot.hud === 'hidden') assert.equal(shot.extra, true, shot.id)
    if (shot.hud !== 'lobby') assert.ok(shot.requires?.includes('param:hud.mode'), shot.id)
  }
  assert.equal(hudModeOf({ hud: 'driving' }), 1)
  assert.equal(hudModeOf({ hud: 'hidden' }), 2)
  // A build without the interface setting skips gameplay shots rather than showing the panels.
  assert.match(missingFeature(SHOTS.find((s) => s.hud === 'driving'), { params: [] }), /hud.mode/)
})

test('the manifest names what was captured and what was skipped, with the reason', () => {
  const captured = [{ id: 'lobby', files: assetNames(SHOTS[0]) }]
  const skipped = [{ id: 'swamp-river', reason: 'build lacks planet:swamp' }]
  const m = buildManifest({ version: 'v1', build: { id: 'b', commit: 'c' }, captured, skipped, browser: {}, generatedAt: 'now', seconds: 1 })
  assert.equal(m.version, 'v1')
  assert.deepEqual(m.captured.map((c) => c.id), ['lobby'])
  assert.deepEqual(m.skipped, skipped)
})

test('the README block shows the version it comes from and links each picture to its original', () => {
  const still = { ...SHOTS.find((s) => s.id === 'canyon-convoy'), files: assetNames(SHOTS.find((s) => s.id === 'canyon-convoy')) }
  const clip = { ...SHOTS.find((s) => s.kind === 'clip'), files: assetNames(SHOTS.find((s) => s.kind === 'clip')) }
  const block = renderReadmeSection({ repo: 'o/r', version: 'v26.11.1700', captured: [still, clip] })
  assert.match(block, /Captured from v26\.11\.1700/)
  assert.ok(block.includes(`<a href="https://github.com/o/r/releases/download/v26.11.1700/${still.files.full}"><img src="https://github.com/o/r/releases/download/v26.11.1700/${still.files.readme}"`))
  assert.ok(block.includes(`releases/download/v26.11.1700/${clip.files.webp}`))
  const readme = `# T\n\nintro\n\n${README_START}\nold\n${README_END}\n\n## Next\n`
  const out = replaceReadmeSection(readme, block)
  assert.ok(out.startsWith('# T\n\nintro\n\n') && out.endsWith('\n\n## Next\n'))
  assert.ok(!out.includes('\nold\n'))
  assert.throws(() => replaceReadmeSection('# no markers', block))
})

test('a release version resolves to its frozen build; a withdrawn version does not', () => {
  const history = 'v1.04\tm\tac43ce67\t2026\twithdrawn\nv1.05\tm\t17a973a2\t2026\tproduction\n'
  const releases = 'release-28\twhen\turl\tm\t17a973a2\tworker\t20261116-120923-17a973a2\n'
  assert.equal(frozenIdFor('v1.05', history, releases), '20261116-120923-17a973a2')
  assert.throws(() => frozenIdFor('v1.04', history, releases))
})

test('argument parser accepts pairs and flags and rejects unknown names', () => {
  assert.deepEqual(parseArgs(['--version', 'v1', '--publish'], ['version', 'publish']), { version: 'v1', publish: true })
  assert.throws(() => parseArgs(['--verison', 'v1'], ['version']))
})
