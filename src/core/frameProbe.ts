/**
 * ?frameProbe=1: what our own passes produced, frame by frame, read on the GPU (WebGPU only).
 *
 * The owner's iPhone shows whole-screen black flashes with sun shadows on, and the frame canary
 * (frameCanary.ts) counts no dropped command buffer while it does: everything we submitted ran.
 * So either our passes drew a black frame, or the browser presented a good one badly. This tells
 * the two apart without reading the canvas through 2D (blind on Safari).
 *
 * After every drawn frame in play, one small encoder of our own copies a 4 by 4 grid of texels
 * from two places into a mappable buffer:
 *   scene    the scene pass colour the post chain drew (half float, before sun rays, tone
 *            mapping and the look), when the frame went through the chain;
 *   output   the texture handed to the canvas, after everything.
 * The canvas is already configured by three with COPY_SRC (WebGPUBackend: RENDER_ATTACHMENT |
 * COPY_SRC), so reading it changes nothing about how the browser presents it.
 *
 * When the buffer is mapped the frame is classified: the scene all black, or any texel NaN or
 * infinite; the output all black, or all transparent (alpha 0: the page's near-black background
 * shows through a premultiplied canvas). Where the black first appears says where to look:
 *   scene black or NaN      the lighting (sun shadows feed it);
 *   scene fine, output bad  the post chain or tone mapping;
 *   both fine, a flash seen  presentation, after our work.
 *
 * And every frame, on the CPU: whether any of the values the frame's lighting rests on is not a
 * finite number: the sun shadow cascades' matrices and split distances, the shadow's settings,
 * the sun light, the world camera (a canvas of zero height makes its aspect NaN, and
 * Environment.ts then rebuilds the cascades from it every frame) and the tone mapping exposure
 * (Environment.ts eye adaptation, where the sky's side colour enters unsanitised). One NaN there blanks every lit pixel at
 * once, which fits a whole-screen flash better than a fault in one pixel.
 *
 * Test controls, so a zero can be trusted on the phone itself: blackNext() clears the canvas to
 * transparent black after the next frame draws (what a black flash is), and nanNext() draws the
 * next frame with the sun's intensity NaN (the value check must see it) and writes a half float
 * NaN into one texel of that frame's scene image (the image check must see it). Writing it is
 * needed: on desktop Chrome a NaN sun reached none of the sampled texels. Each must be counted.
 */
import type * as THREE from 'three/webgpu'
import { RecentEvents, now } from './recentEvents'

/** Grid of texels read from each image. */
const GRID = 4
const POINTS = GRID * GRID
/** copyTextureToBuffer rows must start 256 bytes apart. */
const ROW = 256
const SLOTS = 4
const RECENT_S = 15
/** GPUBufferUsage, GPUTextureUsage and GPUMapMode bits, fixed by the WebGPU specification. */
const U = { MAP_READ: 0x1, COPY_DST: 0x8 }, MAP_READ_MODE = 0x1

export interface ProbeHost {
  frames(): number
  pixelRatio(): number
  /** The scene pass colour this frame's post graph drew, or null (post chain off or not drawn). */
  sceneTexture(): GPUTexture | null
  /** The sun: its shadow node, matrices and intensity are checked each frame. */
  sun(): THREE.DirectionalLight | null
  exposure(): number
  /** The world camera: a zero-size canvas makes its aspect, and every cascade built from it, NaN. */
  camera(): THREE.PerspectiveCamera
}

export interface BadFrame { frame: number; at: number; what: string; recent: string[] }

interface Slot { buffer: GPUBuffer; busy: boolean }
type Kind = 'output black' | 'output clear' | 'scene black' | 'scene NaN'

export class FrameProbe {
  /** Frames read back, and frames not read because every buffer was still being read. */
  probed = 0
  skipped = 0
  /** Frames the scene image was in (the frame went through the post chain). */
  withScene = 0
  readonly counts: Record<Kind, number> = { 'output black': 0, 'output clear': 0, 'scene black': 0, 'scene NaN': 0 }
  /** Frames with a bad image of any kind, and how many of them the test controls caused. */
  bad = 0
  testBad = 0
  /** Frames whose CPU-side values were not all finite, by where. */
  nonFiniteFrames = 0
  readonly nonFinite: Record<string, number> = {}
  readonly lastBad: BadFrame[] = []
  testsAsked = 0
  private readonly events = new RecentEvents()
  private readonly slots: Slot[] = []
  private readonly badTimes: number[] = []
  private black = 0
  private nan = 0
  private nanRestore: (() => void) | null = null
  private lastTestFrame = -1
  private nanWrite = false

  constructor(private readonly device: GPUDevice, private readonly context: GPUCanvasContext, private readonly host: ProbeHost) {
    for (let i = 0; i < SLOTS; i++) this.slots.push({ buffer: device.createBuffer({ label: `frame probe readback ${i}`, size: 2 * POINTS * ROW, usage: U.MAP_READ | U.COPY_DST }), busy: false })
  }

