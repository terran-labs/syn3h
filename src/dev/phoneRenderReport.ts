/** Passed after Game.frame finishes its measured work. All times are in milliseconds. */
export interface PhoneRenderFrame {
  /** Consecutive game-frame ID, unique for this recorder and also used by delayed GPU results. */
  frame: number
  /** Frame start on the performance.now() clock. */
  startMs: number
  /** Interval since the preceding game-frame start. */
  intervalMs: number
  cpuMs: number
  /** Renderer calls made during this game frame, including passes. */
  renderCalls: number
  quality: number
  backend: 'webgpu' | 'webgl'
  /** True during visible gameplay. Pass false for lobby, loading, or covered play. */
  playing: boolean
}

export interface PhoneRenderGpuResult {
  frame: number
  /** Sum of available GPU timings for the frame's measured passes, if available. */
  gpuMs: number
}

export interface PhoneRenderRecorder {
  readonly element: HTMLElement
  recordFrame(sample: PhoneRenderFrame): void
  recordGpu(result: PhoneRenderGpuResult): void
  /** Call if play ends or pauses without another game frame. Ends the current run. */
  interrupt(reason: string): void
  dispose(): void
}

const MINUTE = 60_000
const RUN = 10 * MINUTE
const HITCH = 50

type Reading = Omit<PhoneRenderFrame, 'playing' | 'startMs' | 'intervalMs'> & {
  elapsedMs: number
  intervalMs: number | null
  gpuMs?: number
}

function validDuration(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0
}

function percentiles(values: number[], unit: string): string {
  if (values.length === 0) return 'unavailable'
  values.sort((a, b) => a - b)
  const at = (fraction: number) => values[Math.ceil(values.length * fraction) - 1].toFixed(1)
  return `p50 ${at(.5)}${unit}, p95 ${at(.95)}${unit}`
}

function summarize(name: string, readings: Reading[], durationMs: number): string {
  const intervals: number[] = [], cpu: number[] = [], gpu: number[] = [], calls: number[] = []
  let hitches = 0
  let worst: (Reading & { intervalMs: number }) | undefined
  const settings = new Set<string>()
  for (const reading of readings) {
    const { intervalMs, cpuMs, gpuMs, renderCalls, backend, quality } = reading
    settings.add(`${backend} quality ${quality}`)
    if (intervalMs !== null) {
      intervals.push(intervalMs)
      if (intervalMs > HITCH) hitches++
      if (!worst || intervalMs > worst.intervalMs) worst = { ...reading, intervalMs }
    }
    if (validDuration(cpuMs)) cpu.push(cpuMs)
    if (gpuMs !== undefined) gpu.push(gpuMs)
    if (validDuration(renderCalls)) calls.push(renderCalls)
  }
  return [
    `${name} (${(durationMs / 1000).toFixed(1)} s, ${readings.length} frames)`,
    `Backend and quality  ${[...settings].join(', ') || 'unavailable'}`,
    `Frame interval  ${percentiles(intervals, ' ms')}`,
    `Intervals over ${HITCH} ms  ${hitches}`,
    `Worst interval  ${worst ? `${worst.intervalMs.toFixed(1)} ms ending at game frame ${worst.frame} (${(worst.elapsedMs / 1000).toFixed(2)} s)` : 'unavailable'}`,
    `Game-frame CPU  ${percentiles(cpu, ' ms')}`,
    `Measured GPU  ${percentiles(gpu, ' ms')} (${gpu.length}/${readings.length} frames)`,
    `Render calls per frame  ${percentiles(calls, '')}`,
  ].join('\n')
}

