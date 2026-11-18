/**
 * The release check behind the owner's rule of 15 November 2026: no recorded audio and no
 * unrequired bitmaps ship (tools/check-shipped-assets.mjs). The Orchestrator runs the script
 * against the built site in the release gate; this keeps the script honest and keeps audio
 * files out of the static folder between releases.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
// @ts-expect-error A plain Node script, shared with the release gate.
import { AUDIO, findForbidden } from '../../tools/check-shipped-assets.mjs'

const dir = mkdtempSync(join(tmpdir(), 'syn3h-shipped-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const put = (path: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), 'x') }
const run = (...args: string[]) => spawnSync(process.execPath, ['tools/check-shipped-assets.mjs', ...args], { encoding: 'utf8' })

it('passes a site that ships only code, vectors, fonts and the required bitmaps', () => {
  for (const path of ['index.html', 'assets/app.js', 'brand/favicon.svg', 'brand/icon-192.png', 'brand/share.png', 'fonts/barlow-400-latin.woff2', 'models/jet.glb']) put(path)
  expect(findForbidden(dir)).toEqual({ audio: [], images: [], waived: [] })
  expect(run(dir).status).toBe(0)
})

it('fails on any audio file and any bitmap no platform requires, and names them', () => {
  put('audio/SpaceStation.mp3'); put('assets/Wind.WAV'); put('models/textures/armor-scales.jpg')
  const found = findForbidden(dir)
  expect(found.audio.map((f: { path: string }) => f.path).sort()).toEqual(['assets/Wind.WAV', 'audio/SpaceStation.mp3'])
  expect(found.images.map((f: { path: string }) => f.path)).toEqual(['models/textures/armor-scales.jpg'])
  const result = run(dir)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('audio/SpaceStation.mp3'); expect(result.stderr).toContain('models/textures/armor-scales.jpg')
})

it('lets the Welcome pictures through, and nothing else in their folder', () => {
  const pictures = mkdtempSync(join(tmpdir(), 'syn3h-welcome-'))
  try {
    for (const path of ['welcome/lava-night-640.webp', 'welcome/lava-night-1280.webp', 'welcome/lava-night.jpg', 'welcome/big-3840.webp', 'other/lava-night-640.webp']) {
      mkdirSync(join(pictures, path, '..'), { recursive: true }); writeFileSync(join(pictures, path), 'x')
    }
    expect(findForbidden(pictures).images.map((f: { path: string }) => f.path).sort()).toEqual(['other/lava-night-640.webp', 'welcome/big-3840.webp', 'welcome/lava-night.jpg'])
  } finally { rmSync(pictures, { recursive: true, force: true }) }
})

it('a waiver lets one named file through and says so; audio still fails', () => {
  const result = run(dir, '--allow', 'models/textures/armor-scales.jpg')
  expect(result.status).toBe(1)
  expect(result.stdout).toContain('waived by --allow'); expect(result.stderr).not.toContain('armor-scales.jpg')
})

it('no audio file is tracked anywhere in the repository', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((f) => AUDIO.test(f))
  expect(tracked, `Recorded audio does not ship. Synthesise it (src/audio):\n${tracked.join('\n')}`).toEqual([])
})

it('no audio data is embedded in source either', () => {
  let sources: string[] = []
  try {
    sources = execFileSync('git', ['grep', '-lIE', 'data:audio/[a-z0-9.+-]+;base64,', '--', 'src', 'shared', 'server', 'index.html'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches, which is the passing case.
    if ((error as { status?: number }).status !== 1) throw error
  }
  expect(sources).toEqual([])
})
