/** Start-to-start game-frame intervals. Spans are synchronous and inclusive: a pipeline
 * creation inside a render call appears in both rows. Neither measures GPU execution. */
const CAPACITY = 512
const LABELS = 64
const EVENTS = 12
const THRESHOLD_MS = 1000 / 30

function sample() {
  return {
    frame: 0, startMs: 0, intervalMs: 0, callbackMs: 0,
    accountedMs: 0, focus: 'foreground', partialCoverage: false, backend: '', quality: -1, vehicle: '', view: '', warmVehicle: '', lastEvent: '', lastEventMs: 0,
    counts: new Uint32Array(LABELS), ms: new Float64Array(LABELS),
    events: new Array<string>(EVENTS).fill(''), eventCount: 0, eventsTruncated: false,
  }
}

export class LongFrames {
  private readonly ring = Array.from({ length: CAPACITY }, sample)
  private readonly current = sample()
  private readonly labels = ['Other instrumented work']
  private readonly ids = new Map<string, number>()
  private active = false
  private sequence = 0
  private lastEvent = ''
  private lastEventMs = 0

  // Sample end times let a copy request expire gameplay samples even while a menu is open.
  private readonly playEnds = new Float64Array(32768)
  private readonly playDurations = new Float32Array(this.playEnds.length)
  private played = 0
  private readonly top = [this.makeTop(), this.makeTop()]
  private readonly longCounts = [0, 0]
  private excluded = 0
  private foreground = true
  private settlingUntil = 0
  private finishedCallback = false
  // Timed handlers between callbacks sometimes nest. Their end times arrive in order.
  private readonly starts = new Float64Array(128)
  private readonly ends = new Float64Array(this.starts.length)
  private regions = 0

  private makeTop() {
    return Array.from({ length: 10 }, () => ({
      duration: 0, frame: 0, trigger: '', span: '', spanMs: 0, accounted: 0, partial: false,
    }))
  }

  focusChanged(foreground: boolean, now: number) {
    if (this.foreground === foreground) return
    this.foreground = foreground
    this.settlingUntil = now + 1000
    // A transition between callbacks also disqualifies the interval crossing it.
    if (this.active) this.current.focus = foreground ? 'returning to foreground' : 'background'
  }

  private coverOutsideCallback(start: number, end: number) {
    if (!this.finishedCallback) return
    start = Math.max(start, this.current.startMs + this.current.callbackMs)
    if (end <= start) return
    while (this.regions && this.ends[this.regions - 1] >= start) {
      start = Math.min(start, this.starts[--this.regions])
    }
    if (this.regions === this.starts.length) {
      this.current.partialCoverage = true
      return
    }
    this.starts[this.regions] = start
    this.ends[this.regions++] = end
  }

  start() { return performance.now() }
  end(name: string, start: number) {
    if (!this.active) return
    let id = this.ids.get(name)
    if (id === undefined) {
      if (this.labels.length >= LABELS) id = 0
      else { id = this.labels.length; this.labels.push(name); this.ids.set(name, id) }
    }
    const end = performance.now()
    this.current.ms[id] += end - start
    this.coverOutsideCallback(start, end)
    this.current.counts[id]++
  }

  event(name: string) {
    if (!this.active) return
    this.lastEvent = name
    this.lastEventMs = performance.now()
    const row = this.current
    for (let i = 0; i < row.eventCount; i++) if (row.events[i] === name) return
    if (row.eventCount < EVENTS) row.events[row.eventCount++] = name
    else row.eventsTruncated = true
  }

  /** Called before this callback does any work. Seal the preceding interval, including
   * input and network handlers that ran between the two callbacks. */
  begin(now: number, frame: number, backend: string, quality: number, vehicle: string) {
    const row = this.current
    if (this.active && row.focus === 'foreground' && row.view === 'playing') {
      const at = this.played++ % this.playEnds.length
      this.playEnds[at] = now
      this.playDurations[at] = now - row.startMs
    }
    if (this.active && now - row.startMs > THRESHOLD_MS) {
      const saved = this.ring[this.sequence++ % CAPACITY]
      saved.startMs = row.startMs; saved.intervalMs = now - row.startMs
      saved.frame = row.frame; saved.callbackMs = row.callbackMs
      saved.backend = row.backend; saved.quality = row.quality; saved.vehicle = row.vehicle; saved.view = row.view; saved.warmVehicle = row.warmVehicle
      saved.focus = row.focus
      saved.partialCoverage = row.partialCoverage
      let accounted = row.callbackMs
      for (let i = 0; i < this.regions; i++) accounted += this.ends[i] - this.starts[i]
      saved.accountedMs = Math.min(saved.intervalMs, accounted)
      if (row.focus !== 'foreground') this.excluded++
      else {
        const group = row.view === 'playing' ? 0 : 1
        this.longCounts[group]++
        const list = this.top[group]
        let lowest = list[0]
        for (const item of list) if (item.duration < lowest.duration) lowest = item
        if (saved.intervalMs > lowest.duration) {
          lowest.duration = saved.intervalMs
          lowest.frame = row.frame
          lowest.trigger = row.eventCount ? row.events[0] : 'unknown'
          lowest.span = 'unattributed'
          lowest.spanMs = 0
          lowest.accounted = saved.accountedMs
          lowest.partial = row.partialCoverage
          for (let i = 0; i < this.labels.length; i++) {
            if (row.ms[i] > lowest.spanMs) {
              lowest.spanMs = row.ms[i]
              lowest.span = this.labels[i]
            }
          }
        }
      }
      saved.ms.set(row.ms); saved.counts.set(row.counts)
      saved.lastEvent = this.lastEvent; saved.lastEventMs = this.lastEventMs
      saved.eventCount = row.eventCount; saved.eventsTruncated = row.eventsTruncated
      for (let i = 0; i < row.eventCount; i++) saved.events[i] = row.events[i]
    }
    this.finishedCallback = false
    this.regions = 0
    row.partialCoverage = false
    row.focus = !this.foreground ? 'background' : now < this.settlingUntil ? 'returning to foreground' : 'foreground'
    row.frame = frame; row.startMs = now; row.callbackMs = 0
    row.backend = backend; row.quality = quality; row.vehicle = vehicle; row.view = 'unknown'; row.warmVehicle = ''
    row.ms.fill(0, 0, this.labels.length); row.counts.fill(0, 0, this.labels.length)
    row.eventCount = 0; row.eventsTruncated = false
    this.active = true
  }

