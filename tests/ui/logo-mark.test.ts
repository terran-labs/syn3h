import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGlowBand, evenOddArea, GLOW_FLOATS_PER_VERTEX, insidePolygon, sampleOutline, wordmarkContours, type Contour, type Point } from '../../src/ui/brand/wordmarkMesh'
import { signedDistance, wordmarkSegments } from '../../src/ui/brand/wordmarkField'
import { LogoMark, logoBox, logoBudget, logoSvg } from '../../src/ui/brand/LogoMark'
import { INTRO_SECONDS, LogoRenderer } from '../../src/ui/brand/logoRenderer'
import { WORDMARK_HEIGHT, WORDMARK_WIDTH } from '../../src/ui/brand/wordmarkPath'

const filled = (p: Point, contours: Contour[]) => contours.filter(c => insidePolygon(p, c.points)).length % 2 === 1

describe('wordmark geometry', () => {
  const contours = wordmarkContours()
  it('parses the nine loops of the path into shapes, one hole and one island', () => {
    expect(contours).toHaveLength(9)
    // The small ringed H: a ring (filled loop with a hole) and the H inside the hole.
    expect(contours.filter(c => c.depth === 1)).toHaveLength(1)
    expect(contours.filter(c => c.depth === 2)).toHaveLength(1)
    expect(contours.filter(c => c.depth === 0)).toHaveLength(7)
    const hole = contours.find(c => c.depth === 1)!, island = contours.find(c => c.depth === 2)!
    expect(contours[island.parent]).toBe(hole)
  })
  it('measures a signed distance field that is negative exactly where the path is filled', () => {
    // Catches a field that fills the ring's hole, drops the island inside it, or flips sign.
    expect(evenOddArea(contours)).toBeGreaterThan(2.5)
    const segments = wordmarkSegments(contours), random = (() => { let a = 7; return () => (a = (a * 16807) % 2147483647) / 2147483647 })()
    let disagree = 0
    for (let i = 0; i < 4000; i++) {
      const p: Point = [(random() - 0.5) * 4.4, (random() - 0.5) * 1.2], d = signedDistance(segments, p[0], p[1])
      if (Math.abs(d) > 1e-4 && (d < 0) !== filled(p, contours)) disagree++
    }
    expect(disagree).toBe(0)
    // Every outline point lies on the zero contour.
    for (const c of contours) for (const q of c.points) expect(Math.abs(signedDistance(segments, q[0], q[1]))).toBeLessThan(1e-6)
  })
  it('grows the glow band outward from the outline, with whole contours of arc length', () => {
    const band = buildGlowBand(contours), v = band.vertices, n = v.length / GLOW_FLOATS_PER_VERTEX
    expect(n % 3).toBe(0)
    let rim = 0, outward = 0
    for (let k = 0; k < n; k++) {
      const at = k * GLOW_FLOATS_PER_VERTEX, offset = Math.hypot(v[at + 2], v[at + 3])
      // Either on the outline (no offset) or on the rim (a unit offset).
      expect(Math.min(offset, Math.abs(offset - 1))).toBeLessThan(1e-5)
      expect(v[at + 4]).toBeGreaterThanOrEqual(0); expect(v[at + 4]).toBeLessThanOrEqual(1)
      if (offset < 0.5) continue
      rim++
      if (!filled([v[at] + v[at + 2] * 0.004, v[at + 1] + v[at + 3] * 0.004], contours)) outward++
    }
    // Rim directions point away from the letters (bar the sharpest traced corners).
    expect(outward / rim).toBeGreaterThan(0.97)
  })
  it('seeds every particle on the outline with a unit normal pointing out of the letters', () => {
    const samples = sampleOutline(4000, 3)
    const edges = contours.flatMap(c => c.points.map((p, i) => [p, c.points[(i + 1) % c.points.length]] as const))
    let outward = 0
    for (let i = 0; i < samples.count; i++) {
      const p: Point = [samples.points[i * 4], samples.points[i * 4 + 1]], n: Point = [samples.points[i * 4 + 2], samples.points[i * 4 + 3]]
      const distance = Math.min(...edges.map(([a, b]) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
      }))
      expect(distance).toBeLessThan(1e-5)
      expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 4)
      if (!filled([p[0] + n[0] * 0.004, p[1] + n[1] * 0.004], contours) && filled([p[0] - n[0] * 0.004, p[1] - n[1] * 0.004], contours)) outward++
      for (let k = 0; k < 4; k++) { const s = samples.seeds[i * 4 + k]; expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(1) }
    }
    // Only points within 0.004 of a sharp corner can fail the step test.
    expect(outward / samples.count).toBeGreaterThan(0.97)
  })
  it('spreads any prefix of the particles over the whole outline', () => {
    const samples = sampleOutline(8000, 1), xs = Array.from({ length: 400 }, (_, i) => samples.points[i * 4])
    expect(Math.min(...xs)).toBeLessThan(-1.8); expect(Math.max(...xs)).toBeGreaterThan(1.8)
  })
})