  note(what: string): void { this.events.note(what) }

  /** Test: the next frame drawn in play is cleared to transparent black after it draws. */
  blackNext(): void { this.black++; this.testsAsked++ }
  /** Test: the next frame drawn in play is drawn with the sun's intensity NaN. */
  nanNext(): void { this.nan++; this.testsAsked++ }

  /** Just before a frame is drawn in play. */
  beforeDraw(): void {
    if (!this.nan) return
    const sun = this.host.sun()
    if (!sun) return
    this.nan--
    this.nanWrite = true
    const intensity = sun.intensity
    sun.intensity = NaN
    this.nanRestore = () => { sun.intensity = intensity }
  }

  /** Just after a frame is drawn in play: check its values, and copy its texels to be read. */
  afterDraw(): void {
    const frame = this.host.frames()
    this.events.pixelRatio(this.host.pixelRatio())
    const test = this.nanRestore !== null || this.black > 0
    this.checkValues(frame, test)
    this.nanRestore?.(); this.nanRestore = null
    const slot = this.slots.find(s => !s.busy)
    if (!slot) { this.skipped++; if (this.black) this.black--; return }
    let output: GPUTexture
    try { output = this.context.getCurrentTexture() } catch { return }
    const scene = this.host.sceneTexture()
    const encoder = this.device.createCommandEncoder({ label: 'frame probe' })
    if (test && this.nanWrite && scene) {
      this.nanWrite = false
      // Half float NaN (0x7e00) in every channel of the grid's first texel, queued before the copy.
      const x = Math.floor(0.5 / GRID * scene.width), y = Math.floor(0.5 / GRID * scene.height)
      this.device.queue.writeTexture({ texture: scene, origin: { x, y } }, new Uint16Array([0x7e00, 0x7e00, 0x7e00, 0x7e00]), { bytesPerRow: 8 }, { width: 1, height: 1 })
    }
    if (this.black) {
      this.black--
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
      pass.end()
    }
    const copy = (texture: GPUTexture, base: number) => {
      for (let i = 0; i < POINTS; i++) {
        const x = Math.min(texture.width - 1, Math.floor(((i % GRID) + 0.5) / GRID * texture.width))
        const y = Math.min(texture.height - 1, Math.floor((Math.floor(i / GRID) + 0.5) / GRID * texture.height))
        encoder.copyTextureToBuffer({ texture, origin: { x, y } }, { buffer: slot.buffer, offset: (base + i) * ROW, bytesPerRow: ROW }, { width: 1, height: 1 })
      }
    }
    copy(output, 0)
    if (scene) copy(scene, POINTS)
    this.device.queue.submit([encoder.finish()])
    slot.busy = true
    void this.read(slot, frame, output.format, scene?.format ?? null, test)
  }

  private async read(slot: Slot, frame: number, outputFormat: GPUTextureFormat, sceneFormat: GPUTextureFormat | null, test: boolean): Promise<void> {
    try {
      await slot.buffer.mapAsync(MAP_READ_MODE)
      const bytes = new Uint8Array(slot.buffer.getMappedRange().slice(0))
      slot.buffer.unmap()
      this.probed++
      const kinds: Kind[] = []
      const out = readTexels(bytes, 0, outputFormat)
      if (out) {
        if (out.every(t => t[3] === 0)) kinds.push('output clear')
        else if (out.every(t => Math.max(t[0], t[1], t[2]) <= 1 / 255)) kinds.push('output black')
      }
      const scene = sceneFormat ? readTexels(bytes, POINTS, sceneFormat) : null
      if (scene) {
        this.withScene++
        if (scene.some(t => t.some(v => !Number.isFinite(v)))) kinds.push('scene NaN')
        else if (scene.every(t => Math.max(t[0], t[1], t[2]) <= 0)) kinds.push('scene black')
      }
      if (kinds.length) this.record(frame, kinds.join(', '), test, kinds)
    } catch { /* A lost device: the loss record says so. */ } finally { slot.busy = false }
  }

  private record(frame: number, what: string, test: boolean, kinds: Kind[] = []): void {
    for (const k of kinds) this.counts[k]++
    this.bad++
    // A test frame is counted once, whether its values, its image or both show it.
    if (test && frame !== this.lastTestFrame) { this.testBad++; this.lastTestFrame = frame }
    const t = now()
    this.badTimes.push(t)
    this.lastBad.push({ frame, at: t, what: test ? `${what} (test)` : what, recent: this.events.within(RECENT_S, t) })
    if (this.lastBad.length > 5) this.lastBad.shift()
  }