/** Mount an opt-in recorder. Keep it local to the game instance that supplies its frame IDs. */
export function createPhoneRenderRecorder(parent: HTMLElement = document.body): PhoneRenderRecorder {
  const doc = parent.ownerDocument
  const element = doc.createElement('section')
  element.setAttribute('aria-label', 'Phone render recorder')
  element.style.cssText = 'position:fixed;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));z-index:2147483645;box-sizing:border-box;max-width:calc(100vw - 16px);padding:6px 8px;border:1px solid #777;border-radius:8px;background:#161616;color:#fff;font:14px/1.4 system-ui,sans-serif'
  const button = (label: string) => {
    const control = doc.createElement('button')
    control.type = 'button'
    control.textContent = label
    control.style.cssText = 'min-height:44px;font:inherit;padding:4px 8px;cursor:pointer'
    return control
  }
  const start = button('Record')
  const show = button('Show report')
  show.disabled = true
  show.setAttribute('aria-expanded', 'false')
  const status = doc.createElement('span')
  status.style.cssText = 'display:inline-block;margin:0 6px'
  status.textContent = 'Render recorder'
  const announcement = doc.createElement('span')
  announcement.setAttribute('role', 'status')
  announcement.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap'

  const report = doc.createElement('div')
  report.hidden = true
  const output = doc.createElement('textarea')
  output.readOnly = true
  output.setAttribute('aria-label', 'Phone render report text')
  output.style.cssText = 'display:block;box-sizing:border-box;width:min(34rem,calc(100vw - 36px));height:min(47vh,24rem);height:min(47dvh,24rem);padding:8px;color:#fff;background:#242424;font:13px/1.45 ui-monospace,monospace'
  const copy = button('Copy report')
  const copyStatus = doc.createElement('span')
  copyStatus.setAttribute('role', 'status')
  copyStatus.style.marginInlineStart = '6px'
  report.append(output, copy, copyStatus)
  element.append(status, start, show, announcement, report)
  parent.append(element)

  let state: 'idle' | 'armed' | 'recording' | 'ended' = 'idle'
  let startedAt = 0
  let elapsedMs = 0
  let shownSecond = -1
  let endReason = ''
  let lastFrame = -1
  const samples: Reading[] = []
  const byFrame = new Map<number, Reading>()

  function announce(message: string): void {
    status.textContent = message
    announcement.textContent = message
  }

  function reportText(): string {
    const first = samples.filter(sample => sample.elapsedMs < MINUTE)
    const lines = [
      'Syn3h phone render report',
      state === 'ended' ? endReason : 'Recording in progress',
      summarize('First minute', first, Math.min(elapsedMs, MINUTE)),
    ]
    if (elapsedMs === RUN) {
      lines.push(summarize('Full ten minutes', samples, RUN))
      lines.push(summarize('Final minute', samples.filter(sample => sample.elapsedMs >= RUN - MINUTE), MINUTE))
    }
    return lines.join('\n\n')
  }

  function finish(reason: string, message: string): void {
    if (state !== 'recording' && state !== 'armed') return
    state = 'ended'
    endReason = reason
    announce(message)
    start.textContent = 'Record again'
    show.disabled = false
    if (!report.hidden) output.value = reportText()
  }

  function interrupt(reason: string): void {
    finish(`Interrupted at ${(elapsedMs / 1000).toFixed(1)} s. ${reason}`, 'Recording interrupted')
  }

  function pageHidden(): void {
    interrupt('The page was hidden.')
  }

  function visibilityChanged(): void {
    if (doc.visibilityState !== 'visible') pageHidden()
  }

  start.addEventListener('click', () => {
    if (state === 'armed' || state === 'recording') {
      finish(`Stopped by the player at ${(elapsedMs / 1000).toFixed(1)} s.`, 'Recording stopped')
      return
    }
    if (doc.visibilityState !== 'visible') return
    samples.length = 0
    byFrame.clear()
    elapsedMs = 0
    shownSecond = -1
    state = 'armed'
    report.hidden = true
    show.textContent = 'Show report'
    show.setAttribute('aria-expanded', 'false')
    show.disabled = true
    start.textContent = 'Stop'
    announce('Waiting for play')
  })
  show.addEventListener('click', () => {
    report.hidden = !report.hidden
    show.textContent = report.hidden ? 'Show report' : 'Hide report'
    show.setAttribute('aria-expanded', String(!report.hidden))
    if (!report.hidden) {
      copyStatus.textContent = ''
      output.value = reportText()
    }
  })
  copy.addEventListener('click', async () => {
    const text = reportText()
    output.value = text
    try {
      const clipboard = doc.defaultView?.navigator.clipboard
      if (!clipboard) throw new Error('Clipboard unavailable')
      await clipboard.writeText(text)
      copyStatus.textContent = 'Copied'
    } catch {
      output.focus()
      output.select()
      copyStatus.textContent = 'Copy unavailable. Select and copy the report text.'
    }
  })
  doc.addEventListener('visibilitychange', visibilityChanged)
  doc.defaultView?.addEventListener('pagehide', pageHidden)

  return {
    element,
    recordFrame(sample) {
      if (state !== 'recording' && state !== 'armed') return
      if (doc.visibilityState !== 'visible') { visibilityChanged(); return }
      if (!sample.playing) {
        if (state === 'recording') interrupt('Gameplay stopped.')
        return
      }
      if (sample.frame <= lastFrame || !validDuration(sample.startMs)) return
      const firstFrame = state === 'armed'
      if (firstFrame) {
        startedAt = sample.startMs
        state = 'recording'
        announce('Recording')
      } else if (sample.frame !== lastFrame + 1) {
        interrupt('The game-frame feed skipped a frame.')
        return
      }
      lastFrame = sample.frame
      elapsedMs = Math.min(RUN, sample.startMs - startedAt)
      if (elapsedMs === RUN) {
        finish('Completed ten minutes of visible play.', 'Recording complete')
        return
      }
      const { frame, cpuMs, renderCalls, quality, backend } = sample
      const intervalMs = firstFrame || !validDuration(sample.intervalMs) ? null : sample.intervalMs
      const reading: Reading = { frame, elapsedMs, intervalMs, cpuMs, renderCalls, quality, backend }
      samples.push(reading)
      byFrame.set(frame, reading)
      show.disabled = false
      const second = Math.floor(elapsedMs / 1000)
      if (second !== shownSecond) {
        shownSecond = second
        const remainder = String(second % 60).padStart(2, '0')
        status.textContent = `Recording ${Math.floor(second / 60)}:${remainder}`
      }
    },
    recordGpu({ frame, gpuMs }) {
      const reading = byFrame.get(frame)
      if (reading && validDuration(gpuMs)) reading.gpuMs = gpuMs
    },
    interrupt,
    dispose() {
      doc.removeEventListener('visibilitychange', visibilityChanged)
      doc.defaultView?.removeEventListener('pagehide', pageHidden)
      state = 'idle'
      samples.length = 0
      byFrame.clear()
      element.remove()
    },
  }
}