  renderContext(view: string, warmVehicle?: string) {
    this.current.view = view
    this.current.warmVehicle = warmVehicle ?? ''
  }

  finish(now: number) { this.current.callbackMs = now - this.current.startMs; this.finishedCallback = true }
  pause() { this.active = false; this.lastEvent = '' }

  /** Allocate report objects only when a probe requests them. Poll by cursor on long runs. */
  read(after = 0) {
    const first = Math.max(0, this.sequence - CAPACITY)
    const frames = []
    for (let i = Math.max(first, Math.trunc(after)); i < this.sequence; i++) {
      const s = this.ring[i % CAPACITY]
      const spans = []
      for (let j = 0; j < this.labels.length; j++) {
        if (s.counts[j]) spans.push({ name: this.labels[j], calls: s.counts[j], ms: s.ms[j] })
      }
      frames.push({ sequence: i + 1, frame: s.frame, startMs: s.startMs, intervalMs: s.intervalMs,
        callbackMs: s.callbackMs, accountedMs: s.accountedMs, unaccountedMs: s.intervalMs - s.accountedMs,
        focus: s.focus, partialCoverage: s.partialCoverage, backend: s.backend, quality: s.quality, vehicle: s.vehicle, view: s.view, warmVehicle: s.warmVehicle || null,
        lastObservedEvent: s.lastEvent || null, lastObservedEventMs: s.lastEvent ? s.lastEventMs : null,
        events: s.events.slice(0, s.eventCount), eventsTruncated: s.eventsTruncated, spans })
    }
    return { cursor: this.sequence, lost: Math.max(0, first - after), thresholdMs: THRESHOLD_MS, frames }
  }

  playReportLines(now = performance.now()) {
    const intervals: number[] = []
    const first = Math.max(0, this.played - this.playEnds.length)
    let total = 0
    for (let i = this.played - 1; i >= first; i--) {
      const at = i % this.playEnds.length
      if (this.playEnds[at] <= now - 60000) break
      intervals.push(this.playDurations[at])
      total += this.playDurations[at]
    }
    let recent = 'Last 60 s: no gameplay frames'
    if (intervals.length) {
      intervals.sort((a, b) => b - a)
      const count = Math.ceil(intervals.length / 100)
      let tail = 0
      for (let i = 0; i < count; i++) tail += intervals[i]
      recent = `Last 60 s: ${intervals.length} gameplay frames, mean ${(total / intervals.length).toFixed(1)} ms, slowest 1% mean ${(tail / count).toFixed(1)} ms`
      if (intervals.length === this.playEnds.length) recent += ' (sample capacity reached)'
    }
    const lines = [recent, 'Accounted = game callback plus nonoverlapping timed handlers. Unaccounted includes waits.']
    for (let i = 0; i < this.top.length; i++) {
      const rows = [...this.top[i]].sort((a, b) => b.duration - a.duration)
      const group = i === 0 ? 'In play' : 'Lobby or entry overlay'
      lines.push(`${group}: ${this.longCounts[i]} frames over 33.3 ms, longest ${rows[0].duration.toFixed(1)} ms`)
      // Keep the two lists short enough to paste on a phone.
      for (const w of rows.slice(0, i === 0 ? 10 : 3)) {
        if (w.duration) lines.push(`  #${w.frame} ${w.duration.toFixed(1)} ms, accounted ${w.accounted.toFixed(1)}, unaccounted ${(w.duration-w.accounted).toFixed(1)}${w.partial ? ' (coverage capped)' : ''}; ${w.trigger}, ${w.span} ${w.spanMs.toFixed(1)} ms`)
      }
    }
    lines.push(`Excluded background or focus-return long frames: ${this.excluded}`)
    return lines
  }

  summary() {
    if (!this.sequence) return 'No game-frame intervals over 33.3 ms recorded.'
    const last = this.ring[(this.sequence - 1) % CAPACITY]
    const name = last.eventCount ? last.events.slice(0, last.eventCount).join(', ') : 'trigger unknown'
    let largest = -1
    for (let i = 0; i < this.labels.length; i++) {
      if (last.counts[i] && (largest < 0 || last.ms[i] > last.ms[largest])) largest = i
    }
    const span = largest < 0 ? 'no timed spans' : this.labels[largest] + ' ' + last.ms[largest].toFixed(1) + ' ms inclusive'
    return this.sequence + ' intervals over 33.3 ms. Latest ' + last.intervalMs.toFixed(1) + ' ms, ' +
      last.callbackMs.toFixed(1) + ' ms in the game callback, ' + name + ' (' + last.backend +
      ', level ' + last.quality + ', ' + last.vehicle + '). Largest span: ' + span + '.'
  }
}
export const longFrames = new LongFrames()

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const syncFocus = () => longFrames.focusChanged(!document.hidden && document.hasFocus(), performance.now())
  document.addEventListener('visibilitychange', syncFocus)
  window.addEventListener('blur', () => longFrames.focusChanged(false, performance.now()))
  window.addEventListener('focus', syncFocus)
  syncFocus()
}
