/**
 * ?frameCanary=1: counts WebGPU command buffers the browser accepted but never ran.
 *
 * Safari's WebGPU drops a Metal command buffer that fails with certain errors (an "innocent
 * victim" of a GPU reset, underlying code 5, or code 0x10a) without telling the page: no
 * uncapturederror, no device loss, and the canvas shows transparent black for that frame
 * (WebKit Queue.mm and PresentationContextIOSurface.mm, read 24 November 2026). The blank-frame
 * recorder cannot see it on Safari. This can.
 *
 * Every command encoder the game finishes gets one 4-byte copy appended just before it finishes:
 * a marker into its own slot of a small ring buffer, the slot cleared by writeBuffer just before
 * (a queue write, ordered before the buffer's submit). A buffer that runs leaves its marker; one
 * that is dropped leaves the slot clear. Every READ_EVERY buffers, a copy of the ring into a
 * mappable buffer rides in the same encoder, after its own marker, and is mapped once submitted;
 * the slots of every buffer submitted up to it are checked then. If the copying buffer is itself
 * dropped, its staging keeps a sentinel and that is counted too. No extra submit, no change to
 * three: the encoder and queue of this one device are wrapped, nothing else.
 *
 * Each dropped buffer is reported with the frame it belonged to and what happened in the 15
 * seconds before (quality steps, pixel ratio and size changes, the page hidden or shown).
 */

import { RecentEvents, now } from './recentEvents'

export const CANARY_SLOTS = 4096
const READ_EVERY = 64
const SENTINEL = 0xdeadbeef
const RECENT_S = 15
/** GPUBufferUsage and GPUMapMode bits, fixed by the WebGPU specification (the runtime objects are not typed here). */
const U = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8 }, MAP_READ_MODE = 0x1

interface CanaryHost { frames(): number; pixelRatio(): number }
export interface DroppedBuffer { seq: number; frame: number; at: number; recent: string[] }

export class FrameCanary {
  /** Command buffers submitted and checked so far, and those that never ran. */
  checked = 0
  dropped = 0
  readonly lastDropped: DroppedBuffer[] = []
  private readonly droppedTimes: number[] = []
  private seq = 0
  private checkedUpTo = -1
  private readonly frameOf = new Map<number, number>()
  private readonly submitted = new Set<number>()
  private readonly events = new RecentEvents()
  private readonly ring: GPUBuffer
  private readonly ones: GPUBuffer
  private readonly zero = new Uint32Array(1)
  private readonly sentinel: Uint32Array
  private readonly staging: GPUBuffer[] = []
  private readonly stagingBusy: boolean[] = []
  private readonly bufferSeq = new WeakMap<GPUCommandBuffer, number>()
  /** Test hook: the next command buffer submitted is withheld (never submitted). */
  private withhold = 0
  withheld = 0

  constructor(private readonly device: GPUDevice, private readonly host: CanaryHost) {
    this.ring = device.createBuffer({ label: 'frame canary ring', size: CANARY_SLOTS * 4, usage: U.COPY_DST | U.COPY_SRC })
    this.ones = device.createBuffer({ label: 'frame canary marker', size: 4, usage: U.COPY_SRC, mappedAtCreation: true })
    new Uint32Array(this.ones.getMappedRange()).fill(1); this.ones.unmap()
    this.sentinel = new Uint32Array(CANARY_SLOTS).fill(SENTINEL)
    for (let i = 0; i < 3; i++) { this.staging.push(device.createBuffer({ label: `frame canary readback ${i}`, size: CANARY_SLOTS * 4, usage: U.MAP_READ | U.COPY_DST })); this.stagingBusy.push(false) }
    this.wrap()
  }

  note(what: string): void { this.events.note(what) }

  /** Command buffers dropped in the last minute. */
  lastMinute(): number { const t = now(); while (this.droppedTimes.length && t - this.droppedTimes[0] > 60) this.droppedTimes.shift(); return this.droppedTimes.length }

  /** Test hook for the browser check: withhold the next `n` submitted command buffers. */
  withholdNext(n = 1): void { this.withhold += n }

