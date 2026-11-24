/**
 * Evidence for a lost GPU device, kept across the reload the player is then asked for.
 *
 * The owner lost the device several times in a day on an iPhone (Safari, WebGPU, Medium). Safari
 * never says why: its GPUDeviceLostInfo.message is always empty, and a GPU process that crashes or
 * is killed reports reason 'destroyed', the same reason as a page calling device.destroy() (WebKit
 * RemoteDeviceProxy and IPC Connection, read 24 November 2026). The page reloads and the evidence
 * with it. So at the moment of a loss this writes one record to sessionStorage (the same tab keeps
 * it across the reload) and the Diagnostics report prints it, this page's and the last page's:
 *
 * - the reason and message exactly as the browser gave them, and whether we were disposing;
 * - seconds since the page started, the quality level and rung, pixel ratio and canvas size,
 *   whether the page was visible and the world being played;
 * - three's own counts and sizes (renderer.info.memory) as an estimate of GPU memory;
 * - WebGPU command encoders created, finished and submitted: WebKit loses a device with 1000
 *   command buffers created but not committed, so this shows whether we ever leave any behind;
 * - the events of the last 15 seconds: quality steps, pixel ratio and size changes, the view
 *   changing (lobby, covered, playing), the page hidden or shown.
 *
 * `?gpuTrace=1` adds an exact count of live WebGPU texture and buffer bytes (every allocation is
 * wrapped while it is on). Everything else costs a few counters and costs nothing per draw.
 */

export const LOSS_KEY = 'mira.lastDeviceLoss'
const RECENT_S = 15
const MAX_EVENTS = 40

interface Storage_ { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface InfoMemory { [key: string]: number }
export interface LossRendererLike {
  getPixelRatio(): number
  domElement?: { width: number; height: number }
  info?: { memory?: InfoMemory }
  backend?: unknown
  setPixelRatio?: (value: number) => void
  setSize?: (width: number, height: number, updateStyle?: boolean) => void
}
export interface LossContext { level(): number; rung(): number; view(): string; frames(): number }

export interface DeviceLossRecord {
  at: string
  sinceStartS: number
  api: string
  /** As the browser gave them. Safari: reason 'destroyed' or 'unknown', message always ''. */
  reason: string | null
  message: string
  /** Whether the renderer was being disposed by us when it was lost (we never destroy it otherwise). */
  weDisposed: boolean
  level: number
  rung: number
  pixelRatio: number
  canvas: [number, number]
  visibility: string
  view: string
  frames: number
  memory: InfoMemory | null
  /** Live WebGPU texture and buffer bytes, with ?gpuTrace=1 only. */
  liveBytes: number | null
  commandBuffers: { encoders: number; finished: number; submitted: number; notSubmitted: number; unfinished: number } | null
  recent: string[]
}

export class LossRecorder {
  private readonly events: { t: number; what: string }[] = []
  private readonly counts = { encoders: 0, finished: 0, submitted: 0 }
  private counting = false
  private liveBytes: number | null = null
  /** The record written by an earlier page in this tab, read once at start. */
  readonly previous: DeviceLossRecord | null
  current: DeviceLossRecord | null = null

  constructor(private readonly renderer: LossRendererLike, private readonly ctx: LossContext, private readonly storage: Storage_ | null = sessionStorageOrNull(), trace = false) {
    this.previous = readRecord(this.storage)
    this.watchRenderer()
    this.watchDevice(trace)
    if (typeof window !== 'undefined') {
      const note = (what: string) => () => this.note(what)
      window.addEventListener('resize', () => this.note(`resize ${innerWidth}x${innerHeight}`))
      document.addEventListener('visibilitychange', () => this.note(`page ${document.visibilityState}`))
      window.addEventListener('pagehide', note('pagehide'))
      window.addEventListener('pageshow', note('pageshow'))
      window.addEventListener('mira:quality', event => {
        const d = (event as CustomEvent<{ level?: number; rung?: number; reason?: string }>).detail
        this.note(`quality level ${d?.level} rung ${d?.rung}${d?.reason ? ` (${d.reason})` : ''}`)
      })
    }
  }

