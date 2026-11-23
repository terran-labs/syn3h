/**
 * Blank frames: a recorder for black or cleared frames the browser is about to present.
 *
 * The owner saw dozens of black flashes a minute on an iPhone (v26.11.2301, alone in the Mire),
 * on Safari's WebGPU, a path no machine of ours can run. This records them where they happen.
 *
 * With "Record blank frames" on (Performance, Diagnostics; off by default), after each drawn frame
 * the game canvas is copied into a 16 by 8 2D canvas and its 128 pixels are classified: a frame
 * whose pixels are nearly all black or transparent is blank, one with a large share of them is
 * partly blank, when the frame before was not. Each such frame is logged with what happened in it
 * and in the frame before: frame copies (renderer.copyFramebufferToTexture: refraction's colour and
 * depth at Medium and up on WebGPU, and three's viewport depth copy for the force field glow and the
 * headlight cones, each of which ends the multisampled scene pass and reopens it), a resize that
 * really changed the canvas, a
 * quality step, a device error or loss. The copy is read in the same task as the draw, before the
 * browser presents it, so it shows the image about to be presented; a canvas cleared after the
 * draw reads transparent black. It costs one small readback per frame while on, nothing while off.
 *
 * Whatever the switch, the report carries the backend, the adapter, the scene's sample count,
 * whether refraction is on and every uncaptured device error of the session: a rejected copy or a
 * validation error shows itself there and nowhere else.
 */
import { defineParam } from '../../shared/params'

export const recordBlankFrames = defineParam<boolean>({
  id: 'diag.blankFrames', label: 'Record blank frames', group: 'Diagnostics', scope: 'client', default: false,
  // Shown in Performance, Diagnostics beside its counts, not as a settings row.
  hidden: true,
})

/** A pixel counts as blank when its luminance (0 to 255) is at most this, or its alpha is below BLANK_ALPHA. */
export const BLANK_LUMA = 3
export const BLANK_ALPHA = 16
/** Share of blank pixels at which a frame is blank, and partly blank. */
export const BLANK_SHARE = 0.97
export const PARTLY_SHARE = 0.4
/** A frame is only reported when the frame before had at most this share (a dark night is not a flash). */
export const QUIET_SHARE = 0.25

export type FrameClass = 'blank' | 'partly' | 'normal'

/** The share of blank pixels in RGBA bytes (the probe's 16 by 8 copy). */
export function blankShare(rgba: ArrayLike<number>): number {
  let blank = 0, n = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    if (luma <= BLANK_LUMA || rgba[i + 3] < BLANK_ALPHA) blank++
    n++
  }
  return n ? blank / n : 0
}

/** Classify a frame by its blank share, against the frame before (a sudden change only). */
export function classifyFrame(share: number, previousShare: number): FrameClass {
  if (previousShare > QUIET_SHARE) return 'normal'
  if (share >= BLANK_SHARE) return 'blank'
  if (share >= PARTLY_SHARE) return 'partly'
  return 'normal'
}

/** What happened in one frame, for the log. */
export interface FrameFacts {
  frameCopies: number
  resized: string | null
  step: string | null
  deviceErrors: string[]
  deviceLost: boolean
}

export interface BlankFrameEvent {
  /** Milliseconds since the page started. */
  t: number
  kind: Exclude<FrameClass, 'normal'>
  share: number
  frame: FrameFacts
  before: FrameFacts
  backend: string
  level: number
  rung: number
  reason: string
  samples: number | string
  pixelRatio: number
  canvas: [number, number]
}

export type Coincidence = 'frame copy' | 'resize' | 'quality step' | 'device error' | 'nothing'

/** What a blank frame coincides with, in the frame itself or the one before, most specific first. */
export function coincidence(event: Pick<BlankFrameEvent, 'frame' | 'before'>): Coincidence[] {
  const both = [event.frame, event.before]
  const found: Coincidence[] = []
  if (both.some(f => f.deviceErrors.length || f.deviceLost)) found.push('device error')
  if (both.some(f => f.resized)) found.push('resize')
  if (both.some(f => f.step)) found.push('quality step')
  if (both.some(f => f.frameCopies > 0)) found.push('frame copy')
  return found.length ? found : ['nothing']
}