  /** Not-finite values the frame's lighting rests on, by where. Cheap: a few matrices. */
  private checkValues(frame: number, test: boolean): void {
    const where: string[] = []
    if (!Number.isFinite(this.host.exposure())) where.push('exposure')
    const camera = this.host.camera()
    if (!Number.isFinite(camera.aspect) || !finite(camera.projectionMatrix.elements) || !finite(camera.matrixWorld.elements)) where.push('camera')
    const sun = this.host.sun()
    if (sun) {
      if (!Number.isFinite(sun.intensity) || !finite(sun.color.toArray()) || !finite(sun.position.toArray()) || !finite(sun.target.position.toArray())) where.push('sun light')
      const csm = (sun.shadow as { shadowNode?: CascadeNode }).shadowNode
      if (sun.castShadow && csm) {
        if (csm.breaks && !finite(csm.breaks)) where.push('cascade splits')
        for (const cascade of csm.lights ?? []) {
          const shadow = cascade.shadow
          if (!shadow) continue
          if (!finite(shadow.camera.projectionMatrix.elements) || !finite(shadow.camera.matrixWorldInverse.elements) || !finite(shadow.matrix.elements)) { where.push('cascade matrices'); break }
        }
        if (!finite(sun.shadow.matrix.elements)) where.push('shadow matrix')
        const s = sun.shadow
        if (!finite([s.bias, s.normalBias, s.radius, s.intensity])) where.push('shadow settings')
      }
    }
    if (!where.length) return
    this.nonFiniteFrames++
    for (const w of where) this.nonFinite[w] = (this.nonFinite[w] ?? 0) + 1
    this.record(frame, `non-finite ${where.join(', ')}`, test)
  }

  /** Bad frames in the last minute. */
  lastMinute(): number { const t = now(); while (this.badTimes.length && t - this.badTimes[0] > 60) this.badTimes.shift(); return this.badTimes.length }

  /** For the on-screen counter. */
  counterLines(): string {
    const c = this.counts
    const sceneBad = c['scene black'] + c['scene NaN'], outBad = c['output black'] + c['output clear']
    const last = this.lastBad.slice(-2).map(b => `#${b.frame} ${b.what}${b.recent.length ? ` (${b.recent.at(-1)})` : ''}`).join('\n  ')
    return `Black frames ${sceneBad + outBad} of ${this.probed}: scene ${sceneBad}, output ${outBad} (${this.lastMinute()}/min)\n` +
      `Scene NaN ${c['scene NaN']}  clear ${c['output clear']}  values ${this.nonFiniteFrames}` +
      `${this.testsAsked ? `\nTests ${this.testBad} of ${this.testsAsked}` : ''}${last ? `\nLast: ${last}` : ''}`
  }

  /** For the copied report. */
  reportLines(): string[] {
    const c = this.counts
    const where = Object.entries(this.nonFinite).map(([w, n]) => `${w} ${n}`).join(', ')
    return [
      `Frame probe: ${this.probed} frames read (${this.withScene} with the scene image, ${this.skipped} not read); output black ${c['output black']}, output transparent ${c['output clear']}, scene black ${c['scene black']}, scene NaN or infinite ${c['scene NaN']}`,
      `  non-finite values: ${this.nonFiniteFrames} frames${where ? ` (${where})` : ''}${this.testsAsked ? `; ${this.testBad} of ${this.testsAsked} test frames counted` : ''}`,
      ...this.lastBad.map(b => `  frame ${b.frame}: ${b.what}; last ${RECENT_S} s: ${b.recent.join('; ') || 'nothing noted'}`),
    ]
  }
}

interface CascadeNode {
  breaks?: number[]
  lights?: { shadow?: { camera: THREE.Camera; matrix: THREE.Matrix4 } }[]
}

function finite(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false
  return true
}

/** The grid's texels as [r, g, b, a] in 0..1 (8-bit formats) or as stored (half float); null for a format not read. */
function readTexels(bytes: Uint8Array, base: number, format: GPUTextureFormat): number[][] | null {
  const out: number[][] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < POINTS; i++) {
    const o = (base + i) * ROW
    if (format === 'bgra8unorm' || format === 'bgra8unorm-srgb') out.push([bytes[o + 2] / 255, bytes[o + 1] / 255, bytes[o] / 255, bytes[o + 3] / 255])
    else if (format === 'rgba8unorm' || format === 'rgba8unorm-srgb') out.push([bytes[o] / 255, bytes[o + 1] / 255, bytes[o + 2] / 255, bytes[o + 3] / 255])
    else if (format === 'rgba16float') out.push([0, 1, 2, 3].map(k => half(view.getUint16(o + k * 2, true))))
    else if (format === 'rgba32float') out.push([0, 1, 2, 3].map(k => view.getFloat32(o + k * 4, true)))
    else return null
  }
  return out
}

/** IEEE half float to number, NaN and infinity kept. */
export function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff
  if (e === 0) return s * f * 2 ** -24
  if (e === 31) return f ? NaN : s * Infinity
  return s * (1 + f / 1024) * 2 ** (e - 15)
}
