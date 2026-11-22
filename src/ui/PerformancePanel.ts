import { longFrames } from '../core/longFrames'
import { params } from '../../shared/params'
import { QUALITY, type QualitySource, type QualityState } from '../core/quality'
import type { PerformanceSnapshot, PerformanceSource } from '../core/performance'
import type { Inspector } from './inspector/Inspector'
import type { PropertyDef } from './inspector/model'
import { createSwitch, type Switch } from './inspector/switch'

const number = (value: number | undefined, digits = 1) => value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable'

/** The level row and Auto drive these; they never appear as rows of their own. */
const LEVEL_IDS = ['gfx.quality', 'gfx.auto', 'gfx.level']
/** Two chevrons, drawn as one stroked path: pointing down for a lower level, up for a higher one. */
const CHEVRONS = (up: boolean) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${up ? 'M3 8l5-4 5 4M3 13l5-4 5 4' : 'M3 3l5 4 5-4M3 8l5 4 5-4'}"/></svg>`

/** The drawing buffer for a window of CSS size width by height at a pixel ratio, as the renderer sizes it. */
export function renderSize(width: number, height: number, pixelRatio: number): [number, number] {
  return [Math.floor(width * pixelRatio), Math.floor(height * pixelRatio)]
}

/**
 * The Performance card's status, as two lines: what a player needs (level, whether Auto quality
 * is on, the frame rate it aims for, and anything it is cutting right now), then the technical
 * figures (pixel ratio, post budget, whether the level is pinned).
 */
export function statusLines(s: { name: string; auto?: boolean; pinned?: boolean; easing?: string | null; pixelRatio?: number; post?: number; targetFps?: number }): [string, string] {
  const easing = s.easing === 'post' ? 'Post effects reduced automatically' : s.easing === 'resolution' ? 'Resolution reduced automatically' : ''
  const main = [s.name, s.auto === undefined ? '' : `Auto quality ${s.auto ? 'on' : 'off'}`, s.targetFps ? `aiming for ${s.targetFps} fps` : '', easing].filter(Boolean).join(' · ')
  const detail = [
    s.pixelRatio !== undefined ? `Pixel ratio ${number(s.pixelRatio, 2)}` : '',
    s.post !== undefined ? `Post budget ${number(s.post * 100, 0)}%` : '',
    s.pinned === undefined ? '' : s.pinned ? 'Level pinned: Auto keeps it' : 'Level not pinned',
    s.easing ? '' : 'Full resolution and post budget',
  ].filter(Boolean).join(' · ')
  return [main, detail]
}

/**
 * The Performance card: the quality level with steps either side, Auto, every preference the
 * level sets (each one fine-tunable, marked when changed and resettable), then diagnostics.
 * Presentation only: the quality source (game.quality) owns levels, Auto and overrides; the
 * performance source supplies samples and recommendations. Rows come from the inspector's own
 * builder, so they slide, toggle and edit exactly as every other row does.
 */
export class PerformancePanel {
  static readonly CARD = 'performance'
  /** The card body. Without an inspector it is built but not mounted (used by tests). */
  readonly element = document.createElement('div')
  readonly recommendation = document.createElement('aside')
  private source?: PerformanceSource
  private unsubscribe?: () => void
  private quality?: QualitySource
  private qualityUnsubscribe?: () => void
  private state?: QualityState
  private readonly abort = new AbortController()
  private snapshot?: PerformanceSnapshot
  private playing = false
  private captured = false
  private readonly recommendationSize: ResizeObserver
  private wasVisible = false
  /** The "changed" mark beside each fine-tune row, by property id. */
  private readonly marks = new Map<string, HTMLButtonElement>()
  /** The fine-tune ids last laid out, to notice when one registers. */
  private shown?: string
  /** Which fine-tune folds were open, kept across rebuilds. */
  private readonly foldOpen = new Map<string, boolean>()
  private readonly select: HTMLSelectElement
  private readonly diagnostics: HTMLDetailsElement
  private get resolutionRange(): HTMLInputElement { return this.element.querySelector<HTMLInputElement>('.wi-resolution input')! }
  /** Auto quality: the standard switch, apart from the level stepper. */
  private readonly auto: Switch