/** Count events by coincidence. An event with several counts under each. */
export function tally(events: readonly Pick<BlankFrameEvent, 'frame' | 'before'>[]): Record<Coincidence, number> {
  const out: Record<Coincidence, number> = { 'frame copy': 0, resize: 0, 'quality step': 0, 'device error': 0, nothing: 0 }
  for (const e of events) for (const c of coincidence(e)) out[c]++
  return out
}

interface RecorderRenderer {
  domElement: HTMLCanvasElement
  backend: { isWebGPUBackend?: boolean; device?: GPUDevice | null }
  getPixelRatio(): number
  setSize(...a: unknown[]): unknown
  setPixelRatio(...a: unknown[]): unknown
  copyFramebufferToTexture?(...a: unknown[]): unknown
}

/** Game's side: the governor's state for an event, and whether refraction is on. */
export interface RecorderContext {
  level(): number
  rung(): number
  reason(): string
  refraction(): string
  /** The scene pass's sample count (null before the post chain has built one). */
  samples(): number | null
}

const EVENTS_KEPT = 200
const ERRORS_KEPT = 20

export class BlankFrameRecorder {
  readonly events: BlankFrameEvent[] = []
  total = 0
  frames = 0
  /** Uncaptured device errors this session, and the first messages. */
  deviceErrorCount = 0
  readonly deviceErrors: string[] = []
  private readonly recent: number[] = []
  private current: FrameFacts = BlankFrameRecorder.empty()
  private previous: FrameFacts = BlankFrameRecorder.empty()
  private previousShare = 0
  private probe: CanvasRenderingContext2D | null = null
  private clearNext = false
  private hooked = false
  private adapter: string | null = null
  /** Time spent reading the probe, for the report (milliseconds, running total). */
  probeMs = 0

  constructor(private readonly renderer: RecorderRenderer, private readonly context: RecorderContext) {}

  private static empty(): FrameFacts { return { frameCopies: 0, resized: null, step: null, deviceErrors: [], deviceLost: false } }

  /** Hook the renderer and the device once. Cheap whatever the switch: a counter per call. */
  attach(): void {
    if (this.hooked) return
    this.hooked = true
    const r = this.renderer, canvas = r.domElement
    const copy = r.copyFramebufferToTexture?.bind(r)
    if (copy) r.copyFramebufferToTexture = (...a: unknown[]) => { this.current.frameCopies++; return copy(...a) }
    for (const name of ['setSize', 'setPixelRatio'] as const) {
      const f = r[name].bind(r)
      r[name] = (...a: unknown[]) => {
        const w = canvas.width, h = canvas.height
        const out = f(...a)
        if (canvas.width !== w || canvas.height !== h) this.current.resized = `${name} ${w}x${h} to ${canvas.width}x${canvas.height}`
        return out
      }
    }
    this.watchDevice()
    if (typeof window !== 'undefined') {
      for (const type of ['mira:quality', 'syn3h:quality']) {
        window.addEventListener(type, event => {
          const d = (event as CustomEvent<{ level?: number; rung?: number; pixelRatio?: number; reason?: string }>).detail ?? {}
          this.current.step = `${d.reason ?? 'change'} to level ${d.level} rung ${d.rung} ratio ${d.pixelRatio}`
        })
      }
    }
  }

  private watchDevice(): void {
    const device = this.renderer.backend.device
    if (!device) return
    const info = (device as unknown as { adapterInfo?: { vendor?: string; architecture?: string; description?: string; device?: string } }).adapterInfo
    if (info) this.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || null
    device.addEventListener?.('uncapturederror', event => {
      const message = String((event as GPUUncapturedErrorEvent).error?.message ?? event.type).slice(0, 300)
      this.deviceErrorCount++
      if (this.deviceErrors.length < ERRORS_KEPT) this.deviceErrors.push(message)
      this.current.deviceErrors.push(message)
    })
    device.lost?.then(() => { this.current.deviceLost = true })
  }