describe('layout and budgets', () => {
  it('keeps the wordmark aspect in every layout', () => {
    for (const [w, h, layout] of [[1200, 630, 'card'], [512, 512, 'icon'], [32, 32, 'icon'], [390, 844, 'fit'], [1600, 648, 'fit']] as const) {
      const box = logoBox(w, h, layout)
      expect(box.width / box.height).toBeCloseTo(WORDMARK_WIDTH / WORDMARK_HEIGHT, 6)
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(w)
    }
  })
  it('budgets by graphics level, lowest still', () => {
    expect(logoBudget(0).still).toBe(true)
    expect(logoBudget(1).particles).toBeLessThan(logoBudget(2).particles)
    // A field carries the glow; the particles over it are few and large.
    expect(logoBudget(2).particles).toBeLessThanOrEqual(500)
  })
})

/** A WebGL 2 stand-in that keeps the little state the logo reads and records calls. */
function fakeGl(options: { link?: boolean } = {}) {
  const calls: string[] = [], loseContext = vi.fn()
  const state: Record<string, unknown> = { CURRENT_PROGRAM: 'host-program', VERTEX_ARRAY_BINDING: 'host-vao', ARRAY_BUFFER_BINDING: 'host-buffer', FRAMEBUFFER_BINDING: 'host-framebuffer', VIEWPORT: new Int32Array([0, 0, 640, 480]), SCISSOR_BOX: new Int32Array([1, 2, 3, 4]), COLOR_WRITEMASK: [true, true, true, true] }
  const enabled = new Set<string>(['SCISSOR_TEST'])
  let objects = 0
  const gl: Record<string | symbol, unknown> = {
    drawingBufferWidth: 640, drawingBufferHeight: 480,
    getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext } : null,
    getParameter: (name: string) => { calls.push('query getParameter'); return state[name] ?? 'ONE' },
    isEnabled: (cap: string) => { calls.push('query isEnabled'); return enabled.has(cap) }, enable: (cap: string) => { enabled.add(cap); calls.push(`enable ${cap}`) }, disable: (cap: string) => { enabled.delete(cap); calls.push(`disable ${cap}`) },
    getProgramParameter: () => { calls.push('query getProgramParameter'); return options.link ?? true }, getProgramInfoLog: () => 'fake',
    getAttribLocation: () => { calls.push('query getAttribLocation'); return 0 }, isContextLost: () => false,
    useProgram: (p: unknown) => { state.CURRENT_PROGRAM = p; calls.push('useProgram') },
    bindVertexArray: (v: unknown) => { state.VERTEX_ARRAY_BINDING = v }, bindFramebuffer: (_: unknown, f: unknown) => { state.FRAMEBUFFER_BINDING = f }, bindBuffer: (_: unknown, b: unknown) => { state.ARRAY_BUFFER_BINDING = b },
    viewport: (...v: number[]) => { state.VIEWPORT = new Int32Array(v) }, scissor: (...v: number[]) => { state.SCISSOR_BOX = new Int32Array(v) },
    drawArrays: (mode: string, first: number, count: number) => calls.push(`draw ${mode} ${count}`),
    // Locations are the fake's own { args: [program, name] }, so a value can be read back by name.
    uniform1f: (at: { args: unknown[] } | null, value: number) => calls.push(`uniform ${String(at?.args[1])} ${value}`),
  }
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return key
      if (typeof key === 'string' && key.startsWith('create')) return () => ({ id: ++objects })
      return (...args: unknown[]) => { calls.push(String(key)); return { args } }
    },
  })
  return { gl: proxy as unknown as WebGL2RenderingContext, calls, loseContext, state, enabled }
}
function fakeCanvas(gl: WebGL2RenderingContext | null) {
  return { width: 300, height: 150, clientWidth: 0, clientHeight: 0, hidden: false, getContext: vi.fn(() => gl), addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: vi.fn() }
}

