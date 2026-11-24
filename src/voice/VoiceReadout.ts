import type { VoiceCandidateTypes, VoiceMicSettings, VoiceSession } from './VoiceSession'

interface AudioSnapshot {
  sessionType: string
  contextState: string
  sampleRate?: number
}

interface CaptureSnapshot extends AudioSnapshot {
  elapsed: number
  route: string
  connected: boolean
  echoCancellation?: VoiceMicSettings['echoCancellation']
}

// Classify only the active sink. Never display or store a device ID or label.
async function outputRoute(context?: AudioContext): Promise<string> {
  if (!context || !('sinkId' in context)) return 'unavailable'
  const sink = context.sinkId
  if (typeof sink !== 'string') return 'silent output'
  const fallback = sink ? 'selected output (route unavailable)' : 'system default (route unavailable)'
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const selected = devices.find(d => d.kind === 'audiooutput' && d.deviceId === (sink || 'default'))
    const label = selected?.label ?? ''
    if (/headphone|headset|airpods|earbud/i.test(label)) return 'headphones'
    if (/earpiece|receiver/i.test(label)) return 'earpiece'
    if (/speaker/i.test(label)) return 'speaker'
    if (/bluetooth/i.test(label)) return 'Bluetooth output'
  } catch { /* A browser may withhold output information. */ }
  return fallback
}

function describeCapture(label: string, snapshot?: CaptureSnapshot): string {
  if (!snapshot) return label + ' · no sample'
  return [describeAudio(label, snapshot), 'Output route · ' + snapshot.route,
    'Echo cancellation · ' + setting(snapshot.echoCancellation),
    'Peer connected · ' + (snapshot.connected ? 'yes' : 'no')].join('\n')
}

interface FrameSample {
  time: number
  interval: number
}

interface FrameWindow {
  live: boolean
  previous: number
  samples: FrameSample[]
  start: number
}

interface FrameSummary {
  median: number
  worst: number
  count: number
}

const frameWindowMs = 10_000
const refreshMs = 1000
const audioSessionTypes = new Set<unknown>([
  'auto', 'playback', 'transient', 'transient-solo', 'ambient', 'play-and-record',
])
const audioContextStates = new Set<unknown>(['running', 'suspended', 'interrupted', 'closed'])

function audioSnapshot(context?: AudioContext): AudioSnapshot {
  const type = (navigator as Navigator & { audioSession?: { type?: string } }).audioSession?.type
  const state = context?.state
  return {
    sessionType: type && audioSessionTypes.has(type) ? type : 'unavailable',
    contextState: state && audioContextStates.has(state) ? state : 'unavailable',
    sampleRate: context?.sampleRate,
  }
}

function sampleRate(rate?: number): string {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? `${rate} Hz` : 'unavailable'
}

function describeAudio(label: string, snapshot?: AudioSnapshot): string {
  if (!snapshot) return `${label} · no sample`
  return `${label} · session ${snapshot.sessionType}\nContext · ${snapshot.contextState} · ${sampleRate(snapshot.sampleRate)}`
}

function setting(value?: boolean | string): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return value ?? 'unavailable'
}

function summarize(window: FrameWindow): FrameSummary | undefined {
  const intervals = window.samples.slice(window.start).map(sample => sample.interval).sort((a, b) => a - b)
  const count = intervals.length
  if (!count) return
  const mid = Math.floor(count / 2)
  const median = count % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2
  return { median, worst: intervals[count - 1], count }
}

function describeFrames(live: boolean, frames?: FrameSummary): string {
  const label = live ? 'Voice on' : 'Voice off'
  if (!frames) return `${label} · no driving sample`
  return `${label} · median ${frames.median.toFixed(1)} ms\nWorst ${frames.worst.toFixed(1)} ms · ${frames.count} frames`
}

