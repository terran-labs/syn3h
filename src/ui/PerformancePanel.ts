import { params } from '../../shared/params'
import { QUALITY, type QualitySource, type QualityState } from '../core/quality'
import type { PerformanceSnapshot, PerformanceSource } from '../core/performance'
import type { Inspector } from './inspector/Inspector'
import type { PropertyDef } from './inspector/model'

const number = (value: number | undefined, digits = 1) => value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable'

/** The level row and Auto drive these; they never appear as rows of their own. */
const LEVEL_IDS = ['gfx.quality', 'gfx.auto', 'gfx.level']
/** Two chevrons, drawn as one stroked path: pointing down for a lower level, up for a higher one. */
const CHEVRONS = (up: boolean) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${up ? 'M3 8l5-4 5 4M3 13l5-4 5 4' : 'M3 3l5 4 5-4M3 8l5 4 5-4'}"/></svg>`

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
  private wasVisible = false
  /** The "changed" mark beside each fine-tune row, by property id. */
  private readonly marks = new Map<string, HTMLButtonElement>()
  /** The fine-tune ids last laid out, to notice when one registers. */
  private shown?: string
  /** Which fine-tune folds were open, kept across rebuilds. */
  private readonly foldOpen = new Map<string, boolean>()
  private readonly select: HTMLSelectElement
  private readonly diagnostics: HTMLDetailsElement

  constructor(_parent: HTMLElement, private readonly openRail: () => void, quality?: QualitySource, private readonly inspector?: Inspector) {
    const signal = this.abort.signal
    this.element.className = 'performance-card'
    this.element.innerHTML = `<div class="wi-level" role="group" aria-label="Quality level">
        <button type="button" class="wi-step" data-quality="down" aria-label="Lower quality level">${CHEVRONS(false)}</button>
        <div class="wi-level-pick"><select class="wi-level-select" aria-label="Quality level" disabled></select><small class="wi-level-of"></small></div>
        <button type="button" class="wi-step" data-quality="up" aria-label="Raise quality level">${CHEVRONS(true)}</button></div>
      <div class="wi-level-tools"><label class="wi-auto"><input type="checkbox" disabled> Auto</label><button type="button" data-quality="reset-all" disabled>Reset all to this level</button></div>
      <p class="performance-quality wi-blurb" aria-live="polite"></p>
      <div class="wi-fine"></div>
      <details class="wi-group performance-diagnostics"><summary><span>Diagnostics</span><small></small></summary>
      <div class="performance-body">
      <svg class="performance-chart" viewBox="0 0 288 64" role="img" aria-label="Frame time history"><path d="M0 63H288"/><polyline fill="none"/></svg>
      <p class="performance-history"></p><dl></dl><p class="performance-recovery" role="status"></p>
      <button type="button" data-performance="reload" hidden>Reload to recover</button></div></details>`
    this.select = this.element.querySelector('select')!
    this.diagnostics = this.element.querySelector('details')!
    this.recommendation.className = 'performance-recommendation'; this.recommendation.hidden = true
    this.recommendation.setAttribute('role', 'status')
    this.recommendation.innerHTML = '<p></p><button type="button" data-performance="ignore">Ignore</button><button type="button" data-performance="lower">Lower level</button>'
    this.element.querySelector('.performance-quality')!.after(this.recommendation)
    this.select.addEventListener('change', () => this.quality?.setLevel(Number(this.select.value)), { signal })
    this.element.querySelector('.wi-auto input')!.addEventListener('change', event => this.quality?.setAuto((event.target as HTMLInputElement).checked), { signal })
    this.element.querySelector('[data-quality=down]')!.addEventListener('click', () => this.quality?.stepDown(), { signal })
    this.element.querySelector('[data-quality=up]')!.addEventListener('click', () => this.quality?.stepUp(), { signal })
    this.element.querySelector('[data-quality=reset-all]')!.addEventListener('click', () => this.quality?.clearOverrides(), { signal })
    // Diagnostics sample only while their fold is open.
    this.diagnostics.addEventListener('toggle', () => { if (this.snapshot && this.diagnostics.open !== this.snapshot.visible) this.source?.setDiagnosticsVisible(this.diagnostics.open) }, { signal })
    this.recommendation.querySelector('[data-performance=ignore]')!.addEventListener('click', () => this.source?.ignoreRecommendation(), { signal })
    this.recommendation.querySelector('[data-performance=lower]')!.addEventListener('click', () => this.source?.lowerRecommendedTier(), { signal })
    this.element.querySelector('[data-performance=reload]')!.addEventListener('click', () => location.reload(), { signal })
    if (quality) this.configureQuality(quality)
    inspector?.addCard(PerformancePanel.CARD, 'Performance', this.element, () => this.state ? `${this.state.name} · Auto ${this.state.auto ? 'on' : 'off'}${this.snapshot?.recommendation ? ' · Running slow' : ''}` : '',
      { after: 'vehicles', owns: () => this.owned(), fill: () => this.fill() })
  }

  /** Bind the level controls to the quality controller. Replaces any earlier binding. */
  configureQuality(quality: QualitySource): void {
    this.qualityUnsubscribe?.(); this.quality = quality
    this.select.replaceChildren(...quality.qualityLevels.map(level => { const option = document.createElement('option'); option.value = String(level.index); option.textContent = level.name; return option }))
    this.select.disabled = false; this.element.querySelector<HTMLInputElement>('.wi-auto input')!.disabled = false
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
    this.element.querySelector<HTMLInputElement>('.wi-auto input')!.checked = state.auto
    const resetAll = this.element.querySelector<HTMLButtonElement>('[data-quality=reset-all]')!
    resetAll.textContent = `Reset all to ${state.name}`; resetAll.disabled = Object.keys(state.overrides).length === 0
    // A newly registered property joins the level: rebuild so it gets a row here. Compared by
    // content, since every state change is a new object.
    const shown = this.fineIds().join(' ')
    if (this.shown !== undefined && shown !== this.shown) { this.shown = shown; this.regroup() }
    else { this.shown = shown; this.renderMarks(state) }
    this.renderStatus()
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
    const reduction = easing === 'post' ? 'Post effects reduced automatically' : easing === 'resolution' ? 'Resolution reduced automatically' : 'Full resolution and post budget'
    this.element.querySelector('.performance-quality')!.textContent = [name, auto === undefined ? '' : `Auto ${auto ? 'on' : 'off'}`, pinned === undefined ? '' : pinned ? 'Pinned' : 'Not pinned', reduction, snapshot ? `${snapshot.quality.targetFps} fps target` : ''].filter(Boolean).join(' · ')

  }

  private showRecommendation(): void {
    // Clickable actions belong to the unlocked interface, never underneath captured input.
    this.recommendation.hidden = !this.snapshot?.recommendation || !this.playing || this.captured
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
      this.recommendation.querySelector('p')!.textContent = `Running slow at ${this.levelName(offer.level)} (${number(offer.observedFps, 0)} fps). Switch to ${this.levelName(offer.targetLevel)}?`
      this.recommendation.querySelector('[data-performance=lower]')!.textContent = `Switch to ${this.levelName(offer.targetLevel)}`
      this.recommendation.querySelector('[data-performance=ignore]')!.textContent = `Keep ${this.levelName(offer.level)}`
    }
    this.renderStatus()
    if (!snapshot.visible) return
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
    this.abort.abort(); this.inspector?.removeCard(PerformancePanel.CARD); this.element.remove(); this.recommendation.remove()
  }
}