describe('LogoMark lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stubFrames = () => { vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()) }
  it('draws, then gives its context back on dispose', () => {
    stubFrames()
    const fake = fakeGl(), canvas = fakeCanvas(fake.gl)
    const mark = new LogoMark(canvas as unknown as HTMLCanvasElement, { still: true, particles: 500 })
    expect(mark.generated).toBe(true)
    fake.calls.length = 0
    mark.renderStill()
    // No sky behind the lobby logo: plasma, then the flat wordmark (the field was baked at the first frame).
    const band = `draw TRIANGLES ${buildGlowBand().vertices.length / GLOW_FLOATS_PER_VERTEX}`
    expect(fake.calls.filter(c => c.startsWith('draw'))).toEqual([band, 'draw POINTS 500', 'draw TRIANGLES 6'])
    mark.setOptions({ space: true }); fake.calls.length = 0; mark.renderStill()
    expect(fake.calls.filter(c => c.startsWith('draw'))).toEqual(['draw TRIANGLES 3', band, 'draw POINTS 500', 'draw TRIANGLES 6'])
    mark.dispose()
    expect(fake.loseContext).toHaveBeenCalledTimes(1)
    expect(fake.calls.filter(c => c === 'deleteProgram')).toHaveLength(5)
    expect(mark.generated).toBe(false)
    // A canvas it was given stays in the page; one it made would be removed.
    expect(canvas.remove).not.toHaveBeenCalled()
    mark.dispose()
    expect(fake.loseContext).toHaveBeenCalledTimes(1)
  })
  it('never throws: no context, or a failed shader, leaves the SVG in place', () => {
    stubFrames()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const none = fakeCanvas(null), a = new LogoMark(none as unknown as HTMLCanvasElement)
    expect(a.generated).toBe(false); expect(none.hidden).toBe(true)
    expect(() => { a.start(); a.renderStill(); a.resize(); a.dispose() }).not.toThrow()
    const broken = fakeGl({ link: false }), canvas = fakeCanvas(broken.gl), b = new LogoMark(canvas as unknown as HTMLCanvasElement)
    expect(b.generated).toBe(false); expect(canvas.hidden).toBe(true); expect(broken.loseContext).toHaveBeenCalled()
    const throwing = { ...fakeCanvas(null), getContext: () => { throw new Error('blocked') } }
    expect(() => new LogoMark(throwing as unknown as HTMLCanvasElement).dispose()).not.toThrow()
  })
  it('marks a bake slower than 50 ms, so the lobby keeps the flat vector mark', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 60))
    const fake = fakeGl(), renderer = new LogoRenderer(fake.gl, { particles: 50 })
    renderer.draw(5, { x: 100, y: 100, width: 426, height: 100 })
    expect(renderer.distanceField!.slow).toBe(true)
    vi.restoreAllMocks()
  })
  it('hosted in another context, puts back the state it found', () => {
    const fake = fakeGl(), renderer = new LogoRenderer(fake.gl, { particles: 200 })
    expect(fake.state.CURRENT_PROGRAM).toBe('host-program')
    renderer.draw(5, { x: 100, y: 100, width: 426, height: 100 })
    // The distance field's bake, then glow, particles and mark; the bake draws into its own
    // target and gives the host's back.
    expect(fake.calls.filter(c => c.startsWith('draw'))).toHaveLength(4)
    expect(fake.state.FRAMEBUFFER_BINDING).toBe('host-framebuffer')
    expect(fake.state.CURRENT_PROGRAM).toBe('host-program')
    expect(fake.state.VERTEX_ARRAY_BINDING).toBe('host-vao')
    expect(fake.state.ARRAY_BUFFER_BINDING).toBe('host-buffer')
    expect(Array.from(fake.state.VIEWPORT as Int32Array)).toEqual([0, 0, 640, 480])
    expect(Array.from(fake.state.SCISSOR_BOX as Int32Array)).toEqual([1, 2, 3, 4])
    expect([...fake.enabled]).toEqual(['SCISSOR_TEST'])
    renderer.dispose()
    expect(fake.loseContext).not.toHaveBeenCalled()
  })
  it('queries no GL state while drawing: each query stalls the host until the GPU drains', () => {
    const fake = fakeGl(), renderer = new LogoRenderer(fake.gl, { particles: 200 })
    fake.calls.length = 0
    for (let i = 0; i < 3; i++) renderer.draw(5 + i, { x: 100, y: 100, width: 426, height: 100 })
    // Growing the particle buffer mid-flight must not query either.
    renderer.setLook({ particles: 900 }); renderer.draw(9, { x: 100, y: 100, width: 426, height: 100 })
    expect(fake.calls.filter(c => c.startsWith('query'))).toEqual([])
    expect(fake.calls.filter(c => c.startsWith('draw')).length).toBeGreaterThan(0)
    // The host's program, vertex array and scissor are still put back, from the copy read at creation.
    expect(fake.state.CURRENT_PROGRAM).toBe('host-program')
    expect(fake.state.VERTEX_ARRAY_BINDING).toBe('host-vao')
    expect([...fake.enabled]).toEqual(['SCISSOR_TEST'])
    renderer.dispose()
  })
})