  private wrap(): void {
    const device = this.device, create = device.createCommandEncoder.bind(device)
    device.createCommandEncoder = (descriptor?: GPUCommandEncoderDescriptor) => {
      const encoder = create(descriptor)
      const finish = encoder.finish.bind(encoder)
      encoder.finish = (d?: GPUCommandBufferDescriptor) => {
        this.events.pixelRatio(this.host.pixelRatio())
        const n = this.seq++, slot = n % CANARY_SLOTS
        // Clear this buffer's slot on the queue (ordered before its submit), then mark it from inside.
        device.queue.writeBuffer(this.ring, slot * 4, this.zero)
        encoder.copyBufferToBuffer(this.ones, 0, this.ring, slot * 4, 4)
        this.frameOf.set(n, this.host.frames())
        let read = -1
        if (n % READ_EVERY === READ_EVERY - 1) {
          read = this.stagingBusy.indexOf(false)
          if (read >= 0) {
            this.stagingBusy[read] = true
            device.queue.writeBuffer(this.staging[read], 0, this.sentinel)
            encoder.copyBufferToBuffer(this.ring, 0, this.staging[read], 0, CANARY_SLOTS * 4)
          }
        }
        const buffer = finish(d)
        this.bufferSeq.set(buffer, n)
        if (read >= 0) this.pendingRead.set(n, read)
        return buffer
      }
      return encoder
    }
    const queue = device.queue, submit = queue.submit.bind(queue)
    queue.submit = (buffers: Iterable<GPUCommandBuffer>) => {
      const all = Array.from(buffers)
      let list = all
      // The test hook: the last buffer is accepted as far as the game knows, and never runs,
      // exactly what a silently dropped command buffer looks like.
      if (this.withhold > 0 && list.length) {
        this.withhold--; this.withheld++
        const held = list[list.length - 1], n = this.bufferSeq.get(held)
        list = list.slice(0, -1)
        if (n !== undefined) {
          this.submitted.add(n)
          const read = this.pendingRead.get(n)
          if (read !== undefined) { this.pendingRead.delete(n); this.stagingBusy[read] = false }
        }
      }
      submit(list)
      for (const b of list) {
        const n = this.bufferSeq.get(b)
        if (n === undefined) continue
        this.submitted.add(n)
        const read = this.pendingRead.get(n)
        if (read !== undefined) { this.pendingRead.delete(n); void this.check(n, read) }
      }
    }
  }
  private readonly pendingRead = new Map<number, number>()

  /** Read the ring as the buffer `upTo` left it: every submitted buffer up to it should have marked its slot. */
  private async check(upTo: number, read: number): Promise<void> {
    const staging = this.staging[read]
    try {
      await staging.mapAsync(MAP_READ_MODE)
      const ring = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      // The reading buffer itself never ran: count it; the others are checked by the next read.
      if (ring[upTo % CANARY_SLOTS] === SENTINEL) { this.submitted.delete(upTo); this.checked++; this.drop(upTo); return }
      const from = Math.max(this.checkedUpTo + 1, upTo - CANARY_SLOTS + 1)
      for (let n = from; n <= upTo; n++) {
        if (!this.submitted.has(n)) continue // never submitted by the game: not the browser's doing
        this.submitted.delete(n); this.checked++
        if (ring[n % CANARY_SLOTS] !== 1) this.drop(n)
        this.frameOf.delete(n)
      }
      this.checkedUpTo = upTo
    } catch { /* A lost device: the loss record says so. */ } finally { this.stagingBusy[read] = false }
  }

  private drop(n: number): void {
    this.dropped++
    const t = now()
    this.droppedTimes.push(t)
    this.lastDropped.push({ seq: n, frame: this.frameOf.get(n) ?? -1, at: t, recent: this.events.within(RECENT_S, t) })
    if (this.lastDropped.length > 5) this.lastDropped.shift()
  }

  /** For the on-screen counter: two short lines. */
  counterLines(): string {
    const last = this.lastDropped.slice(-3).map(d => `#${d.frame}${d.recent.length ? ` (${d.recent.at(-1)})` : ''}`).join(', ')
    // Test drop (ui/flashCounter.ts) withholds one: "Dropped" must rise by as many as were withheld.
    return `Dropped ${this.dropped} of ${this.checked} (${this.lastMinute()}/min)${this.withheld ? `  test drops ${this.withheld}` : ''}\nLast dropped: ${last || '-'}`
  }

  /** For the copied report. */
  reportLines(): string[] {
    return [
      `Frame canary: ${this.dropped} of ${this.checked} command buffers dropped (${this.lastMinute()} in the last minute)${this.withheld ? `, ${this.withheld} withheld by the test hook` : ''}`,
      ...this.lastDropped.map(d => `  dropped buffer ${d.seq} in frame ${d.frame}; last ${RECENT_S} s: ${d.recent.join('; ') || 'nothing noted'}`),
    ]
  }
}