  /** Test hook: clear the canvas after the next drawn frame, as a resize would. */
  clearNextFrame(): void { this.clearNext = true }

  /** Call once per drawn frame, after the draw, in the same task. */
  afterDraw(): void {
    if (this.clearNext) {
      this.clearNext = false
      const canvas = this.renderer.domElement
      canvas.width = canvas.width // Resetting the size clears the canvas: the fault the recorder looks for.
    }
    if (recordBlankFrames.value) this.read()
    this.previous = this.current
    this.current = BlankFrameRecorder.empty()
  }

  private read(): void {
    const start = performance.now()
    const canvas = this.renderer.domElement
    if (!this.probe) {
      const probe = document.createElement('canvas'); probe.width = 16; probe.height = 8
      this.probe = probe.getContext('2d', { willReadFrequently: true })
    }
    const p = this.probe
    if (!p || !canvas.width || !canvas.height) return
    let share: number
    try {
      p.clearRect(0, 0, 16, 8)
      p.drawImage(canvas, 0, 0, 16, 8)
      share = blankShare(p.getImageData(0, 0, 16, 8).data)
    } catch { return } finally { this.probeMs += performance.now() - start }
    this.frames++
    const kind = classifyFrame(share, this.previousShare)
    this.previousShare = share
    if (kind === 'normal') return
    const now = performance.now()
    this.total++
    this.recent.push(now)
    if (this.events.length < EVENTS_KEPT) this.events.push({
      t: Math.round(now), kind, share: Math.round(share * 100) / 100, frame: this.current, before: this.previous,
      backend: this.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2', level: this.context.level(), rung: this.context.rung(),
      reason: this.context.reason(), samples: this.sampleCount(), pixelRatio: this.renderer.getPixelRatio(), canvas: [canvas.width, canvas.height],
    })
  }

  /** The counts shown beside the switch. */
  counts(): { lastMinute: number; total: number } { return { lastMinute: this.lastMinute(), total: this.total } }

  /** Blank or partly blank frames in the last minute. */
  lastMinute(now = performance.now()): number {
    while (this.recent.length && now - this.recent[0] > 60_000) this.recent.shift()
    return this.recent.length
  }

  private sampleCount(): number | string { return this.context.samples() ?? 'not built' }

  /** Lines for the copied Diagnostics report. The first block is there whatever the switch. */
  reportLines(): string[] {
    const lines = [
      `Graphics: ${this.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'}, adapter ${this.adapter ?? 'not reported'}, scene samples ${this.sampleCount()}, refraction ${this.context.refraction()}`,
      `Uncaptured device errors this session: ${this.deviceErrorCount}${this.deviceErrors.length ? ': ' + this.deviceErrors.slice(0, 5).map(m => JSON.stringify(m)).join('; ') : ''}`,
    ]
    if (!recordBlankFrames.value && !this.total) return [...lines, 'Blank frames: not recorded (Performance, Diagnostics, "Record blank frames")']
    const t = tally(this.events)
    lines.push(`Blank frames: ${this.total} in ${this.frames} frames recorded (${this.lastMinute()} in the last minute); probe ${this.frames ? (this.probeMs / this.frames).toFixed(2) : '0'} ms a frame`)
    lines.push(`Blank frames by coincidence: ${Object.entries(t).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    for (const e of this.events.slice(0, 20)) {
      const facts = (f: FrameFacts) => [f.frameCopies ? `${f.frameCopies} frame copies` : '', f.resized ?? '', f.step ?? '', f.deviceLost ? 'device lost' : '', ...f.deviceErrors.map(m => 'error ' + JSON.stringify(m))].filter(Boolean).join(', ') || 'nothing'
      lines.push(`  ${(e.t / 1000).toFixed(2)} s ${e.kind} (${Math.round(e.share * 100)}%), ${e.backend}, level ${e.level} rung ${e.rung} (${e.reason}), ratio ${e.pixelRatio}, ${e.canvas[0]}x${e.canvas[1]}, samples ${e.samples}; this frame: ${facts(e.frame)}; frame before: ${facts(e.before)}`)
    }
    return lines
  }
}
