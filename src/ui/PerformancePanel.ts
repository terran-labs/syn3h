import { QUALITY, type QualitySource, type QualityState } from '../core/quality'
import type { PerformanceSnapshot, PerformanceSource } from '../core/performance'

const number = (value: number | undefined, digits = 1) => value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable'

/** What the governor is easing inside a level, in the player's words. */
const EASING = { post: 'easing post effects', resolution: 'easing resolution' } as const

/**
 * Presentation only. The performance source supplies samples and recommendations; the quality
 * source (game.quality) owns the six levels, Auto and the player's fine-tuning.
 */
export class PerformancePanel {
  readonly element = document.createElement('section')
  readonly toggle = document.createElement('button')
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

  constructor(parent: HTMLElement, private readonly openRail: () => void, quality?: QualitySource) {
    const signal = this.abort.signal
    this.toggle.type = 'button'; this.toggle.className = 'performance-toggle'
    this.toggle.textContent = 'Performance'; this.toggle.setAttribute('aria-expanded', 'false'); this.toggle.disabled = true
    this.element.className = 'performance-panel'; this.element.hidden = true
    this.element.setAttribute('aria-label', 'Performance diagnostics')
    this.element.innerHTML = `<header><strong>Performance</strong><button type="button" data-performance="close" aria-label="Close performance diagnostics">×</button></header>
      <div class="performance-body"><p class="performance-quality"></p>
      <div class="performance-controls"><label>Quality level<select aria-label="Quality level" disabled></select></label><label><input type="checkbox" disabled> Automatic</label></div>
      <svg class="performance-chart" viewBox="0 0 288 64" role="img" aria-label="Frame time history"><path d="M0 63H288"/><polyline fill="none"/></svg>
      <p class="performance-history"></p><dl></dl><p class="performance-recovery" role="status"></p>
      <button type="button" data-performance="reload" hidden>Reload to recover</button></div>`
    this.recommendation.className = 'performance-recommendation'; this.recommendation.hidden = true
    this.recommendation.setAttribute('role', 'status')
    this.recommendation.innerHTML = '<p></p><button type="button" data-performance="ignore">Ignore</button><button type="button" data-performance="lower">Lower level</button>'
    parent.append(this.recommendation)
    this.toggle.addEventListener('click', () => this.source?.setDiagnosticsVisible(!this.snapshot?.visible), { signal })
    this.element.querySelector('[data-performance=close]')!.addEventListener('click', () => this.source?.setDiagnosticsVisible(false), { signal })
    this.element.querySelector('select')!.addEventListener('change', event => this.quality?.setLevel(Number((event.target as HTMLSelectElement).value)), { signal })
    this.element.querySelector('input')!.addEventListener('change', event => this.quality?.setAuto((event.target as HTMLInputElement).checked), { signal })
    this.recommendation.querySelector('[data-performance=ignore]')!.addEventListener('click', () => this.source?.ignoreRecommendation(), { signal })
    this.recommendation.querySelector('[data-performance=lower]')!.addEventListener('click', () => this.source?.lowerRecommendedTier(), { signal })
    this.element.querySelector('[data-performance=reload]')!.addEventListener('click', () => location.reload(), { signal })
    if (quality) this.configureQuality(quality)
  }

  /** Bind the level controls to the quality controller. Replaces any earlier binding. */
  configureQuality(quality: QualitySource): void {
    this.qualityUnsubscribe?.(); this.quality = quality
    const select = this.element.querySelector('select')!
    select.replaceChildren(...quality.qualityLevels.map(level => { const option = document.createElement('option'); option.value = String(level.index); option.textContent = level.name; return option }))
    select.disabled = false; this.element.querySelector('input')!.disabled = false
    this.qualityUnsubscribe = quality.subscribeQuality(state => this.renderQuality(state))
  }

  private renderQuality(state: QualityState): void {
    this.state = state
    const select = this.element.querySelector('select')!
    if (document.activeElement !== select) select.value = String(state.level)
    this.element.querySelector('input')!.checked = state.auto
    this.renderStatus()
  }

  private levelName(index: number): string {
    return this.quality?.qualityLevels.find(level => level.index === index)?.name ?? QUALITY[index]?.name ?? `Level ${index + 1}`
  }

  /** "Ultra, easing resolution · 60 fps target · chosen level". */
  private renderStatus(): void {
    const state = this.state, target = this.snapshot?.quality.targetFps
    const name = state ? `${state.name}${state.easing ? `, ${EASING[state.easing]}` : ''}` : this.snapshot ? this.levelName(this.snapshot.quality.level) : ''
    // A chosen level is pinned: the governor eases inside it but never leaves it.
    const how = state ? state.pinned ? 'chosen level' : state.auto ? 'automatic' : '' : this.snapshot?.levelPinned ? 'chosen level' : ''
    this.element.querySelector('.performance-quality')!.textContent = [name, target ? `${target} fps target` : '', how].filter(Boolean).join(' · ')
  }

  configure(source: PerformanceSource): void {
    this.unsubscribe?.(); this.source = source; this.toggle.disabled = false
    this.unsubscribe = source.subscribePerformance(snapshot => this.render(snapshot))
  }

  /** Called from Shell's existing update, only to gate presentation. No sampling or timing. */
  setContext(playing: boolean, captured: boolean): void {
    if (playing === this.playing && captured === this.captured) return
    this.playing = playing; this.captured = captured; this.showRecommendation()
  }

  private showRecommendation(): void {
    // Clickable actions belong to the unlocked interface, never underneath captured input.
    this.recommendation.hidden = !this.snapshot?.recommendation || !this.playing || this.captured
  }

  private render(snapshot: PerformanceSnapshot): void {
    this.snapshot = snapshot
    this.element.hidden = !snapshot.visible
    this.toggle.setAttribute('aria-expanded', String(snapshot.visible))
    if (snapshot.visible && !this.wasVisible) this.openRail()
    this.wasVisible = snapshot.visible
    this.showRecommendation()
    const offer = snapshot.recommendation
    if (offer) this.recommendation.querySelector('p')!.textContent = `Rendering is slow (${number(offer.observedFps, 0)} fps). Try the ${this.levelName(offer.targetLevel)} level?`
    if (!snapshot.visible) return
    const { environment } = snapshot
    this.renderStatus()
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

  dispose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; this.source = undefined; this.qualityUnsubscribe?.(); this.qualityUnsubscribe = undefined; this.quality = undefined; this.abort.abort(); this.element.remove(); this.toggle.remove(); this.recommendation.remove() }
}
