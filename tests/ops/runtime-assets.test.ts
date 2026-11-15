/**
 * The runtime asset gate (tools/runtime-assets-check.mjs) enforces the owner's rule of 15
 * November 2026: binary assets may sit in the repository, but the running game must not load
 * them. The browser session itself is too heavy for the unit suite; this keeps its
 * classification and allowlist honest.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error A plain Node script, shared with the release gate.
import { ALLOWLIST, allowed, classify, violations } from '../../tools/runtime-assets-check.mjs'

type Entry = { kind: string; type?: string; pattern: RegExp; why: string; term: string }

describe('classify', () => {
  it('sorts loads by MIME type, then by extension', () => {
    expect(classify('audio/mpeg', '/audio/x')).toBe('audio')
    expect(classify('', '/music/Theme.MP3')).toBe('audio')
    expect(classify('image/png', '/brand/share.png')).toBe('image')
    expect(classify('', '/models/textures/armor.jpg')).toBe('image')
    expect(classify('video/mp4', '/intro')).toBe('video')
    expect(classify('model/gltf-binary', '/models/jet.glb')).toBe('model')
    expect(classify('', '/models/jet.bin')).toBe('model')
    expect(classify('font/woff2', '/fonts/barlow-400-latin.woff2')).toBe('font')
    expect(classify('application/font-woff', '/x')).toBe('font')
  })
  it('treats SVG as a vector and WebAssembly as code, never as binary assets', () => {
    expect(classify('image/svg+xml', '/brand/favicon.svg')).toBe('vector')
    expect(classify('application/wasm', '')).toBe('wasm')
    expect(classify('text/javascript', '/assets/index.js')).toBe('script')
  })
})

describe('allowlist', () => {
  it('gives every entry a reason and a term, permanent or dated', () => {
    for (const entry of ALLOWLIST as Entry[]) {
      expect(entry.why.length).toBeGreaterThan(10)
      expect(entry.term).toMatch(/^(permanent|dated)/)
      expect(entry.pattern).toBeInstanceOf(RegExp)
    }
  })
  it('accepts the Barlow weights and the dated vehicle models only', () => {
    expect(allowed({ kind: 'font', path: '/fonts/barlow-400-latin.woff2' })).toBeTruthy()
    expect(allowed({ kind: 'font', path: '/fonts/barlow-condensed-600-latin.woff2' })).toBeTruthy()
    expect(allowed({ kind: 'font', path: '/fonts/lato-thin.woff2' })).toBeNull()
    expect(allowed({ kind: 'model', path: '/models/jet.glb' })?.term).toMatch(/^dated/)
    expect(allowed({ kind: 'model', path: '/models/textures/jet.bin' })).toBeNull()
  })
  it('lets the browser fetch an icon from the link tag, but not game code', () => {
    expect(allowed({ kind: 'image', type: 'other', path: '/brand/apple-touch-icon.png' })).toBeTruthy()
    expect(allowed({ kind: 'image', type: 'image', path: '/brand/apple-touch-icon.png' })).toBeNull()
    expect(allowed({ kind: 'image', type: 'other', path: '/brand/share.png' })).toBeNull()
  })
})

describe('violations', () => {
  it('fails audio, images, video, unlisted models and fonts, and inlined bitmaps', () => {
    const records = [
      { kind: 'audio', path: '/audio/SpaceStation.mp3' },
      { kind: 'image', path: '', url: 'data:image/png;base64,iVBOR' },
      { kind: 'video', path: '/intro.mp4' },
      { kind: 'font', path: '/fonts/other.woff2' },
      { kind: 'model', path: '/models/jet.glb' },
      { kind: 'font', path: '/fonts/barlow-500-latin.woff2' },
      { kind: 'wasm', path: '' },
      { kind: 'vector', path: '/brand/favicon.svg' },
      { kind: 'image', path: '', generated: true },
    ]
    expect(violations(records).map((r: { kind: string }) => r.kind)).toEqual(['audio', 'image', 'video', 'font'])
  })
})