  /** Something worth knowing if the device is lost within the next seconds. */
  note(what: string): void {
    this.events.push({ t: now(), what })
    if (this.events.length > MAX_EVENTS) this.events.shift()
  }

  private lastView = ''
  /** Once per frame from the game loop: notes the view changing (lobby, covered, playing). */
  frame(): void {
    const view = this.ctx.view()
    if (view !== this.lastView) { if (this.lastView) this.note(`view ${this.lastView} → ${view}`); this.lastView = view }
  }

  private watchRenderer(): void {
    const r = this.renderer
    if (r.setPixelRatio) { const set = r.setPixelRatio.bind(r); r.setPixelRatio = value => { if (value !== r.getPixelRatio()) this.note(`pixel ratio ${value}`); set(value) } }
    if (r.setSize) { const set = r.setSize.bind(r); r.setSize = (w, h, style) => { this.note(`size ${Math.round(w)}x${Math.round(h)}`); set(w, h, style) } }
  }

  /** Counts on this device's own objects only: no prototypes touched, no other renderer counted. */
  private watchDevice(trace: boolean): void {
    const device = (this.renderer.backend as { device?: GPUDevice } | undefined)?.device
    if (!device || typeof device.createCommandEncoder !== 'function') return
    this.counting = true
    const counts = this.counts
    const create = device.createCommandEncoder.bind(device)
    device.createCommandEncoder = (descriptor?: GPUCommandEncoderDescriptor) => {
      const encoder = create(descriptor)
      counts.encoders++
      const finish = encoder.finish.bind(encoder)
      encoder.finish = (d?: GPUCommandBufferDescriptor) => { counts.finished++; return finish(d) }
      return encoder
    }
    const queue = device.queue, submit = queue.submit.bind(queue)
    queue.submit = (buffers: Iterable<GPUCommandBuffer>) => { counts.submitted += Array.from(buffers).length; return submit(buffers) }
    if (!trace) return
    this.liveBytes = 0
    const live = new WeakMap<object, number>()
    const texture = device.createTexture.bind(device), buffer = device.createBuffer.bind(device)
    device.createTexture = (d: GPUTextureDescriptor) => {
      const t = texture(d), bytes = textureBytes(d)
      live.set(t, bytes); this.liveBytes! += bytes
      const destroy = t.destroy.bind(t); t.destroy = () => { this.liveBytes! -= live.get(t) ?? 0; live.delete(t); destroy() }
      return t
    }
    device.createBuffer = (d: GPUBufferDescriptor) => {
      const b = buffer(d)
      live.set(b, d.size); this.liveBytes! += d.size
      const destroy = b.destroy.bind(b); b.destroy = () => { this.liveBytes! -= live.get(b) ?? 0; live.delete(b); destroy() }
      return b
    }
  }

  /** At the moment the device is lost: build the record, keep it, and write it for the next page. */
  record(info: { api?: string; reason?: string | null; message?: string; originalEvent?: unknown }, weDisposed: boolean): DeviceLossRecord {
    const original = info.originalEvent as { reason?: string; message?: string } | undefined
    const t = now(), c = this.counts
    const canvas = this.renderer.domElement
    const record: DeviceLossRecord = {
      at: new Date().toISOString(),
      sinceStartS: round(t),
      api: info.api ?? 'GPU',
      reason: original?.reason ?? info.reason ?? null,
      message: original && typeof original.message === 'string' ? original.message : info.message ?? '',
      weDisposed,
      level: this.ctx.level(), rung: this.ctx.rung(),
      pixelRatio: this.renderer.getPixelRatio(),
      canvas: [canvas?.width ?? 0, canvas?.height ?? 0],
      visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
      view: this.ctx.view(), frames: this.ctx.frames(),
      memory: this.renderer.info?.memory ? { ...this.renderer.info.memory } : null,
      liveBytes: this.liveBytes,
      commandBuffers: this.counting ? { ...c, notSubmitted: c.finished - c.submitted, unfinished: c.encoders - c.finished } : null,
      recent: this.events.filter(e => t - e.t <= RECENT_S).map(e => `-${round(t - e.t)} s ${e.what}`),
    }
    this.current = record
    try { this.storage?.setItem(LOSS_KEY, JSON.stringify(record)) } catch { /* Storage is optional. */ }
    return record
  }