export class VoiceReadout {
  readonly element = document.createElement('details')
  private readonly report = document.createElement('div')
  private permission?: PermissionStatus
  private failure = ''
  private readonly refreshPermission = () => this.render()
  private left?: AudioSnapshot
  private connection = ''
  private readonly route = document.createElement('select')
  private readonly heard = { before: '', during: '', left: '' }
  private phase: keyof typeof this.heard = 'before'
  private before?: AudioSnapshot
  private secondTimer?: ReturnType<typeof setTimeout>
  private later?: CaptureSnapshot
  private after?: CaptureSnapshot
  private mic?: VoiceMicSettings
  private pairs: VoiceCandidateTypes[] = []
  private capture?: { session: VoiceSession }
  private timer?: ReturnType<typeof setTimeout>
  private active?: FrameWindow
  private readonly completed = new Map<boolean, FrameSummary>()
  private nextRenderAt = 0
  private disposed = false
  private readonly onToggle = () => { if (this.element.open) this.render() }
  private readonly onVisibility = () => { if (document.hidden) this.finishWindow() }

  constructor(private readonly context: () => AudioContext | undefined, private readonly listenOnly: boolean, private readonly otherHumans: () => number) {
    const summary = document.createElement('summary')
    summary.textContent = 'Voice diagnostics'
    this.element.style.cssText = 'box-sizing:border-box;width:max-content;max-width:100%;margin:4px auto 0;background:#171c23;color:white;padding:4px 8px;text-align:left;font:12px/1.4 system-ui,sans-serif;border-radius:4px'
    summary.style.cursor = 'pointer'
    this.report.style.cssText = 'max-height:65dvh;overflow:auto;white-space:pre-line;overflow-wrap:anywhere;font-variant-numeric:tabular-nums'
    const label = document.createElement('label')
    label.textContent = 'Output I hear · '
    for (const name of ['', 'Phone speaker', 'Earpiece', 'Headphones', 'Other']) {
      this.route.add(new Option(name || 'Choose route', name))
    }
    this.route.onchange = () => {
      this.heard[this.phase] = this.route.value
      this.render()
    }
    label.append(this.route)
    this.element.append(summary, label, this.report)
    this.element.addEventListener('toggle', this.onToggle)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.render()
    void this.observePermission()
  }