  constructor(parent: HTMLElement, private readonly openRail: () => void, quality?: QualitySource, private readonly inspector?: Inspector) {
    const signal = this.abort.signal
    this.element.className = 'performance-card'
    this.element.innerHTML = `<div class="wi-level" role="group" aria-label="Quality level">
        <button type="button" class="wi-step" data-quality="down" aria-label="Lower quality level">${CHEVRONS(false)}</button>
        <div class="wi-level-pick"><select class="wi-level-select" aria-label="Quality level" disabled></select><small class="wi-level-of"></small></div>
        <button type="button" class="wi-step" data-quality="up" aria-label="Raise quality level">${CHEVRONS(true)}</button></div>
      <div class="wi-level-tools"><button type="button" data-quality="reset-all" disabled>Reset all to this level</button></div>
      <div class="wi-resolution" role="group" aria-label="Render resolution">
        <span class="wi-label">Render resolution</span>
        <input type="range" min="50" max="100" step="5" aria-label="Render resolution, percent of native" disabled>
        <output class="wi-res-value"></output>
        <button type="button" class="wi-res-auto" aria-pressed="true" disabled>Auto</button>
        <small class="wi-res-size"></small></div>
      <p class="performance-quality wi-blurb" aria-live="polite"></p><p class="performance-quality-detail"></p>
      <div class="wi-fine"></div>
      <details class="wi-group performance-diagnostics"><summary><span>Diagnostics</span><small></small></summary>
      <div class="performance-body">
      <svg class="performance-chart" viewBox="0 0 288 64" role="img" aria-label="Frame time history"><path d="M0 63H288"/><polyline fill="none"/></svg>
      <p class="performance-history"></p><p class="performance-long-frames" style="user-select:text"></p><button type="button" data-performance="copy-report">Copy diagnostics</button> <button type="button" data-performance="run-check">Run performance check</button>
      <span data-performance="copy-status" role="status"></span>
      <textarea data-performance="copy-text" aria-label="Diagnostics report" rows="8" readonly hidden></textarea><dl></dl><p class="performance-recovery" role="status"></p>
      <button type="button" data-performance="reload" hidden>Reload to recover</button></div></details>`
    this.select = this.element.querySelector('select')!
    this.diagnostics = this.element.querySelector('details')!
    this.recommendation.className = 'performance-recommendation liquid-glass'; this.recommendation.hidden = true
    this.recommendation.setAttribute('role', 'status')
    this.recommendation.innerHTML = '<p></p><button type="button" data-performance="ignore">Ignore</button><button type="button" data-performance="bots" hidden>Fewer bots</button><button type="button" data-performance="lower">Lower level</button><small class="performance-unlock" hidden>Esc for options</small>'
    parent.append(this.recommendation)
    this.recommendationSize = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0]?.blockSize ?? this.recommendation.offsetHeight
      parent.style.setProperty('--recommendation-height', height + 'px')
    })
    this.recommendationSize.observe(this.recommendation)
    this.select.addEventListener('change', () => this.quality?.setLevel(Number(this.select.value)), { signal })
    this.auto = createSwitch('Auto quality', { className: 'wi-auto', signal, onChange: on => this.quality?.setAuto(on) })
    this.auto.input.disabled = true
    this.element.querySelector('.wi-level-tools')!.prepend(this.auto.element)
    // Render resolution: dragging previews the number; the renderer resizes once, on release.
    const range = this.resolutionRange
    range.addEventListener('input', () => this.renderResolution(Number(range.value) / 100), { signal })
    range.addEventListener('change', () => this.quality?.setResolution?.(Number(range.value) / 100), { signal })
    this.element.querySelector('.wi-res-auto')!.addEventListener('click', () => this.quality?.setResolution?.(null), { signal })
    this.element.querySelector('[data-quality=down]')!.addEventListener('click', () => this.quality?.stepDown(), { signal })
    this.element.querySelector('[data-quality=up]')!.addEventListener('click', () => this.quality?.stepUp(), { signal })
    this.element.querySelector('[data-quality=reset-all]')!.addEventListener('click', () => this.quality?.clearOverrides(), { signal })
    // Diagnostics sample only while their fold is open.
    this.diagnostics.addEventListener('toggle', () => { if (this.snapshot && this.diagnostics.open !== this.snapshot.visible) this.source?.setDiagnosticsVisible(this.diagnostics.open) }, { signal })
    this.recommendation.querySelector('[data-performance=ignore]')!.addEventListener('click', () => this.source?.ignoreRecommendation(), { signal })
    this.recommendation.querySelector('[data-performance=lower]')!.addEventListener('click', () => this.source?.lowerRecommendedTier(), { signal })
    this.recommendation.querySelector('[data-performance=bots]')!.addEventListener('click', () => this.source?.fewerRecommendedBots?.(), { signal })
    this.element.querySelector('[data-performance=reload]')!.addEventListener('click', () => location.reload(), { signal })
    this.element.querySelector('[data-performance=copy-report]')!.addEventListener('click', async () => {
      const status = this.element.querySelector<HTMLElement>('[data-performance=copy-status]')!
      const fallback = this.element.querySelector<HTMLTextAreaElement>('[data-performance=copy-text]')!
      const report = this.source?.diagnosticReport?.()
      fallback.hidden = true
      if (!report) { status.textContent = 'Diagnostics are initializing.'; return }
      try {
        await navigator.clipboard.writeText(report)
        status.textContent = 'Diagnostics copied.'
      } catch {
        fallback.value = report
        fallback.hidden = false
        fallback.focus()
        fallback.select()
        status.textContent = 'Select and copy the report below.'
      }
    }, { signal })
    const check = this.element.querySelector<HTMLButtonElement>('[data-performance=run-check]')!
    check.addEventListener('click', async () => {
      if (!this.source?.runPerformanceCheck || check.disabled) return
      check.disabled = true
      const status = this.element.querySelector<HTMLElement>('[data-performance=copy-status]')!
      const field = this.element.querySelector<HTMLTextAreaElement>('[data-performance=copy-text]')!
      field.hidden = true
      status.textContent = 'Starting performance check…'
      const result = this.source.runPerformanceCheck(signal)
      try {
        // WebKit requires the clipboard request in this tap, even when its text arrives later.
        let copied: Promise<boolean> = Promise.resolve(false)
        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          const blob = result.then(text => new Blob([text], { type: 'text/plain' }))
          void blob.catch(() => {})
          try { copied = navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(() => true, () => false) } catch { /* Show selectable text. */ }
        }
        const text = await result
        if (await copied) status.textContent = 'Copied'
        else {
          field.value = text; field.hidden = false; field.focus(); field.select()
          status.textContent = 'Select and copy the performance report below.'
        }
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Performance check interrupted.' }
      finally { check.disabled = false }
    }, { signal })
    if (quality) this.configureQuality(quality)
    inspector?.addCard(PerformancePanel.CARD, 'Performance', this.element, () => this.state ? `${this.state.name} · Auto ${this.state.auto ? 'on' : 'off'}${this.snapshot?.recommendation ? ' · Running slow' : ''}` : '',
      { after: 'world', owns: () => this.owned(), fill: () => this.fill() })
  }

  /** Bind the level controls to the quality controller. Replaces any earlier binding. */
  configureQuality(quality: QualitySource): void {
    this.qualityUnsubscribe?.(); this.quality = quality
    this.select.replaceChildren(...quality.qualityLevels.map(level => { const option = document.createElement('option'); option.value = String(level.index); option.textContent = level.name; return option }))
    this.select.disabled = false; this.auto.input.disabled = false
    const settable = !!quality.setResolution
    this.resolutionRange.disabled = !settable; this.element.querySelector<HTMLButtonElement>('.wi-res-auto')!.disabled = !settable
    this.element.querySelector<HTMLElement>('.wi-resolution')!.hidden = !settable
    this.qualityUnsubscribe = quality.subscribeQuality(state => this.renderQuality(state))
    this.regroup()
  }
  /** The set of owned rows changed: rebuild the inspector so they leave or rejoin other cards. */
  private regroup(): void { if (this.mounted) this.inspector!.rebuild() }
  private get mounted(): boolean { return !!this.inspector && this.element.parentElement?.dataset.section === PerformancePanel.CARD }

  configure(source: PerformanceSource): void {
    this.unsubscribe?.(); this.source = source
    this.unsubscribe = source.subscribePerformance(snapshot => this.render(snapshot))
  }

  /** Called from Shell's existing update, only to gate presentation. No sampling or timing. */
  setContext(playing: boolean, captured: boolean): void {
    if (playing === this.playing && captured === this.captured) return
    this.playing = playing; this.captured = captured; this.showRecommendation()
  }

  /** Every property the level sets that is registered, in the level's display order. */
  private fineIds(): string[] {
    const state = this.state ?? this.quality?.getQualityState()
    // An id the registry has not seen yet has no preset value: skip it rather than show it empty.
    return state ? state.presetIds.filter(id => id in state.preset && params.get(id)) : []
  }
  private owned(): readonly string[] { return this.quality ? [...LEVEL_IDS, ...this.fineIds()] : [] }

  /** Build the fine-tune rows, one fold per group, with the inspector's own row builder. */
  private fill(): void {
    const host = this.element.querySelector('.wi-fine')!, inspector = this.inspector
    for (const fold of host.querySelectorAll<HTMLDetailsElement>('details')) this.foldOpen.set(fold.dataset.group!, fold.open)
    host.replaceChildren(); this.marks.clear()
    if (!inspector || !this.mounted) return
    const groups = new Map<string, PropertyDef[]>()
    for (const id of this.fineIds()) { const def = params.get(id)!.def as PropertyDef; groups.set(def.group, [...groups.get(def.group) ?? [], def]) }
    let first = true
    for (const [name, defs] of groups) {
      const fold = document.createElement('details'); fold.className = 'wi-group'; fold.dataset.group = name; fold.open = this.foldOpen.get(name) ?? first; first = false
      const summary = document.createElement('summary'); summary.innerHTML = '<span></span><small></small>'
      summary.querySelector('span')!.textContent = name; summary.querySelector('small')!.textContent = String(defs.length)
      fold.append(summary)
      for (const def of defs) {
        const row = inspector.row(def); row.classList.add('is-fine')
        // Hidden until the player sets this by hand; pressing it puts the level's value back.
        const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'wi-changed'; mark.textContent = 'changed'; mark.hidden = true
        mark.addEventListener('click', () => this.quality?.clearOverride(def.id))
        row.querySelector('.wi-label')!.after(mark); this.marks.set(def.id, mark); fold.append(row)
      }
      host.append(fold)
    }
    if (this.state) this.renderMarks(this.state)
  }

  private renderQuality(state: QualityState): void {
    this.state = state
    const levels = this.quality?.qualityLevels ?? [], first = levels[0]?.index ?? 0, last = levels.at(-1)?.index ?? 0
    if (document.activeElement !== this.select) this.select.value = String(state.level)
    this.element.querySelector('.wi-level-of')!.textContent = `Level ${levels.findIndex(level => level.index === state.level) + 1} of ${levels.length}`
    this.element.querySelector<HTMLButtonElement>('[data-quality=down]')!.disabled = state.level <= first
    this.element.querySelector<HTMLButtonElement>('[data-quality=up]')!.disabled = state.level >= last
    this.auto.set(state.auto)
    this.renderResolution()
    const resetAll = this.element.querySelector<HTMLButtonElement>('[data-quality=reset-all]')!
    resetAll.textContent = `Reset all to ${state.name}`; resetAll.disabled = Object.keys(state.overrides).length === 0
    // A newly registered property joins the level: rebuild so it gets a row here. Compared by
    // content, since every state change is a new object.
    const shown = this.fineIds().join(' ')
    if (this.shown !== undefined && shown !== this.shown) { this.shown = shown; this.regroup() }
    else { this.shown = shown; this.renderMarks(state) }
    this.renderStatus()
  }

  /**
   * The resolution row: the player's percentage (or Auto, with what Auto draws now), and the
   * render size in pixels. `preview` is a value being dragged, not yet applied.
   */
  private renderResolution(preview?: number): void {
    const state = this.state
    if (!state || state.devicePixelRatio === undefined) return
    const dpr = state.devicePixelRatio || 1
    const chosen = preview ?? state.resolution
    const ratio = preview !== undefined ? Math.round(dpr * preview * 100) / 100 : state.pixelRatio
    const share = chosen ?? ratio / dpr
    const range = this.resolutionRange
    // A slider in the player's hand keeps its own position.
    if (preview === undefined && document.activeElement !== range) range.value = String(Math.round(Math.min(1, Math.max(0.5, share)) * 20) * 5)
    const row = this.element.querySelector<HTMLElement>('.wi-resolution')!
    row.classList.toggle('is-auto', chosen === null)
    // At Auto the number is what Auto draws now; the filled Auto button says who chose it.
    this.element.querySelector('.wi-res-value')!.textContent = `${Math.round(share * 100)}%`
    const button = this.element.querySelector<HTMLButtonElement>('.wi-res-auto')!
    button.setAttribute('aria-pressed', String(chosen === null)); button.classList.toggle('is-on', chosen === null)
    const [width, height] = renderSize(innerWidth, innerHeight, ratio)
    this.element.querySelector('.wi-res-size')!.textContent = `${width} × ${height} px${chosen === null ? ' · set by Auto' : ''}`
  }

  private renderMarks(state: QualityState): void {
    for (const [id, mark] of this.marks) {
      const changed = id in state.overrides
      mark.hidden = !changed; mark.closest('.wi-row')?.classList.toggle('is-changed', changed)
      if (changed) mark.setAttribute('aria-label', `Changed. Reset ${(params.get(id)?.def.label ?? id)} to the ${state.name} value`)
    }
  }

  private levelName(index: number): string {
    return this.quality?.qualityLevels.find(level => level.index === index)?.name ?? QUALITY[index]?.name ?? `Level ${index + 1}`
  }

  /** Show the chosen level, automation and reductions without requiring the diagnostics fold. */
  private renderStatus(): void {
    const state = this.state, snapshot = this.snapshot
    const name = state?.name ?? (snapshot ? this.levelName(snapshot.quality.level) : '')
    const auto = state?.auto ?? snapshot?.quality.auto
    const pinned = state?.pinned ?? snapshot?.levelPinned
    const easing = state?.easing ?? (snapshot && snapshot.quality.rung > 0 ? snapshot.quality.kind : null)
    // The plain facts first; the technical ones on a quieter second line. Nothing is dropped.
    const [main, detail] = statusLines({ name, auto, pinned, easing, pixelRatio: snapshot?.quality.pixelRatio, post: snapshot?.quality.post, targetFps: snapshot?.quality.targetFps })
    this.element.querySelector('.performance-quality')!.textContent = main
    this.element.querySelector('.performance-quality-detail')!.textContent = detail

  }

  private showRecommendation(): void {
    this.recommendation.hidden = !this.snapshot?.recommendation || !this.playing
    // The notice remains visible while driving. Escape exposes its choices without firing.
    const offer = this.snapshot?.recommendation
    for (const button of this.recommendation.querySelectorAll<HTMLButtonElement>('button')) {
      const kind = button.dataset.performance
      // Fewer bots only when bots are on offer; a lower level only when there is one.
      button.hidden = this.captured || (kind === 'bots' && !(offer?.fewerBots && offer.bots)) || (kind === 'lower' && !!offer && offer.targetLevel === offer.level)
    }
    this.recommendation.querySelector<HTMLElement>('.performance-unlock')!.hidden = !this.captured
  }

  private render(snapshot: PerformanceSnapshot): void {
    this.snapshot = snapshot
    if (this.diagnostics.open !== snapshot.visible) this.diagnostics.open = snapshot.visible
    // Diagnostics asked for from elsewhere (F3): bring the rail and this card up to show them.
    if (snapshot.visible && !this.wasVisible) { this.openRail(); this.inspector?.revealCard(PerformancePanel.CARD) }
    this.wasVisible = snapshot.visible
    this.showRecommendation()
    const offer = snapshot.recommendation
    if (offer) {
      // Bots are offered first when they measurably cost frames; a lower level keeps them as they are.
      const bots = offer.fewerBots ? offer.bots ?? 0 : 0, lower = offer.targetLevel !== offer.level
      const company = bots === 1 ? '1 bot' : `${bots} bots`
      this.recommendation.querySelector('p')!.textContent = bots && lower
        ? `Running slow at ${this.levelName(offer.level)} with ${company} (${number(offer.observedFps, 0)} fps). Try fewer bots, or ${this.levelName(offer.targetLevel)} with the current bots?`
        : bots ? `Running slow with ${company} (${number(offer.observedFps, 0)} fps). Try fewer bots?`
        : `Running slow at ${this.levelName(offer.level)} (${number(offer.observedFps, 0)} fps). Switch to ${this.levelName(offer.targetLevel)}?`
      this.recommendation.querySelector<HTMLButtonElement>('[data-performance=lower]')!.textContent = bots && lower ? `${this.levelName(offer.targetLevel)}, same bots` : `Switch to ${this.levelName(offer.targetLevel)}`
      this.recommendation.querySelector('[data-performance=ignore]')!.textContent = `Keep ${this.levelName(offer.level)}`
    }
    this.renderStatus()
    if (!snapshot.visible) return
    this.element.querySelector('.performance-long-frames')!.textContent = longFrames.summary()
    const { environment } = snapshot
    const history = snapshot.history.slice(-120), latest = history.at(-1)
    const ceiling = Math.max(34, ...history.map(point => Number.isFinite(point.p95Ms) ? point.p95Ms : 0))
    const points = history.map((point, i) => `${history.length === 1 ? 0 : i / (history.length - 1) * 288},${63 - Math.min(1, Math.max(0, point.frameMs / ceiling)) * 61}`).join(' ')
    this.element.querySelector('polyline')!.setAttribute('points', points)
    this.element.querySelector('.performance-chart')!.setAttribute('aria-label', `Frame time history, ${history.length} eligible play samples, scale 0 to ${Math.ceil(ceiling)} milliseconds`)
    this.element.querySelector('.performance-history')!.textContent = history.length ? `${history.length}/120 eligible play samples · 0 to ${Math.ceil(ceiling)} ms` : 'Waiting for eligible play samples'
    const rows: [string, string][] = [
      ['FPS / median frame', latest && latest.frameMs > 0 ? `${number(1000 / latest.frameMs, 0)} / ${number(latest.p50Ms)} ms` : 'Unavailable'],
      ['Frame / p90 / p95', latest ? `${number(latest.frameMs)} / ${number(latest.p90Ms)} / ${number(latest.p95Ms)} ms` : 'Unavailable'],
      ['Physics', latest ? `${number(latest.physicsMs, 2)} ms` : 'Unavailable'],
      // What this device carries against what the host asked for; a guest's bots are the host's.
      ['Bots carried / asked for', snapshot.bots ? `${snapshot.bots.carried} / ${snapshot.bots.requested}` : 'Simulated by the host'],
      ['Draws / triangles', latest ? `${number(latest.drawCalls, 0)} / ${number(latest.triangles, 0)}` : 'Unavailable'],
      ['Stalls / frames', latest ? `${latest.stalls} / ${latest.frames}` : 'Unavailable'],
      ['Backend', environment.backend || 'Unavailable'], ['Graphics hardware', environment.adapter || 'Unavailable'],
      ['Memory (browser estimate)', environment.memoryGB === null ? 'Unavailable' : `${number(environment.memoryGB, 0)} GB`],
      ['Texture limit', environment.maxTextureSize === null ? 'Unavailable' : `${environment.maxTextureSize} px`],
    ]
    const list = this.element.querySelector('dl')!; list.replaceChildren()
    for (const [label, value] of rows) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; list.append(term, detail) }
    this.element.querySelector('.performance-recovery')!.textContent = [environment.fallbackReason ? `Fallback: ${environment.fallbackReason}` : '', environment.deviceLost ? `Renderer stopped: ${environment.deviceLost}` : ''].filter(Boolean).join(' ')
    this.element.querySelector<HTMLButtonElement>('[data-performance=reload]')!.hidden = !environment.deviceLost
  }

  dispose(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined; this.source = undefined
    this.qualityUnsubscribe?.(); this.qualityUnsubscribe = undefined; this.quality = undefined
    this.recommendationSize.disconnect(); this.abort.abort(); this.inspector?.removeCard(PerformancePanel.CARD); this.element.remove(); this.recommendation.remove()
  }
}
