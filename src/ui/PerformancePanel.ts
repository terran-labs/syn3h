import { longFrames } from '../core/longFrames'
import { params } from '../../shared/params'
import { presetFor, QUALITY, type QualitySource, type QualityState } from '../core/quality'
import type { PerformanceSnapshot, PerformanceSource } from '../core/performance'
import type { Inspector } from './inspector/Inspector'
import { SETTINGS_TITLE, type PropertyDef } from './inspector/model'
import { createSwitch, type Switch } from './inspector/switch'
import { resetButton, type ResetButton } from './resetControl'
import { recordBlankFrames } from '../core/blankFrames'
import { FIELD_SWITCHES, isOn, linkOf, linkWithSwitches, onFieldSwitches, pendingReload, reloadWithSwitches, setFieldSwitch } from '../core/fieldSwitches'
import { deviceGates } from '../core/deviceGates'

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
  private readonly recommendationSize?: ResizeObserver
  private wasVisible = false
  /** The "changed" mark beside each fine-tune row, by property id. */
  /** The fine-tune ids last laid out, to notice when one registers. */
  private shown?: string
  /** Which fine-tune folds were open, kept across rebuilds. */
  private readonly foldOpen = new Map<string, boolean>()
  private readonly select: HTMLSelectElement
  private readonly diagnostics: HTMLDetailsElement
  private get resolutionRange(): HTMLInputElement { return this.element.querySelector<HTMLInputElement>('.wi-resolution input')! }
  /** Auto quality: the standard switch, apart from the level stepper. */
  private readonly auto: Switch
  private readonly autoReset: ResetButton
  private readonly resolutionReset: ResetButton
  private readonly blankSwitch: Switch
  private blankCount: HTMLElement | null = null

  constructor(parent: HTMLElement, private readonly openRail: () => void, quality?: QualitySource, private readonly inspector?: Inspector, noticeStack?: HTMLElement) {
    const signal = this.abort.signal
    this.element.className = 'performance-card'
    this.element.innerHTML = `<div class="wi-level" role="group" aria-label="Quality level">
        <button type="button" class="wi-step" data-quality="down" aria-label="Lower quality level" data-tip="Lower quality">${CHEVRONS(false)}</button>
        <div class="wi-level-pick"><select class="wi-level-select" aria-label="Quality level" disabled></select><small class="wi-level-of"></small></div>
        <button type="button" class="wi-step" data-quality="up" aria-label="Raise quality level" data-tip="Raise quality">${CHEVRONS(true)}</button></div>
      <div class="wi-level-tools"><button type="button" data-quality="reset-all" data-resets-card disabled>Reset all to this level</button></div>
      <div class="wi-resolution" role="group" aria-label="Render resolution">
        <span class="wi-label">Render resolution</span>
        <input type="range" min="50" max="100" step="5" aria-label="Render resolution, percent of native" disabled>
        <output class="wi-res-value"></output>
        <button type="button" class="wi-res-auto" aria-pressed="true" disabled>Auto</button>
        <small class="wi-res-size"></small></div>
      <p class="performance-quality wi-blurb" aria-live="polite"></p><p class="performance-quality-detail"></p>
      <div class="wi-fine"></div>
      <div class="wi-registry"></div>
      <details class="wi-group performance-diagnostics"><summary><span>Diagnostics</span><small></small></summary>
      <div class="performance-body">
      <svg class="performance-chart" viewBox="0 0 288 64" role="img" aria-label="Frame time history"><path d="M0 63H288"/><polyline fill="none"/></svg>
      <p class="performance-history"></p><p class="performance-long-frames" style="user-select:text"></p><div class="performance-blank-frames"><small data-performance="blank-count"></small></div><details class="wi-group wi-subgroup performance-field-switches"><summary><span>Field switches</span><small></small></summary><div class="field-switch-rows"></div><div class="card-actions"><button type="button" class="panel-action" data-performance="copy-switch-link">Copy link with these switches</button><button type="button" class="panel-action" data-performance="reload-switches" hidden>Reload with these switches</button></div></details><div class="card-actions"><button type="button" class="panel-action" data-performance="copy-report">Copy diagnostics</button><button type="button" class="panel-action" data-performance="run-check">Run performance check</button><button type="button" class="panel-action" data-performance="report-bug">Report a bug</button></div>
      <span data-performance="copy-status" role="status"></span>
      <textarea data-performance="copy-text" aria-label="Diagnostics report" rows="8" readonly hidden></textarea><dl></dl><p class="performance-recovery" role="status"></p>
      <button type="button" class="panel-action" data-performance="reload" hidden>Reload to recover</button></div></details>`
    this.select = this.element.querySelector('select')!
    this.diagnostics = this.element.querySelector('details')!
    this.recommendation.className = 'performance-recommendation liquid-glass'; this.recommendation.hidden = true
    this.recommendation.setAttribute('role', 'status')
    this.recommendation.innerHTML = '<p></p><button type="button" class="panel-action" data-performance="ignore">Ignore</button><button type="button" class="panel-action" data-performance="bots" hidden>Fewer bots</button><button type="button" class="panel-action" data-performance="lower">Lower level</button><small class="performance-unlock" hidden>Esc for options</small>'
    ;(noticeStack ?? parent).append(this.recommendation)
    if (noticeStack) {
      this.recommendationSize = new ResizeObserver(([entry]) => {
        const height = entry.borderBoxSize[0]?.blockSize ?? noticeStack.offsetHeight
        parent.style.setProperty('--notice-stack-height', height + 'px')
      })
      this.recommendationSize.observe(noticeStack)
    }
    this.select.addEventListener('change', () => this.quality?.setLevel(Number(this.select.value)), { signal })
    this.auto = createSwitch('Auto quality', { className: 'wi-auto', signal, onChange: on => this.quality?.setAuto(on) })
    this.auto.input.disabled = true
    // Record blank frames: a 16 by 8 copy of each drawn frame, for black flashes (core/blankFrames.ts).
    this.blankSwitch = createSwitch('Record blank frames', { className: 'wi-blank-frames', signal, onChange: on => { params.set(recordBlankFrames.def.id, on); this.renderBlankFrames() } })
    this.blankSwitch.set(recordBlankFrames.value)
    const blankRow = this.element.querySelector<HTMLElement>('.performance-blank-frames')!
    blankRow.prepend(this.blankSwitch.element)
    this.blankCount = blankRow.querySelector<HTMLElement>('[data-performance=blank-count]')
    const offBlank = params.onChange(id => { if (id === recordBlankFrames.def.id) { this.blankSwitch.set(recordBlankFrames.value); this.renderBlankFrames() } })
    signal.addEventListener('abort', offBlank, { once: true })
    this.renderBlankFrames()
    this.buildFieldSwitches(signal)
    this.element.querySelector('.wi-level-tools')!.prepend(this.auto.element)
    // Auto quality and render resolution are built here, not by the row builder, so they take
    // the shared reset themselves (resetControl.ts): both default to Auto.
    this.autoReset = resetButton(() => this.quality?.setAuto(true))
    this.auto.element.classList.add('has-reset'); this.auto.element.append(this.autoReset.element)
    this.resolutionReset = resetButton(() => this.quality?.setResolution?.(null))
    const resolutionRow = this.element.querySelector<HTMLElement>('.wi-resolution')!
    resolutionRow.classList.add('has-reset'); resolutionRow.append(this.resolutionReset.element)
    // Render resolution: dragging previews the number; the renderer resizes once, on release.
    const range = this.resolutionRange
    range.addEventListener('input', () => this.renderResolution(Number(range.value) / 100), { signal })
    range.addEventListener('change', () => this.quality?.setResolution?.(Number(range.value) / 100), { signal })
    this.element.querySelector('.wi-res-auto')!.addEventListener('click', () => this.quality?.setResolution?.(null), { signal })
    this.element.querySelector('[data-quality=down]')!.addEventListener('click', () => this.quality?.stepDown(), { signal })
    this.element.querySelector('[data-quality=up]')!.addEventListener('click', () => this.quality?.stepUp(), { signal })
    this.element.querySelector('[data-quality=reset-all]')!.addEventListener('click', () => this.quality?.clearOverrides(), { signal })
    // Diagnostics sample only while their fold is open. The fold is the player's: whatever they
    // set, the source is told, even before its first snapshot has arrived.
    this.diagnostics.addEventListener('toggle', () => { if (this.diagnostics.open) this.renderBlankFrames(); if (this.diagnostics.open !== (this.snapshot?.visible ?? false)) this.source?.setDiagnosticsVisible(this.diagnostics.open) }, { signal })
    this.recommendation.querySelector('[data-performance=ignore]')!.addEventListener('click', () => this.source?.ignoreRecommendation(), { signal })
    this.recommendation.querySelector('[data-performance=lower]')!.addEventListener('click', () => this.source?.lowerRecommendedTier(), { signal })
    this.recommendation.querySelector('[data-performance=bots]')!.addEventListener('click', () => this.source?.fewerRecommendedBots?.(), { signal })
    this.element.querySelector('[data-performance=reload]')!.addEventListener('click', () => location.reload(), { signal })
    // Report a bug (src/ui/report): Shell pauses, then opens the sheet with a picture and this report.
    this.element.querySelector('[data-performance=report-bug]')!.addEventListener('click', () => this.element.dispatchEvent(new CustomEvent('mira:report-bug', { bubbles: true })), { signal })
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
    inspector?.addCard(PerformancePanel.CARD, SETTINGS_TITLE, this.element, () => this.state ? `${this.state.name} · Auto ${this.state.auto ? 'on' : 'off'}${this.snapshot?.recommendation ? ' · Running slow' : ''}` : '',
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
    host.replaceChildren()
    if (!inspector || !this.mounted) return
    const groups = new Map<string, PropertyDef[]>()
    for (const id of this.fineIds()) { const def = params.get(id)!.def as PropertyDef; groups.set(def.group, [...groups.get(def.group) ?? [], def]) }
    let first = true
    for (const [name, defs] of groups) {
      // A group Settings already has a section for (Graphics, Post, Light) takes the level's rows
      // at its top, so its heading shows once; the rest (the level's Water, Terrain and Lava
      // detail, whose sections are World's) keep a fold of their own here.
      const shared = inspector.sectionFold(PerformancePanel.CARD, name)
      const fold = shared ?? document.createElement('details')
      let at: Element | null = null
      if (shared) {
        const small = shared.querySelector(':scope > summary > small'); if (small) small.textContent = String(Number(small.textContent) + defs.length)
        at = shared.querySelector(':scope > summary')
        if (first && !this.foldOpen.has(name)) { shared.open = true; this.foldOpen.set(name, true) }
      } else {
        fold.className = 'wi-group'; fold.dataset.group = name; fold.open = this.foldOpen.get(name) ?? first
        const summary = document.createElement('summary'); summary.innerHTML = '<span></span><small></small>'
        summary.querySelector('span')!.textContent = name; summary.querySelector('small')!.textContent = String(defs.length)
        fold.append(summary)
      }
      first = false
      for (const def of defs) {
        // The row's shared reset (resetControl.ts) shows once the player sets this by hand, and
        // puts the level's own value back, not the registry's.
        const row = inspector.row(def, { reset: {
          value: () => this.state && def.id in this.state.overrides ? presetFor(this.state.level)[def.id] ?? def.default : undefined,
          apply: () => this.quality?.clearOverride(def.id),
        } })
        row.classList.add('is-fine')
        if (at) { at.after(row); at = row } else fold.append(row)
      }
      if (!shared) host.append(fold)
    }
    inspector.refreshResets()
  }

  private renderQuality(state: QualityState): void {
    this.state = state
    const levels = this.quality?.qualityLevels ?? [], first = levels[0]?.index ?? 0, last = levels.at(-1)?.index ?? 0
    if (document.activeElement !== this.select) this.select.value = String(state.level)
    this.element.querySelector('.wi-level-of')!.textContent = `Level ${levels.findIndex(level => level.index === state.level) + 1} of ${levels.length}`
    this.element.querySelector<HTMLButtonElement>('[data-quality=down]')!.disabled = state.level <= first
    this.element.querySelector<HTMLButtonElement>('[data-quality=up]')!.disabled = state.level >= last
    this.auto.set(state.auto)
    this.autoReset.set({ changed: !state.auto, defaultText: 'on', name: 'Auto quality' })
    this.renderResolution()
    const resetAll = this.element.querySelector<HTMLButtonElement>('[data-quality=reset-all]')!
    resetAll.textContent = `Reset all to ${state.name}`; resetAll.disabled = Object.keys(state.overrides).length === 0
    // A newly registered property joins the level: rebuild so it gets a row here. Compared by
    // content, since every state change is a new object.
    const shown = this.fineIds().join(' ')
    if (this.shown !== undefined && shown !== this.shown) { this.shown = shown; this.regroup() }
    else { this.shown = shown; this.inspector?.refreshResets() }
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
    this.resolutionReset.set({ changed: state.resolution !== null, defaultText: 'Auto', name: 'Render resolution' })
    const [width, height] = renderSize(innerWidth, innerHeight, ratio)
    this.element.querySelector('.wi-res-size')!.textContent = `${width} × ${height} px${chosen === null ? ' · set by Auto' : ''}`
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

  /**
   * Field switches (core/fieldSwitches.ts): every link switch as a row, the link name beside it,
   * live where it can be, "applies after reload" where the renderer fixes it, and each device
   * gate that has turned something off here, with a way to force it on for the visit. A box and
   * its link switch are one state; nothing here is saved.
   */
  private buildFieldSwitches(signal: AbortSignal): void {
    const fold = this.element.querySelector<HTMLDetailsElement>('.performance-field-switches')!
    const rows = fold.querySelector<HTMLElement>('.field-switch-rows')!
    // Each group is a sub-heading and a block of rows (core/fieldSwitches.ts, SwitchGroup).
    const blocks = new Map<string, HTMLElement>()
    const blockOf = (group: string) => {
      let block = blocks.get(group)
      if (block) return block
      block = document.createElement('div'); block.className = 'field-switch-block'; block.dataset.group = group
      const heading = document.createElement('p'); heading.className = 'field-switch-group'; heading.textContent = group
      block.append(heading); rows.append(block); blocks.set(group, block)
      return block
    }
    const syncs: (() => void)[] = []
    const choices = new Set<string>()
    for (const f of FIELD_SWITCHES.filter(f => f.row)) {
      const block = blockOf(f.group)
      if (f.choice) {
        // Entries that share a choice are one row: the level's own value, or one of theirs.
        if (choices.has(f.choice)) continue
        choices.add(f.choice)
        const options = FIELD_SWITCHES.filter(g => g.choice === f.choice)
        // Not a .wi-row: those are settings rows the inspector's search looks up by id.
        const row = document.createElement('div'); row.className = 'field-switch-choice'; row.dataset.switch = f.name
        const label = document.createElement('span'); label.className = 'field-switch-choice-label'; label.textContent = f.choice
        const note = document.createElement('small'); note.className = 'field-switch-link'
        note.textContent = `?${f.name}=${options.map(o => o.value).join('|')}${f.live ? '' : ' · applies after reload'}`
        label.append(note)
        const seg = document.createElement('div'); seg.className = 'wi-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', f.choice)
        const buttons = [{ key: null, text: 'Level' }, ...options.map(o => ({ key: o.key, text: o.label }))].map(({ key, text }) => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = text
          button.addEventListener('click', () => { if (key) setFieldSwitch(key, true); else for (const o of options) setFieldSwitch(o.key, false) }, { signal })
          seg.append(button)
          return { key, button }
        })
        row.append(label, seg); block.append(row)
        syncs.push(() => { for (const { key, button } of buttons) { const on = key ? isOn(key) : options.every(o => !isOn(o.key)); button.classList.toggle('is-on', on); button.setAttribute('aria-pressed', String(on)) } })
        continue
      }
      const box = createSwitch(f.label, { className: `field-switch${f.live ? '' : ' is-reload'}`, signal, checked: isOn(f.key), onChange: on => setFieldSwitch(f.key, on) })
      box.element.dataset.switch = linkOf(f)
      const note = document.createElement('small'); note.className = 'field-switch-link'
      note.textContent = f.live ? `?${linkOf(f)}` : `?${linkOf(f)} · applies after reload`
      box.element.querySelector('.s3-switch-text')!.append(note)
      block.append(box.element)
      syncs.push(() => box.set(isOn(f.key)))
    }
    // How shadows are drawn means nothing while they are off: that block shows only while sun
    // shadows are on (the level, ?shadows=0 and the device gate decide; gfx.shadowQuality says).
    const shadowBlock = blocks.get('Sun shadows')
    const syncShadows = () => { if (shadowBlock) shadowBlock.hidden = !(Number(params.get('gfx.shadowQuality')?.value) > 0) }
    signal.addEventListener('abort', params.onChange(id => { if (id === 'gfx.shadowQuality') syncShadows() }), { once: true })
    syncShadows()
    // Device gates: what a gate has turned off on this device, and its switch for the visit.
    const gates = deviceGates().filter(g => g.gated())
    if (gates.length) { const heading = document.createElement('p'); heading.className = 'field-switch-group'; heading.textContent = 'Device gates'; rows.append(heading) }
    for (const gate of gates) {
      const box = createSwitch(gate.label, { className: 'field-switch is-gate', signal, checked: gate.forced(), onChange: on => gate.force(on) })
      box.element.dataset.gate = gate.id
      const note = document.createElement('small'); note.className = 'field-switch-link'
      box.element.querySelector('.s3-switch-text')!.append(note)
      rows.append(box.element)
      const show = () => { box.set(gate.forced()); note.textContent = gate.forced() ? 'forced on for this visit' : 'off on this device by its gate' }
      show(); signal.addEventListener('abort', gate.watch(show), { once: true })
    }
    const reload = fold.querySelector<HTMLButtonElement>('[data-performance=reload-switches]')!
    const count = fold.querySelector('summary small')!
    const sync = () => {
      for (const sync of syncs) sync()
      reload.hidden = !pendingReload()
      const on = FIELD_SWITCHES.filter(f => isOn(f.key)).length
      count.textContent = on ? `${on} on` : 'none on'
    }
    signal.addEventListener('abort', onFieldSwitches(sync), { once: true })
    sync()
    reload.addEventListener('click', () => reloadWithSwitches(), { signal })
    fold.querySelector('[data-performance=copy-switch-link]')!.addEventListener('click', async () => {
      const status = this.element.querySelector<HTMLElement>('[data-performance=copy-status]')!
      const field = this.element.querySelector<HTMLTextAreaElement>('[data-performance=copy-text]')!
      const link = linkWithSwitches()
      try { await navigator.clipboard.writeText(link); field.hidden = true; status.textContent = 'Link copied.' }
      catch { field.value = link; field.hidden = false; field.select(); status.textContent = 'Select and copy the link below.' }
    }, { signal })
  }

  /** The running count beside "Record blank frames". */
  private renderBlankFrames(): void {
    const counts = this.source?.blankFrameCounts?.()
    const text = !recordBlankFrames.value && !counts?.total ? 'Off'
      : counts ? `${counts.lastMinute} in the last minute, ${counts.total} in total` : 'Starting'
    const field = this.blankCount
    if (field && field.textContent !== text) field.textContent = text
  }

  private render(snapshot: PerformanceSnapshot): void {
    this.snapshot = snapshot
    if (snapshot.visible) this.renderBlankFrames()
    // The fold follows the source only when the source's state changes (F3, ?diag=1). A snapshot
    // that merely repeats it must not undo the player: a fold opened by a click fires its toggle
    // event a task later, and a snapshot published in between still says "not visible", which
    // shut the fold under the player's pointer (blank-frames.mjs, under load, 23 November 2026).
    if (snapshot.visible !== this.wasVisible && this.diagnostics.open !== snapshot.visible) this.diagnostics.open = snapshot.visible
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
    this.recommendationSize?.disconnect(); this.abort.abort(); this.inspector?.removeCard(PerformancePanel.CARD); this.element.remove(); this.recommendation.remove()
  }
}