  private async observePermission() {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
      if (!status || this.disposed) return
      this.permission = status
      status.addEventListener('change', this.refreshPermission)
      this.render()
    } catch { /* Some Safari versions do not expose the microphone permission state. */ }
  }

  setFailure(description: string) {
    this.failure = description
    this.render()
  }

  beforeCapture(): void {
    if (this.disposed) return
    this.stopPolling()
    this.failure = ''
    this.heard.before = this.route.value
    this.phase = 'during'
    this.route.value = ''
    this.heard.during = this.heard.left = ''
    this.left = undefined
    this.connection = ''
    this.before = audioSnapshot(this.context())
    this.after = undefined
    this.later = undefined
    this.mic = undefined
    this.pairs = []
    this.render()
  }

  afterLeave(): void {
    this.stopPolling()
    this.phase = 'left'
    this.route.value = ''
    this.left = audioSnapshot(this.context())
    this.render()
  }

  afterCapture(session: VoiceSession): void {
    if (this.disposed || session.state.status !== 'live') return
    this.stopPolling()
    const start = performance.now()
    const snapshot = (): CaptureSnapshot => {
      const context = this.context()
      const result = { ...audioSnapshot(context), elapsed: (performance.now() - start) / 1000,
        connected: session.hasConnectedPeer, echoCancellation: session.micSettings()?.echoCancellation,
        route: 'unavailable' }
      void outputRoute(context).then(route => {
        result.route = route
        if (!this.disposed && this.element.open) this.render()
      })
      return result
    }
    this.after = snapshot()
    this.secondTimer = setTimeout(() => {
      if (this.capture?.session !== session || session.state.status !== 'live') return
      this.later = snapshot()
      this.render()
    }, 10_000)
    this.mic = session.micSettings()
    const capture = this.capture = { session }
    this.render()
    void this.poll(capture)
  }

  frame(driving: boolean, live: boolean): void {
    if (this.disposed) return
    if (!driving || document.hidden) {
      this.finishWindow()
      return
    }
    const time = performance.now()
    if (this.active?.live !== live) {
      this.finishWindow()
      this.active = { live, previous: time, samples: [], start: 0 }
    } else if (time > this.active.previous) {
      const window = this.active
      window.samples.push({ time, interval: time - window.previous })
      window.previous = time
      while (window.samples[window.start].time < time - frameWindowMs) window.start++
      if (window.start >= 256) {
        window.samples.splice(0, window.start)
        window.start = 0
      }
    }
    if (this.element.open && time >= this.nextRenderAt) this.render()
  }

  dispose(): void {
    this.disposed = true
    this.permission?.removeEventListener('change', this.refreshPermission)
    this.stopPolling()
    this.active = undefined
    this.element.removeEventListener('toggle', this.onToggle)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.element.remove()
  }

  private finishWindow(): void {
    if (!this.active) return
    const window = this.active
    this.active = undefined
    const summary = summarize(window)
    if (summary) this.completed.set(window.live, summary)
    if (this.element.open) this.render()
  }

  private async poll(capture: { session: VoiceSession }): Promise<void> {
    this.timer = undefined
    const { session } = capture
    if (this.capture !== capture || session.state.status !== 'live') return
    const pairs = await session.selectedCandidateTypes()
    if (this.capture !== capture || session.state.status !== 'live') return
    this.pairs = pairs
    this.connection = session.connectionSummary()
    if (this.element.open) this.render()
    this.timer = setTimeout(() => void this.poll(capture), refreshMs)
  }

  private stopPolling(): void {
    clearTimeout(this.secondTimer)
    clearTimeout(this.timer)
    this.timer = undefined
    this.capture = undefined
  }

  private render(): void {
    this.nextRenderAt = performance.now() + refreshMs
    const current = this.active && summarize(this.active)
    const frames = (live: boolean) =>
      (this.active?.live === live ? current : undefined) ?? this.completed.get(live)
    const mic = this.mic
    const ice = [...new Set(this.pairs.map(({ local, remote }) =>
      `Local ${local ?? 'unavailable'} · remote ${remote ?? 'unavailable'}`))].join('\n')
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const yesNo = (value: boolean) => value ? 'yes' : 'no'
    this.report.textContent = [
      this.failure || undefined,
      `Display · ${standalone ? 'standalone home-screen app' : 'browser tab'}
Secure context · ${yesNo(window.isSecureContext)}
mediaDevices · ${yesNo(!!navigator.mediaDevices)}
getUserMedia · ${yesNo(typeof navigator.mediaDevices?.getUserMedia === 'function')}
WebRTC · ${yesNo(typeof RTCPeerConnection === 'function')}
Microphone permission · ${this.permission?.state ?? 'unavailable'}`,
      `Other humans on roster · ${this.otherHumans()}`,
      this.connection || 'No voice negotiation sampled',
      describeAudio('Before joining', this.before) + '\nHeard route · ' + (this.heard.before || 'unreported'),
      describeCapture(this.listenOnly ? 'Listening' : 'Mic open', this.after) + '\nHeard route · ' + (this.heard.during || 'unreported'),
      this.after && describeCapture(this.later ? 'After ' + this.later.elapsed.toFixed(1) + ' s' : 'After 10 s', this.later),
      this.left && describeAudio('After leaving', this.left) + '\nHeard route · ' + (this.heard.left || 'unreported'),
      mic
        ? `Mic · ${sampleRate(mic.sampleRate)}\nEcho cancellation · ${setting(mic.echoCancellation)}\nNoise suppression · ${setting(mic.noiseSuppression)}\nAuto gain · ${setting(mic.autoGainControl)}`
        : this.listenOnly ? 'Listen only · microphone off' : 'Mic settings · unavailable',
      ice ? `Last selected ICE pair types\n${ice}` : 'Selected ICE pair types · unavailable',
      ['Driving frame intervals · last 10 seconds', describeFrames(false, frames(false)), describeFrames(true, frames(true))].join('\n'),
    ].filter(Boolean).join('\n\n')
  }
}