  /** Command encoders so far, for the report while nothing is lost. */
  commandBufferLine(): string | null {
    if (!this.counting) return null
    const c = this.counts
    return `WebGPU command encoders: ${c.encoders} created, ${c.finished} finished, ${c.submitted} submitted (${c.finished - c.submitted} finished but not submitted, ${c.encoders - c.finished} never finished)`
  }

  /** Lines for the Diagnostics report: this page's loss and the last page's, if any. */
  reportLines(): string[] {
    const lines: string[] = []
    const line = this.commandBufferLine()
    if (line) lines.push(line)
    if (this.liveBytes !== null) lines.push(`Live WebGPU memory (gpuTrace): ${(this.liveBytes / 1048576).toFixed(1)} MB`)
    if (this.current) lines.push(...describe('Device loss on this page', this.current))
    if (this.previous) lines.push(...describe('Device loss on the previous page in this tab', this.previous))
    return lines
  }
}

export function describe(title: string, r: DeviceLossRecord): string[] {
  const mem = r.memory ? `textures ${r.memory.textures} (${mb(r.memory.texturesSize)} MB), geometries ${r.memory.geometries}, attributes ${mb(r.memory.attributesSize)} MB, render targets ${r.memory.renderTargets}, programs ${r.memory.programs}, three's total ${mb(r.memory.total)} MB` : 'no counts'
  const cb = r.commandBuffers ? `${r.commandBuffers.encoders} encoders, ${r.commandBuffers.submitted} submitted, ${r.commandBuffers.notSubmitted} finished but not submitted, ${r.commandBuffers.unfinished} never finished` : 'not counted (not WebGPU)'
  return [
    `${title}: ${r.at}, ${r.sinceStartS} s after the page started`,
    `  reason ${r.reason === null ? 'none' : `'${r.reason}'`}, message ${r.message ? `'${r.message}'` : 'empty'}, ${r.weDisposed ? 'while we were disposing the renderer' : 'we did not dispose'}`,
    `  level ${r.level} rung ${r.rung}, pixel ratio ${r.pixelRatio}, canvas ${r.canvas[0]}x${r.canvas[1]}, page ${r.visibility}, view ${r.view}, frame ${r.frames}`,
    `  memory: ${mem}${r.liveBytes !== null ? `, live WebGPU ${mb(r.liveBytes)} MB` : ''}`,
    `  command buffers: ${cb}`,
    `  last ${RECENT_S} s: ${r.recent.length ? r.recent.join('; ') : 'nothing noted'}`,
  ]
}

const BYTES: Record<string, number> = { r8unorm: 1, rg8unorm: 2, r16float: 2, depth16unorm: 2, rgba16float: 8, rgba32float: 16, rg32float: 8, rg16float: 4, 'depth32float-stencil8': 5 }
function textureBytes(d: GPUTextureDescriptor): number {
  const s = d.size as GPUExtent3DDict & number[]
  const w = s.width ?? s[0] ?? 1, h = s.height ?? s[1] ?? 1, layers = s.depthOrArrayLayers ?? s[2] ?? 1
  const bpp = BYTES[d.format] ?? 4
  let bytes = 0
  for (let m = 0, mw = w, mh = h; m < (d.mipLevelCount ?? 1); m++, mw = Math.max(1, mw >> 1), mh = Math.max(1, mh >> 1)) bytes += mw * mh * layers * bpp
  return bytes * (d.sampleCount ?? 1)
}
function readRecord(storage: Storage_ | null): DeviceLossRecord | null {
  try { const raw = storage?.getItem(LOSS_KEY); return raw ? JSON.parse(raw) as DeviceLossRecord : null } catch { return null }
}
function sessionStorageOrNull(): Storage_ | null { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null } }
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000
const round = (s: number) => Math.round(s * 10) / 10
const mb = (bytes: number | undefined) => ((bytes ?? 0) / 1048576).toFixed(1)