/** The uOpacity each draw call was made with, in draw order. */
function drawOpacities(calls: string[]): number[] {
  let opacity = Number.NaN
  const out: number[] = []
  for (const call of calls) {
    if (call.startsWith('uniform uOpacity ')) opacity = Number(call.split(' ')[2])
    // A draw before any opacity is set is the distance field's bake, not part of the logo.
    else if (call.startsWith('draw') && !Number.isNaN(opacity)) out.push(opacity)
  }
  return out
}

describe('two-stage fade in', () => {
  const box = { x: 100, y: 100, width: 426, height: 100 }
  // Draws are the glow field, the glow particles, then the wordmark: [glow, glow, mark].
  const frame = (renderer: LogoRenderer, fake: ReturnType<typeof fakeGl>, seconds: number) => { fake.calls.length = 0; renderer.draw(seconds, box); return drawOpacities(fake.calls) }
  it('shows nothing at first, then the silhouette, then the glow more slowly', () => {
    const fake = fakeGl(), renderer = new LogoRenderer(fake.gl, { particles: 50 })
    expect(renderer.look.markFade).toBe(1.5); expect(renderer.look.glowFade).toBe(3)
    expect(frame(renderer, fake, 10)).toEqual([0, 0, 0])
    const half = frame(renderer, fake, 10.75)
    expect(half[2]).toBeCloseTo(0.5, 5); expect(half[0]).toBe(0); expect(half[1]).toBe(0)
    expect(frame(renderer, fake, 11.5)).toEqual([0, 0, 1])
    const glowing = frame(renderer, fake, 13)
    expect(glowing[0]).toBeCloseTo(0.5, 5); expect(glowing[1]).toBeCloseTo(0.5, 5); expect(glowing[2]).toBe(1)
    expect(frame(renderer, fake, 14.5)).toEqual([1, 1, 1])
    expect(renderer.introTime).toBeGreaterThanOrEqual(INTRO_SECONDS)
    // The gap holds the glow back after the silhouette has arrived.
    renderer.setLook({ glowGap: 1 }); renderer.replayIntro()
    frame(renderer, fake, 20)
    expect(frame(renderer, fake, 22.4)).toEqual([0, 0, 1])
    expect(frame(renderer, fake, 22.6)[0]).toBeGreaterThan(0)
  })
  it('replays when shown again after being hidden, unless skipped', () => {
    const fake = fakeGl(), renderer = new LogoRenderer(fake.gl, { particles: 50 })
    frame(renderer, fake, 0); expect(frame(renderer, fake, 10)).toEqual([1, 1, 1])
    renderer.setLook({ opacity: 0 }); expect(frame(renderer, fake, 11)).toEqual([0, 0, 0])
    renderer.setLook({ opacity: 1 }); expect(frame(renderer, fake, 12)).toEqual([0, 0, 0])
    expect(frame(renderer, fake, 12.75)[2]).toBeCloseTo(0.5, 5)
    // Skipped (reduced motion, a held lobby): the finished logo at once, also after hiding.
    renderer.skipIntro(); expect(frame(renderer, fake, 13)).toEqual([1, 1, 1])
    renderer.setLook({ opacity: 0 }); frame(renderer, fake, 14)
    renderer.setLook({ opacity: 1 }); expect(frame(renderer, fake, 15)).toEqual([1, 1, 1])
  })
})

describe('no assets', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('makes no image, font or network request', () => {
    const forbidden = vi.fn(() => { throw new Error('request made') })
    for (const name of ['fetch', 'Image', 'XMLHttpRequest', 'FontFace', 'WebSocket']) vi.stubGlobal(name, forbidden)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const fake = fakeGl(), mark = new LogoMark(fakeCanvas(fake.gl) as unknown as HTMLCanvasElement, { still: true })
    mark.renderStill(); mark.dispose()
    const svg = logoSvg({ space: true, layout: 'icon', width: 512, height: 512 })
    expect(forbidden).not.toHaveBeenCalled()
    // The SVG references only its own gradients and filters.
    expect(svg).not.toMatch(/<image|href=|url\((?!#)|@font-face|<text/)
    // Flat: no sun and no gloss gradient on the letters.
    expect(logoSvg()).not.toMatch(/corona|disc|gloss|<circle/)
    for (const file of ['LogoMark.ts', 'logoRenderer.ts', 'wordmarkMesh.ts']) {
      const source = readFileSync(new URL(`../../src/ui/brand/${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/fetch\(|new Image|XMLHttpRequest|FontFace|\.woff|import\(|url\((?!#)|createImageBitmap|texImage/)
    }
  })
})
