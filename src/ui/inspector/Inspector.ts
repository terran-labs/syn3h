import { modeChoices } from '../modeAvailability'
/**
 * The world inspector: every property of the world and of your own settings, in play, as a
 * stack of frosted glass cards down the right edge. One card per logical section; inside an
 * open card the groups are an accordion; touching a property shows what it is for, its
 * limits and whether it is shared. A world can be copied as JSON and pasted back in.
 *
 * It is built from the parameter registry and knows no particular property: define one
 * anywhere and it appears. The data side is model.ts, which has no DOM and is tested alone.
 */
import { params, type ParamValue } from '../../../shared/params'
import { applyPreset, matchPreset, presetsFor } from '../../../shared/presets'
import { canEditWorld, resetWorld } from '../worldPermissions'
import { buildTree, describe, shownDef, shownValue, storedValue, exportSection, exportWorld, fraction, limits, parseWorld, pasteSummary, show, type PropertyDef, type SectionNode } from './model'
import './params'
import { fillDayLengthRow } from './dayLength'
import { sunDayLength, sunTimeOfDay } from '../../world/sky/skyParams'
import { currentHour } from '../../world/sky/dayCycle'
import './inspector.css'
import './motion.css'
import { bindSwitch } from './switch'
import { cardsToClose, comfortable, type FitCard } from './cardFit'
import './me-card.css'

/** A die showing five, drawn as one path: the Randomize and roll-a-name buttons. */
const DICE_GLYPH = '<svg class="wi-dice" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path fill="currentColor" d="M5 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM8 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-3 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>'

/**
 * Small line glyphs for the World card's actions, 16 px, drawn in the text colour: copy (two
 * sheets), paste (a sheet with an arrow in), reset (an arrow turning back). One stroked path each.
 */
const GLYPH = (d: string) => `<svg class="wi-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
const WORLD_ACTIONS = `<div class="wi-world-actions" role="group" aria-label="World actions">`
  + `<button type="button" data-wi="copy-world" aria-label="Copy world">${GLYPH('M5.5 5.5V3a1 1 0 0 1 1-1H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-2.5M3 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z')}<span>Copy</span></button>`
  + `<button type="button" data-wi="paste-world" aria-label="Paste world">${GLYPH('M5.5 3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5M6 2h4v2H6ZM8 6.5v5M5.8 9.4 8 11.6l2.2-2.2')}<span>Paste</span></button>`
  + `<button type="button" data-wi="reset" class="wi-reset" aria-label="Reset world to defaults">${GLYPH('M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5')}<span>Reset</span></button></div>`

export interface InspectorOptions {
  /** One line for a closed card, for example "Alpine · Harimos". Empty hides it. */
  summary(sectionId: string): string
  /**
   * The vehicles on offer and which is in use, for the picker in the Me card. `pending` is a
   * vehicle being switched to; `note` says why a choice is not available right now.
   */
  vehicles(): { options: readonly { id: string; label: string; glyph?: string }[]; current: string; pending?: string; note?: string }
  onVehicle(id: string): void
  /** The player's name, shown in the Me card. */
  playerName?(): string
  /** With this the name can be edited in place; it receives the trimmed new name. */
  onRename?(name: string): void
  /** A freshly generated name, for the dice beside the name. */
  rollName?(): string
  /** The player's vehicle colours as #rrggbb, as showing now (they ease when changed). */
  colors?(): { body: string; accent: string }
  /** Called on every movement in the colour picker, so the vehicle can repaint as it is dragged. */
  onColor?(key: 'body' | 'accent', value: string): void
  /** Pick a new pleasing pair of colours, for the Randomize button. */
  onRandomizeColors?(): void
  /** Capture a local bookmark. The caller owns storage and success or failure feedback. */
  onSaveWorld?(): void
  /**
   * Registry sections to show as cards, by id; all when absent. The lobby's settings panel
   * passes [] and shows only cards it adds with addCard.
   */
  sections?: readonly string[]
  /** Settings to show and edit as a percentage (a 0 to 1 value shown as 0% to 100%). */
  percent?(def: PropertyDef): boolean
  /**
   * True where only one card should be open at a time (phones). Opening a card then closes the
   * others, keeps the tapped header under the finger while they go, and eases the card into
   * view. Asked at every tap, so turning the phone counts.
   */
  oneOpen?(): boolean
  /**
   * Phones in play (the owner, 19 November 2026): an open card is the only thing on screen,
   * the list comes back when it closes, and the stack grows out of the Show panels control.
   * Asked at every change, so turning the phone counts.
   */
  phonePanels?(): boolean
  /** A localStorage key: which cards are open is kept there and restored on the next visit. */
  rememberOpen?: string
}
/** "Mode (0 tag, 1 hill)" or "Glass: 0 Clear, 1 Frosted" gives a name and named choices. */
export function choicesOf(def: PropertyDef): { name: string; options: { value: number; label: string }[] } | null {
  if (def.id === 'game.mode') return { name: 'Mode', options: modeChoices }
  if (typeof def.default !== 'number' || def.min === undefined || def.max === undefined || def.step !== 1) return null
  const found = [...def.label.matchAll(/(\d+)\s+([A-Za-z][A-Za-z ]*?)(?=\s*(?:,|\)|$|\d+\s))/g)].map(m => ({ value: Number(m[1]), label: m[2].trim() }))
  const lo = Math.min(def.min, def.max), hi = Math.max(def.min, def.max)
  if (found.length < 2 || found.length !== hi - lo + 1 || found.some((option, i) => option.value !== lo + i)) return null
  const name = def.label.slice(0, def.label.search(/\d/)).replace(/[\s:(]+$/, '')
  return { name: name || def.group, options: found.map(option => ({ value: option.value, label: option.label[0].toUpperCase() + option.label.slice(1) })) }
}

/**
 * Read what a player typed into a number field: "2400 m", "85%", "1,5" and "−3" all work.
 * Clamped to the property's limits and snapped to its step; null when there is no number.
 * A percentage on a 0 to 1 property means a fraction of it, so "85%" on a volume is 0.85.
 */
export function parseEdit(text: string, def: Pick<PropertyDef, 'min' | 'max' | 'step'>): number | null {
  let s = text.trim().replace(/[\u2212\u2013]/g, '-').replace(/[\s\u00a0_']/g, '')
  // One comma and no point is a decimal comma; otherwise commas group thousands.
  s = /^[-+]?\d*,\d+(?!.*[.,])/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(s)
  if (!match) return null
  const rest = s.slice(match[0].length)
  if (/\d/.test(rest)) return null
  let n = Number(match[0])
  if (!Number.isFinite(n)) return null
  const lo = def.min !== undefined && def.max !== undefined ? Math.min(def.min, def.max) : def.min
  const hi = def.min !== undefined && def.max !== undefined ? Math.max(def.min, def.max) : def.max
  if (rest.startsWith('%') && lo !== undefined && hi !== undefined && lo >= 0 && hi <= 1) n /= 100
  const clamp = (v: number) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v))
  n = clamp(n)
  if (def.step && def.step > 0) {
    const base = lo ?? 0, places = (String(def.step).split('.')[1] ?? '').length
    n = clamp(Number((base + Math.round((n - base) / def.step) * def.step).toFixed(places)))
  }
  return Object.is(n, -0) ? 0 : n
}

/** A card whose contents are built outside the registry, such as Performance. */
export interface ExtraCardOptions {
  /** Place it after the card with this section id; otherwise last. */
  after?: string
  /** Property ids this card shows itself. They leave the registry's own cards. */
  owns?(): readonly string[]
  /** Called after every rebuild (rows are rebuilt when properties register) to refill rows. */
  fill?(): void
}
interface ExtraCard extends ExtraCardOptions { id: string; card: HTMLElement; summary(): string }

/**
 * A card's header. The x (phones only, src/ui/phone-panels.css) shows while the card is the
 * one panel on screen. The whole header is the button, so the x wears the shared glass
 * (liquid-glass) but is drawn, not a separate target.
 */
const CARD_HEAD = '<h3></h3><span class="wi-sum"></span><span class="wi-chev" aria-hidden="true"></span><span class="wi-x liquid-glass glass-round" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg></span>'
/** Phone panels: how long each change between the three states takes (ms). Shorten, never lengthen: this is mid-game. */
export const PHONE_PANEL_MS = { show: 220, hide: 160, open: 240, back: 200, stagger: 15, staggerCap: 6, ghost: 140, ghostOut: 90 } as const

/** How long a card takes to make room for another, and the curve it eases along. */
const CARD_MOTION: KeyframeAnimationOptions = { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }
/** On a phone the stack moves less far and the player is waiting on a thumb: a little quicker. */
const PHONE_MOTION: KeyframeAnimationOptions = { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }
/** Close to the cards' easing curve, for the scroll that runs beside them. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3

export class Inspector {
  readonly element = document.createElement('aside')
  private tree: SectionNode[] = []
  private known = 0
  private selected = ''
  private tooltip!: HTMLElement
  private tooltipTimer?: ReturnType<typeof setTimeout>
  private readonly abort = new AbortController()
  private readonly rows = new Map<string, { row: HTMLElement; sync(value: ParamValue): void; def: PropertyDef }>()
  private readonly extras = new Map<string, ExtraCard>()
  private readonly unsubscribe: () => void
  /** Remembered open cards whose card has not been built yet (extras arrive after the first build). */
  private restoring: string[] = []
  /** Stops a running header glide (openOnly). */
  private glideStop?: () => void
  private shown = true
  private visibilityMotion?: Animation
  private visibilityInitialized = false
  private editable = true
  private armed?: ReturnType<typeof setTimeout>
  private pasteTarget: string | null = null
  private beforeSearch?: { cards: boolean[]; folds: boolean[] }
  /** The number being typed into, if any, and how to finish it. */
  private editing: { field: HTMLInputElement; finish(commit: boolean, refocus: boolean): void } | null = null
  /**
   * Open cards by section id, opened longest ago first. Survives the rail closing and
   * reopening and registry rebuilds, so the oldest card is still known.
   */
  private readonly openOrder: string[] = []
  /** A pointer is held down in this card (a slider being dragged). */
  private pressed: HTMLElement | null = null
  private fitQueued = false
  /** Card height animations in flight. A new toggle starts from wherever these have got to. */
  private readonly moving = new Map<HTMLElement, Animation>()

  constructor(parent: HTMLElement, private readonly options: InspectorOptions) {
    this.element.className = 'world-inspector'; this.element.setAttribute('aria-label', 'World inspector')
    this.element.innerHTML = `<div class="wi-top wi-glass"><input class="wi-search" type="search" placeholder="Search" aria-label="Find a setting" autocomplete="off" spellcheck="false">
      </div>
      <div class="wi-cards"></div>
      <div class="wi-detail wi-glass" hidden></div>
      <div class="wi-sheet wi-glass" hidden><strong></strong><textarea spellcheck="false" aria-label="World as JSON"></textarea><div class="wi-actions"><button type="button" data-wi="apply">Paste it in</button><button type="button" data-wi="close">Close</button></div></div>
      <p class="wi-status" role="status" aria-live="polite"></p>`
    parent.append(this.element)
    this.tooltip = this.element.querySelector<HTMLElement>('.wi-detail')!
    this.tooltip.classList.add('wi-tooltip'); this.tooltip.id = 'setting-tooltip'; this.tooltip.setAttribute('role', 'tooltip')
    parent.append(this.tooltip)
    const signal = this.abort.signal
    this.tooltip.addEventListener('pointerenter', () => clearTimeout(this.tooltipTimer), { signal })
    this.tooltip.addEventListener('pointerleave', () => this.hideTooltip(), { signal })
    this.tooltip.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') this.hideTooltip() }, { signal })
    this.element.addEventListener('scroll', () => this.hideTooltip(), { capture: true, signal })
    window.addEventListener('resize', () => this.hideTooltip(), { signal })
    document.addEventListener('pointerdown', event => { if (!(event.target as Element).closest('.wi-row, .wi-tooltip')) this.hideTooltip() }, { signal })
    this.vehicleControl = this.vehicleSwitch()
    this.vehicleControl.dataset.search = `vehicle colour color body accent randomize ${this.options.vehicles().options.map(o => o.label.toLowerCase()).join(' ')}`
    this.nameControl = this.nameEditor()
    // Escape in the name field cancels the edit. This runs before the shell's own Escape,
    // which only blurs a text field (and the blur would otherwise save).
    window.addEventListener('keydown', event => { if (event.code === 'Escape' && event.target === this.nameInput) this.nameInput.value = this.options.playerName?.() ?? '' }, { capture: true, signal: this.abort.signal })
    this.restoring = this.recall()
    this.build()
    this.unsubscribe = params.onChange((id, value) => {
      this.rows.get(id)?.sync(value)
      // The orbit default is the planet's: a new planet changes what the day length shows.
      if (id === 'terrain.look') this.rows.get(sunDayLength.def.id)?.sync(params.get(sunDayLength.def.id)!.value)
      for (const sync of this.presetSyncs) sync()
    })
    // Space changes (a resize, a phone turning, a fold opening inside a card): refit once,
    // on the next frame, not every frame.
    window.addEventListener('resize', () => this.queueFit(null), { signal })
    this.element.addEventListener('toggle', event => { const card = (event.target as Element).closest<HTMLElement>('.wi-card'); this.queueFit(card) }, { capture: true, signal })
    if (typeof ResizeObserver !== 'undefined') { const watch = new ResizeObserver(() => this.queueFit(null)); watch.observe(this.element.querySelector('.wi-cards')!); signal.addEventListener('abort', () => watch.disconnect()) }
    this.element.addEventListener('pointerdown', event => { this.pressed = (event.target as Element).closest<HTMLElement>('.wi-card') }, { signal })
    window.addEventListener('pointerup', () => { this.pressed = null }, { signal }); window.addEventListener('pointercancel', () => { this.pressed = null }, { signal })
    this.element.addEventListener('click', event => this.click(event))
    this.element.querySelector<HTMLInputElement>('.wi-search')!.addEventListener('input', event => this.search((event.target as HTMLInputElement).value))
    // Typing here must not drive the vehicle.
    this.element.addEventListener('keydown', event => { if ((event.target as Element).matches('input[type=search], textarea, input[type=number], .wi-num-edit')) event.stopPropagation() })
    // Enter and Escape finish a number edit. This listens on the window in the capture phase,
    // registered before the shell's own, so Escape cancels the edit instead of closing the rail.
    window.addEventListener('keydown', event => {
      const edit = this.editing
      if (!edit || event.target !== edit.field || event.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); edit.finish(true, true) }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); edit.finish(false, true) }
    }, { capture: true, signal })
  }
  get open(): boolean { return this.shown }
  set open(value: boolean) {
    if (this.visibilityInitialized && value === this.shown) return
    const animate = this.visibilityInitialized && !matchMedia('(prefers-reduced-motion: reduce)').matches
    this.visibilityInitialized = true
    this.shown = value
    this.visibilityMotion?.cancel()
    this.visibilityMotion = undefined
    // Closing stops hit testing immediately, even while the panel fades away.
    this.element.inert = !value
    this.element.style.pointerEvents = value ? '' : 'none'
    if (!value) this.hideTooltip()
    this.element.hidden = false
    const phone = !!this.options.phonePanels?.()
    // Show panels always opens the list (the owner's call, 19 November 2026). The stack is
    // hidden here, so closing the card shows nothing; the Y key and the Chat row open their
    // card straight after this.
    if (value && phone) this.collapseAll()
    this.syncSingle()
    if (!animate) { this.element.hidden = !value; return }
    // Phones: the stack grows out of the Show panels control (transform-origin is set beside
    // it in phone-panels.css) and goes back into it, quicker. Transform and opacity only, so
    // the compositor runs it and the game canvas is never laid out again.
    const frames = phone
      ? [{ opacity: 0, transform: 'translateY(24px) scale(.94)' }, { opacity: 1, transform: 'none' }]
      : [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'translateX(0)' }]
    const duration = phone ? (value ? PHONE_PANEL_MS.show : PHONE_PANEL_MS.hide) : 180
    if (phone && value) this.arrive()
    const motion = this.element.animate(value ? frames : [...frames].reverse(), { duration, easing: phone && !value ? 'cubic-bezier(.4,0,.8,.4)' : 'cubic-bezier(.2,.8,.2,1)' })
    this.visibilityMotion = motion
    motion.onfinish = () => {
      if (this.visibilityMotion !== motion) return
      this.element.hidden = !this.shown
      this.visibilityMotion = undefined
    }
  }
  /** The open cards saved by an earlier visit, newest last; only the newest where one is open at a time. */
  private recall(): string[] {
    const key = this.options.rememberOpen; if (!key) return []
    let ids: string[] = []
    try { const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); if (Array.isArray(saved)) ids = saved.filter((id): id is string => typeof id === 'string') } catch { /* Storage is optional. */ }
    return this.options.oneOpen?.() ? ids.slice(-1) : ids
  }
  private remember(): void {
    const key = this.options.rememberOpen
    // A search opens every card with a match; that is not the player's choice.
    if (!key || this.element.classList.contains('is-searching')) return
    try { localStorage.setItem(key, JSON.stringify([...this.restoring, ...this.openOrder])) } catch { /* Storage is optional. */ }
  }

  /** Rebuild if properties have been defined since the last look; refresh summaries and locks. */
  update(): void {
    if (params.all().length !== this.known) this.build()
    const editable = canEditWorld()
    if (editable !== this.editable) { this.editable = editable; for (const { row, def } of this.rows.values()) if (def.scope === 'world') for (const control of row.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = !editable; for (const select of this.element.querySelectorAll<HTMLSelectElement>('.wi-preset select')) select.disabled = !editable; this.markLocks(); this.element.classList.toggle('is-locked', !editable) }
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-card')) {
      const id = card.dataset.section!, extra = this.extras.get(id), sum = card.querySelector('.wi-sum')!
      const text = extra ? extra.summary() : this.options.summary(id) || `${this.tree.find(s => s.id === id)?.count ?? 0} properties`
      if (sum.textContent !== text) sum.textContent = text
    }
    // The stored hour is the day clock's anchor; the row shows the hour now (dayCycle.ts).
    const clock = this.rows.get(sunTimeOfDay.def.id)
    if (clock) clock.sync(Math.round(currentHour() * 100) / 100)
    this.syncVehicles()
    const name = this.options.playerName?.() ?? ''
    if (this.nameInput && document.activeElement !== this.nameInput && this.nameInput.value !== name) this.nameInput.value = name
    const colors = this.options.colors?.()
    if (colors) for (const dot of this.element.querySelectorAll<HTMLElement>('[data-colour]')) dot.style.backgroundColor = colors[dot.dataset.colour as 'body' | 'accent']
    if (colors) for (const input of this.tintInputs) { const value = colors[input.dataset.tint as 'body' | 'accent']; if (input.value !== value && document.activeElement !== input) input.value = value }
  }
  private build(): void {
    const all = params.all(); this.known = all.length
    const open = new Set([...this.element.querySelectorAll<HTMLElement>('.wi-card.is-open')].map(card => card.dataset.section))
    const owned = new Set([...this.extras.values()].flatMap(extra => extra.owns?.() ?? []))
    const shown = this.options.sections
    this.tree = buildTree(all.map(p => p.def as PropertyDef).filter(def => !owned.has(def.id) && !def.hidden)).filter(section => !shown || shown.includes(section.id))
    this.rows.clear(); this.presetSyncs.length = 0; this.editing = null; this.settle()
    const cards = this.element.querySelector('.wi-cards')!; cards.replaceChildren()
    for (const section of this.tree) {
      const card = document.createElement('section'); card.className = 'wi-card wi-glass'; card.dataset.section = section.id
      const head = document.createElement('button'); head.type = 'button'; head.className = 'wi-head'; head.dataset.wi = 'toggle'; head.setAttribute('aria-expanded', 'false')
      head.innerHTML = CARD_HEAD; head.querySelector('h3')!.textContent = section.title
      const body = document.createElement('div'); body.className = 'wi-body'; body.hidden = true
      if (section.id === 'you') {
        body.append(this.vehicleControl, this.nameControl)
        const dots = document.createElement('span'); dots.className = 'wi-colour-dots'; dots.setAttribute('aria-label', 'Vehicle colours')
        dots.innerHTML = '<i data-colour="body"></i><i data-colour="accent"></i>'; head.querySelector('.wi-sum')!.after(dots)
      }
      const blurb = document.createElement('p'); blurb.className = 'wi-blurb'; blurb.textContent = section.blurb; body.append(blurb)
      // The whole world's actions live in its own card, at the top: copy, paste, and (set
      // apart, and asked twice) reset.
      if (section.id === 'world') body.insertAdjacentHTML('beforeend', WORLD_ACTIONS)

      section.tree.forEach((group, index) => {
        const fold = document.createElement('details'); fold.className = 'wi-group'; fold.dataset.group = group.name; fold.open = index === 0 && !['Tag', 'Tag beams', 'Zorb', 'Sun', 'Sky', 'Weather'].includes(group.name)
        const summary = document.createElement('summary'); summary.innerHTML = '<span></span><small></small>'
        summary.querySelector('span')!.textContent = group.name; summary.querySelector('small')!.textContent = String(group.properties.length)
        fold.append(summary)
        const handling = this.presetRow(group.name); if (handling) fold.append(handling)
        for (const def of group.properties) fold.append(this.row(def)); body.append(fold)
      })
      const foot = document.createElement('div'); foot.className = 'wi-actions wi-foot'
      // The World card copies and pastes the whole world from its action row above; a second,
      // section-only pair here would only be the same thing smaller.
      if (section.id !== 'world') foot.innerHTML = '<button type="button" data-wi="copy-section">Copy JSON</button><button type="button" data-wi="paste-section">Paste</button>'
      if (section.id === 'world' && this.options.onSaveWorld) {
        const save = document.createElement('button'); save.type = 'button'; save.dataset.wi = 'save-world'; save.textContent = 'Save current world'
        // Saving a local copy does not edit the shared world, even for a locked guest.
        // Keep native keyboard activation, but do not send Enter/Space to driving input.
        // Keyup still bubbles so a previously held driving key can be released here.
        save.addEventListener('keydown', event => event.stopPropagation())
        foot.append(save)
      }
      body.append(foot); card.append(head, body); cards.append(card)
      if (open.has(section.id)) this.toggle(card, true)
    }
    // Extra cards are the same elements across rebuilds, so they keep their open state.
    for (const extra of this.extras.values()) { this.place(extra); extra.fill?.() }
    // Open what the last visit left open, as each card arrives.
    for (const id of [...this.restoring]) {
      const card = cards.querySelector<HTMLElement>(`:scope > .wi-card[data-section="${CSS.escape(id)}"]`)
      if (card) { this.restoring.splice(this.restoring.indexOf(id), 1); if (!card.classList.contains('is-open')) this.toggle(card, true) }
    }
    // Cards that did not come back are no longer open.
    const present = new Set([...this.element.querySelectorAll<HTMLElement>('.wi-card.is-open')].map(card => card.dataset.section!))
    for (let i = this.openOrder.length - 1; i >= 0; i--) if (!present.has(this.openOrder[i])) this.openOrder.splice(i, 1)
    this.editable = !canEditWorld(); this.update()
  }
  private place(extra: ExtraCard): void {
    const cards = this.element.querySelector('.wi-cards')!, after = extra.after ? cards.querySelector(`:scope > [data-section="${extra.after}"]`) : null
    if (after) after.after(extra.card); else cards.append(extra.card)
  }
  /**
   * Add a card built elsewhere, with the same header, summary, easing and targets as the
   * registry's cards. `body` becomes its collapsing body. It survives rebuilds; build rows in
   * it with row() from options.fill, which runs after every rebuild.
   */
  addCard(id: string, title: string, body: HTMLElement, summary: () => string, options: ExtraCardOptions = {}): HTMLElement {
    this.removeCard(id)
    const card = document.createElement('section'); card.className = 'wi-card wi-glass'; card.dataset.section = id
    const head = document.createElement('button'); head.type = 'button'; head.className = 'wi-head'; head.dataset.wi = 'toggle'; head.setAttribute('aria-expanded', 'false')
    head.innerHTML = CARD_HEAD; head.querySelector('h3')!.textContent = title
    body.classList.add('wi-body'); body.hidden = true; body.inert = true
    card.append(head, body)
    this.extras.set(id, { ...options, id, card, summary })
    // Rebuild so the ids it owns leave their old cards, then place and fill it.
    this.build()
    return card
  }
  removeCard(id: string): void {
    const extra = this.extras.get(id); if (!extra) return
    this.moving.get(extra.card)?.cancel(); this.moving.delete(extra.card)
    this.extras.delete(id); extra.card.remove(); this.build()
  }
  /** Rebuild now, for an extra card whose owned properties changed. */
  rebuild(): void { this.build() }
  /** Open one card (leaving the others as they are), easing as a header click does. */
  revealCard(id: string): void {
    const card = this.element.querySelector<HTMLElement>(`.wi-card[data-section="${id}"]`)
    if (!card || card.classList.contains('is-open')) return
    // The panels are still growing into view: land on the card without a second motion.
    if (this.single) { this.showOnly(card); return }
    if (this.options.oneOpen?.()) this.openOnly(card)
    else this.reflow(() => { this.toggle(card, true); this.fit(card, true) })
  }
  /**
   * The Me card's vehicle picker: a segmented control, one segment per vehicle with a drawn
   * glyph and its name, the chosen one filled. A radiogroup: arrow keys move and choose, Home
   * and End jump. Below it the two colours, labelled, and Randomize.
   */
  private vehicleSwitch(): HTMLElement {
    const wrap = document.createElement('div'); wrap.className = 'wi-vehicle'
    const group = document.createElement('div'); group.className = 'wi-vehicle-picker'; group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', 'Vehicle')
    for (const option of this.options.vehicles().options) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'wi-vehicle-option'; button.setAttribute('role', 'radio')
      button.dataset.segVehicle = option.id; button.setAttribute('aria-checked', 'false'); button.tabIndex = -1
      button.innerHTML = `${option.glyph ? `<svg viewBox="0 0 24 14" aria-hidden="true" focusable="false"><path d="${option.glyph}"/></svg>` : ''}<span></span>`
      button.querySelector('span')!.textContent = option.label
      group.append(button)
    }
    const choose = (button: HTMLElement | null) => { if (button?.dataset.segVehicle && !button.matches('[aria-disabled=true]')) this.options.onVehicle(button.dataset.segVehicle) }
    group.addEventListener('click', event => choose((event.target as Element).closest<HTMLElement>('.wi-vehicle-option')), { signal: this.abort.signal })
    group.addEventListener('keydown', event => {
      const buttons = [...group.querySelectorAll<HTMLElement>('.wi-vehicle-option')], at = buttons.indexOf(document.activeElement as HTMLElement)
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      const to = step ? (at + step + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
      if (to < 0 || at < 0) return
      // The keys belong to the picker here, not to driving.
      event.preventDefault(); event.stopPropagation()
      buttons[to].focus(); choose(buttons[to])
    }, { signal: this.abort.signal })
    const note = document.createElement('p'); note.className = 'wi-vehicle-note'; note.setAttribute('aria-live', 'polite')
    wrap.append(group, note)
    if (!this.options.colors || !this.options.onColor) return wrap
    // Each swatch opens the platform's own colour picker; the vehicle repaints while it is dragged.
    const tint = document.createElement('div'); tint.className = 'wi-tint'; tint.setAttribute('role', 'group'); tint.setAttribute('aria-label', 'Vehicle colours')
    for (const [key, name] of [['body', 'Body'], ['accent', 'Accent']] as const) {
      const swatch = document.createElement('label'); swatch.className = 'wi-swatch'; swatch.title = `${name} colour`
      const input = document.createElement('input'); input.type = 'color'; input.dataset.tint = key; input.setAttribute('aria-label', `${name} colour`)
      input.addEventListener('input', () => this.options.onColor!(key, input.value), { signal: this.abort.signal })
      const caption = document.createElement('span'); caption.textContent = name
      swatch.append(input, caption); tint.append(swatch); this.tintInputs.push(input)
    }
    if (this.options.onRandomizeColors) {
      const dice = document.createElement('button'); dice.type = 'button'; dice.className = 'wi-randomize'
      dice.innerHTML = `${DICE_GLYPH}<span>Randomize</span>`; dice.title = 'Pick a new pair of colours'
      dice.addEventListener('click', () => this.options.onRandomizeColors!(), { signal: this.abort.signal })
      tint.append(dice)
    }
    wrap.append(tint); return wrap
  }
  /** Keep the picker's checked, pending and unavailable states in step with the game. */
  private syncVehicles(): void {
    const vehicles = this.options.vehicles()
    for (const button of this.vehicleControl.querySelectorAll<HTMLElement>('.wi-vehicle-option')) {
      const id = button.dataset.segVehicle!, checked = id === vehicles.current, pending = id === vehicles.pending
      if (button.getAttribute('aria-checked') !== String(checked)) button.setAttribute('aria-checked', String(checked))
      // Roving focus: the checked segment is the one Tab reaches.
      const tab = checked ? 0 : -1
      if (button.tabIndex !== tab) button.tabIndex = tab
      button.classList.toggle('is-pending', pending)
      if (pending) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy')
      const blocked = Boolean(vehicles.note) && !checked
      if (button.matches('[aria-disabled=true]') !== blocked) { if (blocked) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled') }
    }
    const note = this.vehicleControl.querySelector('.wi-vehicle-note')!, text = vehicles.pending ? 'Switching…' : vehicles.note ?? ''
    if (note.textContent !== text) note.textContent = text
  }
  /**
   * The player's name, edited in place: tap or click to edit, Enter or leaving the field
   * saves, Escape cancels. The dice beside it rolls a new generated name.
   */
  private nameEditor(): HTMLElement {
    const row = document.createElement('div'); row.className = 'wi-person-name'; row.dataset.search = 'player name identity rename'
    const label = document.createElement('label'); label.className = 'wi-name-label'; label.textContent = 'Player name'
    const input = document.createElement('input'); input.className = 'wi-name-input'; input.type = 'text'; input.maxLength = 24; input.spellcheck = false
    input.setAttribute('autocomplete', 'nickname'); input.enterKeyHint = 'done'; input.id = 'wi-player-name'; label.htmlFor = input.id
    input.value = this.options.playerName?.() ?? ''
    this.nameInput = input
    if (!this.options.onRename) input.readOnly = true
    const save = () => {
      const next = input.value.trim(), current = this.options.playerName?.() ?? ''
      if (next && next !== current) this.options.onRename?.(next)
      input.value = this.options.playerName?.() ?? next
    }
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur() } }, { signal: this.abort.signal })
    input.addEventListener('blur', save, { signal: this.abort.signal })
    input.addEventListener('focus', () => input.select(), { signal: this.abort.signal })
    row.append(label, input)
    if (this.options.rollName && this.options.onRename) {
      const dice = document.createElement('button'); dice.type = 'button'; dice.className = 'wi-name-roll'; dice.innerHTML = DICE_GLYPH
      dice.setAttribute('aria-label', 'Roll a new name'); dice.title = 'Roll a new name'
      dice.addEventListener('click', () => { const name = this.options.rollName!(); this.options.onRename!(name); input.value = this.options.playerName?.() ?? name }, { signal: this.abort.signal })
      row.append(dice)
    }
    return row
  }
  private nameControl!: HTMLElement
  private nameInput!: HTMLInputElement
  private vehicleControl!: HTMLElement
  private readonly tintInputs: HTMLInputElement[] = []
  /** Opens the existing registered GI slider, rather than creating a second control. */
  private showGI(): void {
    const search = this.element.querySelector<HTMLInputElement>('.wi-search')!; search.value = ''; this.search('')
    const row = this.rows.get('post.gi')?.row
    if (!row) { this.setStatus('GI controls are unavailable in this build.'); return }
    const card = row.closest<HTMLElement>('.wi-card')!
    this.reflow(() => { for (const other of this.element.querySelectorAll<HTMLElement>('.wi-card')) this.toggle(other, other === card) })
    row.closest<HTMLDetailsElement>('details')!.open = true
    this.hideTooltip()
    row.scrollIntoView({ block: 'nearest' })
    const input = row.querySelector<HTMLInputElement>('input')!
    if (!input.disabled) input.focus({ preventScroll: true })
  }
  setGIStatus(message: string, eligible: boolean): void {
    const row = this.rows.get('post.gi')?.row
    if (!row) return
    let note = row.querySelector<HTMLElement>('.wi-gi-status')
    if (!note) { note = document.createElement('small'); note.className = 'wi-gi-status'; note.id = 'gi-status'; row.append(note) }
    if (note.textContent !== message) note.textContent = message
    const input = row.querySelector<HTMLInputElement>('input')!
    input.disabled = !eligible; input.setAttribute('aria-describedby', 'gi-status')
    const number = row.querySelector<HTMLButtonElement>('.wi-num'); if (number) number.disabled = !eligible
  }
  /** Keep each Handling dropdown showing the preset the current values match. */
  private readonly presetSyncs: (() => void)[] = []
  /**
   * The Handling dropdown at the top of a vehicle's settings group (shared/presets.ts): choosing
   * a preset sets its settings as the sliders would; the current preset is found by comparing
   * values, and any other mix shows as Custom. Room settings, so the world lock applies.
   */
  private presetRow(group: string): HTMLElement | null {
    const presets = presetsFor(group)
    if (!presets.length) return null
    const row = document.createElement('div'); row.className = 'wi-preset'; row.dataset.group = group
    const label = document.createElement('label'); label.className = 'wi-preset-pick'
    const caption = document.createElement('span'); caption.className = 'wi-label'; caption.textContent = 'Handling'
    const select = document.createElement('select'); select.setAttribute('aria-label', `${group} handling preset`)
    for (const [i, preset] of presets.entries()) { const option = document.createElement('option'); option.value = String(i); option.textContent = preset.name; select.append(option) }
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Custom'; custom.disabled = true; select.append(custom)
    label.append(caption, select)
    const about = document.createElement('p'); about.className = 'wi-blurb wi-preset-about'
    row.append(label, about)
    select.addEventListener('change', () => { const preset = presets[Number(select.value)]; if (preset && canEditWorld()) applyPreset(preset); sync() }, { signal: this.abort.signal })
    const sync = () => {
      const match = matchPreset(presets, id => params.get(id)?.value)
      const value = match ? String(presets.indexOf(match)) : 'custom'
      if (select.value !== value) select.value = value
      const text = match?.description ?? 'Your own mix: the settings below differ from every preset.'
      if (about.textContent !== text) about.textContent = text
    }
    sync(); this.presetSyncs.push(sync)
    return row
  }
  /** A shared switch a guest cannot change shows a lock and "host" beside its true state. */
  private markLocks(): void {
    for (const { row, def } of this.rows.values()) {
      const lock = row.querySelector<HTMLElement>('.wi-lock'); if (!lock) continue
      const locked = def.scope === 'world' && !this.editable
      lock.hidden = !locked; row.classList.toggle('is-locked-row', locked)
    }
  }
  /** One property row: slider, toggle, choice or number, kept in sync with the registry. */
  row(def: PropertyDef): HTMLElement {
    if (def.id === 'post.gi') def = { ...def, label: 'Global illumination (GI)' }
    if (def.id === 'post.giRadius') def = { ...def, label: 'GI light reach (m)' }
    const row = document.createElement('div'); row.className = 'wi-row'; row.dataset.id = def.id
    const label = document.createElement('span'); label.className = 'wi-label'
    const output = document.createElement('output')
    const param = params.get(def.id)!, choices = choicesOf(def)
    let sync: (value: ParamValue) => void
    if (def.id === sunDayLength.def.id) {
      // Seconds stored, minutes shown, a log slider and the orbit default: its own control.
      def = { ...def, label: 'Day length', limitsText: '20 s to 60 min on the slider, or stopped · default: the orbit' }
      const day = fillDayLengthRow(row, def.id); sync = () => day()
    } else if (choices) {
      label.textContent = choices.name
      const seg = document.createElement('div'); seg.className = 'wi-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', choices.name)
      for (const option of choices.options) { const button = document.createElement('button'); button.type = 'button'; button.dataset.value = String(option.value); button.textContent = option.label; button.addEventListener('click', () => params.set(def.id, option.value, 'local')); seg.append(button) }
      row.classList.add('is-choice'); row.append(label, seg)
      sync = value => { for (const button of seg.querySelectorAll<HTMLElement>('button')) { const on = Number(button.dataset.value) === Math.round(Number(value)); button.classList.toggle('is-on', on); button.setAttribute('aria-pressed', String(on)) } }
    } else if (typeof def.default === 'boolean') {
      label.textContent = def.label
      // The standard switch (switch.ts): role switch, aria-checked, Space and Enter toggle.
      const box = document.createElement('input'); box.setAttribute('aria-label', def.label)
      const set = bindSwitch(box, { signal: this.abort.signal })
      box.addEventListener('change', () => params.set(def.id, box.checked, 'local'))
      // The track stays small; the label around it is the 44 px target a thumb can hit, and
      // the row's own label text toggles it too.
      const hit = document.createElement('label'); hit.className = 'wi-hit'; hit.append(box)
      label.addEventListener('click', () => { if (!box.disabled) box.click() })
      // Shown only while a guest is held by the host's lock, so a locked switch never reads as off.
      const lock = document.createElement('span'); lock.className = 'wi-lock'; lock.textContent = 'host'; lock.hidden = true
      const word = document.createElement('span'); output.append(word, lock)
      row.classList.add('is-switch'); row.append(label, hit, output)
      sync = value => { set(Boolean(value)); word.textContent = show(Boolean(value)); row.classList.toggle('is-checked', Boolean(value)) }
    } else {
      label.textContent = def.label
      // A display mapping (ParamDef.display) puts the slider, number and typing in display
      // units; what is stored and sent is converted back.
      const view = shownDef(def), toShown = (value: ParamValue) => shownValue(def, Number(value))
      const ranged = view.min !== undefined && view.max !== undefined
      const input = document.createElement('input'); input.type = ranged ? 'range' : 'number'; input.setAttribute('aria-label', def.label)
      if (ranged) { input.min = String(Math.min(view.min!, view.max!)); input.max = String(Math.max(view.min!, view.max!)) }
      input.step = String(view.step ?? 'any')
      // The number beside the slider is a button: press it and it becomes a field to type into.
      const number = document.createElement('button'); number.type = 'button'; number.className = 'wi-num'
      const display = (text: string) => { number.textContent = text; number.setAttribute('aria-label', `${def.label}: ${text}, edit`) }
      const percent = this.options.percent?.(def) ?? false
      const shown = (value: ParamValue) => percent ? `${Math.round(Number(value) * 100)}%` : show(toShown(value), view)
      number.addEventListener('click', () => this.edit(def, number))
      number.addEventListener('keydown', event => { if (event.key === 'F2') { event.preventDefault(); this.edit(def, number) } })
      // A property marked deferred (the terrain rebuilds) applies when the slider is let go.
      input.addEventListener(def.deferred ? 'change' : 'input', () => params.set(def.id, storedValue(def, Number(input.value)), 'local'))
      if (def.deferred) input.addEventListener('input', () => display(shown(storedValue(def, Number(input.value)))))
      row.append(label, input, number)
      sync = value => { if (document.activeElement !== input) input.value = String(toShown(value)); display(shown(value)) }
      if (percent) number.dataset.percent = ''
    }
    sync(param.value)
    row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') this.detail(def) })
    row.addEventListener('focusin', () => this.detail(def))
    row.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') this.detail(def) })
    row.addEventListener('pointerleave', () => { this.tooltipTimer = setTimeout(() => this.hideTooltip(), 160) })
    row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget as Node)) this.hideTooltip() })
    for (const control of row.querySelectorAll('input, button')) control.setAttribute('aria-describedby', 'setting-tooltip')
    this.rows.set(def.id, { row, sync, def })
    return row
  }
  /** Swap a row's number for a text field, preselected. Enter or leaving commits; Escape cancels. */
  private edit(def: PropertyDef, number: HTMLButtonElement): void {
    if (number.disabled || number.hidden) return
    this.editing?.finish(true, false)
    const field = document.createElement('input'); field.type = 'text'; field.inputMode = 'decimal'; field.enterKeyHint = 'done'
    field.className = 'wi-num-edit'; field.autocomplete = 'off'; field.spellcheck = false
    field.setAttribute('aria-label', def.label); field.setAttribute('aria-describedby', 'setting-tooltip')
    const percent = number.dataset.percent !== undefined
    const before = (number.textContent ?? '').replace(/%$/, '')
    field.value = before
    let done = false, flash: ReturnType<typeof setTimeout> | undefined
    const mark = (element: HTMLElement) => { element.classList.remove('is-invalid'); void element.offsetWidth; element.classList.add('is-invalid'); clearTimeout(flash); flash = setTimeout(() => element.classList.remove('is-invalid'), 700) }
    const finish = (commit: boolean, refocus: boolean) => {
      if (done) return
      if (commit) {
        // A percentage field holds the number without its sign; parseEdit reads "60%" as 0.6.
        const typed = percent && !/%\s*$/.test(field.value) ? `${field.value.trim()}%` : field.value
        const typedValue = parseEdit(typed, shownDef(def)), value = typedValue === null ? null : storedValue(def, typedValue)
        // Nothing readable: put the old number back. Pressing Enter keeps the field open to try again.
        if (value === null && refocus) { field.value = before; field.select(); mark(field); return }
        if (value === null) mark(number)
        else params.set(def.id, value, 'local')
      }
      done = true; if (this.editing?.field === field) this.editing = null
      number.hidden = false; if (refocus) number.focus({ preventScroll: true })
      field.remove()
    }
    field.addEventListener('blur', () => finish(true, false))
    this.editing = { field, finish }
    number.hidden = true; number.after(field)
    field.focus({ preventScroll: true }); field.select()
  }
  hideTooltip(): void {
    clearTimeout(this.tooltipTimer); this.tooltip.hidden = true; this.selected = ''
    for (const { row } of this.rows.values()) row.classList.remove('is-selected')
  }
  /** A contextual tooltip beside the control, or above it when the viewport is narrow. */
  private detail(def: PropertyDef): void {
    clearTimeout(this.tooltipTimer)
    if (this.selected === def.id && !this.tooltip.hidden) return
    this.selected = def.id
    for (const { row } of this.rows.values()) row.classList.toggle('is-selected', row.dataset.id === def.id)
    const pane = this.tooltip, value = params.get(def.id)?.value ?? def.default, at = fraction(def, value), home = fraction(def, def.default)
    const choices = choicesOf(def)
    pane.replaceChildren()
    const head = document.createElement('div'); head.className = 'wi-detail-head'
    const name = document.createElement('strong'); name.textContent = choices?.name ?? def.label
    const scope = document.createElement('span'); scope.className = `wi-chip${def.scope === 'world' ? ' is-shared' : ''}`; scope.textContent = def.scope === 'world' ? 'shared with the room' : 'yours only'
    const id = document.createElement('code'); id.textContent = def.id
    head.append(name, scope, id); pane.append(head)
    const text = describe(def)
    if (text) { const p = document.createElement('p'); p.textContent = text; pane.append(p) }
    if (at !== null) {
      const bar = document.createElement('div'); bar.className = 'wi-guard'; bar.innerHTML = '<i></i><u></u><b></b>'
      bar.querySelector<HTMLElement>('i')!.style.width = `${at * 100}%`; bar.querySelector<HTMLElement>('b')!.style.left = `${at * 100}%`
      if (home !== null) bar.querySelector<HTMLElement>('u')!.style.left = `${home * 100}%`
      pane.append(bar)
    }
    const small = document.createElement('small'); small.textContent = limits(def); pane.append(small)
    pane.hidden = false
    const row = this.rows.get(def.id)!.row.getBoundingClientRect()
    const width = Math.min(280, innerWidth - 24)
    pane.style.width = `${width}px`
    const height = pane.getBoundingClientRect().height
    const fitsLeft = row.left > width + 24
    pane.style.left = `${fitsLeft ? row.left - width - 16 : Math.max(12, Math.min(innerWidth - width - 12, row.left))}px`
    pane.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, fitsLeft ? row.top : row.top - height - 12))}px`
  }
  private toggle(card: HTMLElement, open = !card.classList.contains('is-open')): void {
    const id = card.dataset.section!, at = this.openOrder.indexOf(id)
    if (open && at < 0) this.openOrder.push(id)
    if (!open && at >= 0) this.openOrder.splice(at, 1)
    if (!open) card.style.removeProperty('min-height')
    // A tooltip never outlives its row: closing the card that holds it (by hand or to make
    // room for another) takes the tooltip with it.
    if (!open && this.selected && card.querySelector(`.wi-row[data-id="${CSS.escape(this.selected)}"]`)) this.hideTooltip()
    const body = card.querySelector<HTMLElement>('.wi-body')!
    card.classList.toggle('is-open', open); body.hidden = !open; body.inert = !open; card.querySelector('.wi-head')!.setAttribute('aria-expanded', String(open))
    if (open !== (at >= 0)) this.remember()
    this.syncSingle()
  }
  /** A tap on a card's header. */
  private tap(card: HTMLElement): void {
    if (this.single) { if (card.classList.contains('is-open')) this.backToList(card); else this.openPanel(card); return }
    if (!card.classList.contains('is-open') && this.options.oneOpen?.()) { this.openOnly(card); return }
    this.reflow(() => { this.toggle(card); if (card.classList.contains('is-open')) this.fit(card, true) })
  }
  /**
   * Phones: open this card and close the rest in one motion. The tapped header stays under the
   * finger while cards above it fold away (the stack's scroll takes up their height where it
   * can), then eases to where the whole card shows, or to the top of the stack when the card is
   * taller than the stack. The scroll runs beside the cards' own easing, one write per frame,
   * and stops the moment the player touches or scrolls the stack.
   */
  private openOnly(card: HTMLElement): void {
    const stack = this.element.querySelector<HTMLElement>('.wi-cards')!
    this.glideStop?.()
    // The card's own top, not its header's: an open header sticks, and reports where it is stuck.
    const start = card.getBoundingClientRect().top, scrolled = stack.scrollTop
    let height = 0
    this.reflow(() => {
      for (const other of this.element.querySelectorAll<HTMLElement>('.wi-card.is-open')) if (other !== card) this.toggle(other, false)
      this.toggle(card, true)
      height = card.getBoundingClientRect().height
    }, PHONE_MOTION)
    // Closing the others shortened the stack for a moment and the browser clamped its scroll;
    // the cards now start from their old heights, so the old scroll fits again.
    stack.scrollTop = scrolled
    const view = stack.getBoundingClientRect()
    // Where the header should come to rest: where it is if the card then fits below it, else
    // as high as needed for the whole card to show, and never above the top of the stack.
    const end = Math.max(view.top, Math.min(start, view.bottom - height))
    const hold = (y: number) => { const drift = card.getBoundingClientRect().top - y; if (Math.abs(drift) >= 0.5) stack.scrollTop += drift }
    const motion = this.moving.get(card)
    if (!motion) { hold(end); return }
    const stop = new AbortController(); let frame = 0
    this.glideStop = () => { stop.abort(); cancelAnimationFrame(frame); this.glideStop = undefined }
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) stack.addEventListener(type, () => this.glideStop?.(), { signal: stop.signal, passive: true })
    const duration = Number(PHONE_MOTION.duration)
    const step = () => {
      const t = Math.min(1, (Number(motion.currentTime) || 0) / duration)
      hold(start + (end - start) * easeOut(t))
      if (t < 1 && motion.playState === 'running') frame = requestAnimationFrame(step)
      else { hold(end); this.glideStop?.() }
    }
    frame = requestAnimationFrame(step)
  }
  /** Phone panels are on: one card at a time, alone on screen. Not while searching, which opens every card with a match. */
  private get single(): boolean { return !!this.options.phonePanels?.() && !this.element.classList.contains('is-searching') }
  /** The one-panel state is a class on the stack: CSS hides everything but the open card. */
  private syncSingle(): void {
    const on = this.single && !!this.element.querySelector('.wi-cards > .wi-card.is-open')
    if (this.element.classList.contains('is-single') !== on) this.element.classList.toggle('is-single', on)
  }
  /** Close every card at once, no motion (phones, before the list shows again). */
  collapseAll(): void {
    this.glideStop?.(); this.settle(); this.panelMotion?.()
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-cards > .wi-card.is-open')) this.toggle(card, false)
  }
  /** Where the list was scrolled before a panel opened, so going back lands there. */
  private listScroll = 0
  /** Cancels the running phone panel motion, leaving its end state. */
  private panelMotion?: () => void
  private get reduced(): boolean { return matchMedia('(prefers-reduced-motion: reduce)').matches }
  /** Open this card as the only thing on screen, with no motion. */
  private showOnly(card: HTMLElement): void {
    const stack = this.element.querySelector<HTMLElement>('.wi-cards')!
    if (!this.element.classList.contains('is-single')) this.listScroll = stack.scrollTop
    for (const other of this.element.querySelectorAll<HTMLElement>('.wi-cards > .wi-card.is-open')) if (other !== card) this.toggle(other, false)
    this.toggle(card, true); stack.scrollTop = 0
  }
  /**
   * List to one panel. The tapped header lifts from its place in the list to the top while the
   * card opens below it (a clip on the card, not its height, so nothing is laid out per frame);
   * the rest of the list drifts away, above up and below down, as fading copies of the headers.
   */
  private openPanel(card: HTMLElement): void {
    this.panelMotion?.(); this.glideStop?.(); this.settle()
    const animate = this.open && !this.element.hidden && !this.reduced
    const from = card.getBoundingClientRect()
    const ghosts = animate ? this.ghostList(card, from) : null
    this.showOnly(card)
    if (!animate) return
    const to = card.getBoundingClientRect(), r = getComputedStyle(card).borderTopLeftRadius
    const motions: Animation[] = []
    const timing: KeyframeAnimationOptions = { duration: PHONE_PANEL_MS.open, easing: 'cubic-bezier(.2,.8,.2,1)' }
    motions.push(card.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, clipPath: `inset(0 ${Math.max(0, to.width - from.width)}px ${Math.max(0, to.height - from.height)}px 0 round ${r})` },
      { transform: 'none', clipPath: `inset(0 0 0 0 round ${r})` },
    ], timing))
    const body = card.querySelector<HTMLElement>(':scope > .wi-body')
    if (body) motions.push(body.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: PHONE_PANEL_MS.open - 90, delay: 90, easing: 'ease-out', fill: 'backwards' }))
    if (ghosts) motions.push(...ghosts.motions)
    this.track(motions, () => ghosts?.layer.remove())
  }
  /**
   * One panel back to the list, in two short beats: the card folds up to its header where it
   * is, then the header settles into its place in the list while the others drift back in.
   */
  private backToList(card: HTMLElement): void {
    this.panelMotion?.(); this.glideStop?.(); this.settle()
    const stack = this.element.querySelector<HTMLElement>('.wi-cards')!
    const land = () => { this.toggle(card, false); stack.scrollTop = this.listScroll; this.syncSingle() }
    if (!this.open || this.element.hidden || this.reduced) { land(); return }
    const fold = Math.round(PHONE_PANEL_MS.back * 0.45), settle = PHONE_PANEL_MS.back - fold
    const head = card.querySelector<HTMLElement>(':scope > .wi-head')!, r = getComputedStyle(card).borderTopLeftRadius
    // The open card is often far taller than the screen (the stack scrolls): fold from the
    // stack's visible bottom edge, not the card's, or the fold runs off screen unseen.
    const box = card.getBoundingClientRect(), headBottom = head.getBoundingClientRect().bottom - box.top
    const below = Math.max(0, box.bottom - stack.getBoundingClientRect().bottom)
    const first = card.animate([{ clipPath: `inset(0 0 ${below}px 0 round ${r})` }, { clipPath: `inset(0 0 ${Math.max(below, box.height - headBottom)}px 0 round ${r})` }], { duration: fold, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' })
    // A scripted clip starts without a layout change or CSS transition event.
    // Let an owned surface sample the very first fold on its next draw.
    if (card.dataset.glassSurface === 'shader') card.dispatchEvent(new Event('glassgeometrychange', { bubbles: true }))
    let second: Animation[] = []
    let done = false
    const finish = () => { if (done) return; done = true; first.cancel(); for (const m of second) m.cancel(); if (card.classList.contains('is-open')) land(); this.panelMotion = undefined }
    this.panelMotion = finish
    first.onfinish = () => {
      if (done) return
      const top = box.top
      first.cancel(); land()
      const now = card.getBoundingClientRect()
      second = [card.animate([{ transform: `translateY(${top - now.top}px)` }, { transform: 'none' }], { duration: settle, easing: 'cubic-bezier(.2,.8,.2,1)' })]
      const rest = [...this.element.querySelectorAll<HTMLElement>('.rail-command, .rail-foot, .wi-cards > :not([hidden])')].filter(el => el !== card)
      for (const el of rest) {
        const above = el.getBoundingClientRect().top < now.top
        second.push(el.animate([{ opacity: 0, transform: `translateY(${above ? -12 : 12}px)` }, { opacity: 1, transform: 'none' }], { duration: Math.min(settle, PHONE_PANEL_MS.ghost), easing: 'ease-out' }))
      }
      void Promise.all(second.map(m => m.finished.catch(() => undefined))).then(() => { if (this.panelMotion === finish) this.panelMotion = undefined; done = true })
    }
  }
  /**
   * Fading copies of what leaves when a panel opens: the other cards' headers and the rail
   * above and below them, placed where they were and drifting apart. Headers only, never a
   * card's body: a copied form control could take part in the real one's group.
   */
  private ghostList(card: HTMLElement, from: DOMRect): { layer: HTMLElement; motions: Animation[] } {
    const host = this.element.getBoundingClientRect()
    const layer = document.createElement('div'); layer.className = 'wi-ghosts'; layer.setAttribute('aria-hidden', 'true'); layer.inert = true
    const motions: Animation[] = []
    const leaving = [...this.element.querySelectorAll<HTMLElement>('.rail-command, .rail-foot, .wi-cards > :not([hidden])')].filter(el => el !== card)
    for (const el of leaving) {
      const box = el.getBoundingClientRect()
      if (!box.height || box.bottom < host.top || box.top > host.bottom) continue
      const ghost = el.cloneNode(false) as HTMLElement
      ghost.removeAttribute('data-section'); ghost.classList.remove('wi-card', 'is-open'); ghost.classList.add('wi-ghost')
      const head = el.matches('.wi-card') ? el.querySelector(':scope > .wi-head') : null
      if (head) ghost.append(head.cloneNode(true))
      else if (!el.matches('.wi-card')) for (const child of el.children) if (!child.matches('input, textarea, select')) ghost.append(child.cloneNode(true))
      Object.assign(ghost.style, { position: 'absolute', margin: '0', left: `${box.left - host.left}px`, top: `${box.top - host.top}px`, width: `${box.width}px`, height: `${box.height}px` })
      layer.append(ghost)
      const above = box.top < from.top
      // Gone quickly, out of the opening panel's way: its glass is translucent, and headers
      // still showing through it read as clutter (seen in the strips, 19 November 2026).
      motions.push(ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${above ? -12 : 12}px)` }], { duration: PHONE_PANEL_MS.ghostOut, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }))
    }
    this.element.append(layer)
    return { layer, motions }
  }
  /** Keep a phone panel motion cancellable; `after` runs once when it ends either way. */
  private track(motions: Animation[], after: () => void): void {
    let done = false
    const finish = () => { if (done) return; done = true; for (const m of motions) m.cancel(); after(); if (this.panelMotion === finish) this.panelMotion = undefined }
    this.panelMotion = finish
    void Promise.all(motions.map(m => m.finished.catch(() => undefined))).then(finish)
  }
  /** The list arrives a beat behind the stack itself: a short stagger, capped. The glass's own sheen is the only light. */
  private arrive(): void {
    const items = [...this.element.querySelectorAll<HTMLElement>('.rail-command, .wi-cards > :not([hidden]), .rail-foot, .panels-close')].filter(el => el.getClientRects().length)
    items.slice(0, PHONE_PANEL_MS.staggerCap + 2).forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: PHONE_PANEL_MS.show - 60, delay: Math.min(i, PHONE_PANEL_MS.staggerCap) * PHONE_PANEL_MS.stagger, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' })
    })
  }
  /**
   * Open or close cards, easing every card's height from where it was to where it lands
   * (FLIP on height). The browser runs the animation; no script runs per frame. A closing
   * body stays drawn, inert and clipped, until its card has shrunk to the header.
   */
  private reflow(change: () => void, timing = CARD_MOTION): void {
    const cards = [...this.element.querySelectorAll<HTMLElement>('.wi-card')]
    const from = cards.map(card => card.getBoundingClientRect().height)
    this.settle(); change()
    const to = cards.map(card => card.getBoundingClientRect().height)
    // Asked fresh each toggle: a cached MediaQueryList can lag behind a changed preference in WebKit.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !this.open || cards.every((card, i) => Math.abs(from[i] - to[i]) < 0.5)) return
    cards.forEach((card, i) => {
      // Every visible card is pinned along its own path, changed or not, so the stack's total
      // holds steady and no flexible card is squeezed while its neighbours move.
      if (!from[i] || !to[i]) return
      const body = card.querySelector<HTMLElement>('.wi-body')!
      body.hidden = false; card.classList.add('is-moving')
      const frame = (height: number): Keyframe => ({ flexGrow: 0, flexShrink: 0, flexBasis: `${height}px`, minHeight: '0px' })
      const motion = card.animate([frame(from[i]), frame(to[i])], timing)
      motion.onfinish = () => { if (this.moving.get(card) === motion) this.land(card) }
      this.moving.set(card, motion)
    })
  }
  private queueFit(keep: HTMLElement | null): void {
    if (this.fitQueued) return
    this.fitQueued = true
    requestAnimationFrame(() => { this.fitQueued = false; if (this.moving.size) { this.queueFit(keep); return } this.reflow(() => this.fit(keep)) })
  }
  /** A card the player is using: focus inside it, a pointer held in it, or a number being typed. */
  private busy(card: HTMLElement): boolean {
    return card === this.pressed || card.contains(document.activeElement) && document.activeElement !== card.querySelector('.wi-head') || !!this.editing && card.contains(this.editing.field)
  }
  /**
   * Close the cards open longest until every open card has a comfortable height (cardFit.ts),
   * and hold each open card at that height so the stack never squeezes one into a sliver.
   * `keep` is the card just opened, or the one whose content grew; `reveal` scrolls it into
   * view when the motion lands. Not while searching, which
   * opens every card with a match, nor while hidden, when nothing can be measured.
   */
  private fit(keep: HTMLElement | null, reveal = false): void {
    const stack = this.element.querySelector<HTMLElement>('.wi-cards')!
    // With one card open at a time the stack simply scrolls: nothing to close or hold. Closing
    // here also closed the card a player had open whenever the panel came back on a phone.
    if (this.options.oneOpen?.()) return
    if (!this.shown || this.element.classList.contains('is-searching') || !stack.clientHeight) return
    const cards = [...stack.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.hidden && el.getClientRects().length > 0)
    const measured = new Map<HTMLElement, FitCard>()
    for (const card of cards) {
      const height = card.getBoundingClientRect().height
      if (!card.classList.contains('wi-card')) { measured.set(card, { id: card.dataset.section ?? '', open: false, closed: height, natural: height, closable: false }); continue }
      const head = card.querySelector<HTMLElement>(':scope > .wi-head'), body = card.querySelector<HTMLElement>(':scope > .wi-body')!
      const frame = card.offsetHeight - card.clientHeight, closed = (head?.offsetHeight ?? 44) + frame
      const open = card.classList.contains('is-open')
      const natural = open ? height - body.clientHeight + body.scrollHeight : closed
      measured.set(card, { id: card.dataset.section!, open, closed, natural, closable: !this.busy(card) })
    }
    const gap = parseFloat(getComputedStyle(stack).rowGap) || 0
    const order = this.openOrder.filter(id => cards.some(card => card.dataset.section === id))
    const close = new Set(cardsToClose([...measured.values()], order, stack.clientHeight, gap, keep?.dataset.section ?? null))
    for (const [card, fit] of measured) {
      if (!card.classList.contains('wi-card')) continue
      if (close.has(fit.id)) this.toggle(card, false)
      else if (fit.open) card.style.minHeight = `${Math.round(comfortable(fit))}px`
    }
    // Only a card the player has just opened is scrolled to; a fold opening inside a card
    // leaves the stack where the player put it.
    if (reveal && keep?.classList.contains('is-open') && keep.isConnected) this.revealAfterMotion(keep)
  }
  /**
   * Once the cards have landed, bring the opened card into view: all of it when it fits,
   * otherwise its header at the top of the stack.
   */
  private revealAfterMotion(card: HTMLElement): void {
    const stack = this.element.querySelector<HTMLElement>('.wi-cards')!
    // The player scrolling or touching the stack meanwhile wins: no yank back afterwards.
    let moved = false
    const stop = new AbortController(), mark = () => { moved = true }
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) stack.addEventListener(type, mark, { signal: stop.signal, passive: true })
    let before = stack.scrollTop
    requestAnimationFrame(() => {
      before = stack.scrollTop
      void Promise.all([...this.moving.values()].map(motion => motion.finished.catch(() => undefined))).then(() => {
        stop.abort()
        // Any other scroll is the player's, except the browser clamping it as cards above close.
        const delta = stack.scrollTop - before, clamped = delta < 0 && stack.scrollTop >= stack.scrollHeight - stack.clientHeight - 1
        if (moved || Math.abs(delta) > 2 && !clamped) return
        if (!card.isConnected || !card.classList.contains('is-open')) return
        const fits = card.getBoundingClientRect().height <= stack.clientHeight
        const target = fits ? card : card.querySelector<HTMLElement>(':scope > .wi-head') ?? card
        const box = target.getBoundingClientRect(), view = stack.getBoundingClientRect()
        if (box.top < view.top) stack.scrollTop -= view.top - box.top
        else if (fits && box.bottom > view.bottom) stack.scrollTop += box.bottom - view.bottom
        else if (!fits && box.top > view.top) stack.scrollTop += box.top - view.top
      })
    })
  }
  /** Stop every card animation now and leave each card in its resting state. */
  private settle(): void {
    for (const [card, motion] of this.moving) { motion.cancel(); this.land(card) }
  }
  private land(card: HTMLElement): void {
    this.moving.delete(card); card.classList.remove('is-moving')
    card.querySelector<HTMLElement>('.wi-body')!.hidden = !card.classList.contains('is-open')
  }
  private search(query: string): void {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    // A search opens whatever holds a match. Remember how things were, and put them back after.
    const cards = [...this.element.querySelectorAll<HTMLElement>('.wi-card')], folds = [...this.element.querySelectorAll<HTMLDetailsElement>('.wi-group')]
    if (words.length && !this.beforeSearch) this.beforeSearch = { cards: cards.map(card => card.classList.contains('is-open')), folds: folds.map(fold => fold.open) }
    this.element.classList.toggle('is-searching', words.length > 0)
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-card')) {
      const headingHit = words.length > 0 && words.every(word => (card.querySelector('h3')?.textContent ?? '').toLowerCase().includes(word))
      let cardHits = headingHit ? 1 : 0
      for (const control of card.querySelectorAll<HTMLElement>('[data-search]')) {
        const hit = headingHit || words.every(word => `${control.dataset.search} ${control.textContent}`.toLowerCase().includes(word))
        control.hidden = words.length > 0 && !hit
        if (hit) cardHits++
      }
      for (const fold of card.querySelectorAll<HTMLDetailsElement>('.wi-group')) {
        let hits = 0
        for (const row of fold.querySelectorAll<HTMLElement>('.wi-row')) {
          const def = this.rows.get(row.dataset.id!)!.def, hay = `${def.label} ${def.group} ${def.id} ${describe(def)}`.toLowerCase()
          const hit = headingHit || words.every(word => hay.includes(word)); row.hidden = words.length > 0 && !hit; if (hit) hits++
        }
        fold.hidden = words.length > 0 && hits === 0; if (words.length) fold.open = hits > 0
        cardHits += hits
      }
      card.hidden = words.length > 0 && cardHits === 0
      if (words.length) this.toggle(card, cardHits > 0)
    }
    if (!words.length && this.beforeSearch) {
      const before = this.beforeSearch; this.beforeSearch = undefined
      cards.forEach((card, i) => this.toggle(card, before.cards[i] ?? false)); folds.forEach((fold, i) => { fold.open = before.folds[i] ?? false })
    }
    this.say(words.length ? `${[...this.rows.values()].filter(r => !r.row.hidden).length} found` : '')
    this.syncSingle()
  }
  /** Feedback stays visible while the inspector suppresses transient game toasts. */
  setStatus(message: string): void { this.element.querySelector('.wi-status')!.textContent = message }
  private say(text: string): void { this.setStatus(text) }
  private async click(event: Event): Promise<void> {
    const target = event.target as Element, vehicle = target.closest<HTMLElement>('[data-vehicle]')
    if (vehicle) { this.options.onVehicle(vehicle.dataset.vehicle!); return }
    const button = target.closest<HTMLElement>('[data-wi]'); if (!button) return
    const card = button.closest<HTMLElement>('.wi-card'), section = card ? this.tree.find(s => s.id === card.dataset.section) : undefined
    const valueOf = (id: string) => params.get(id)?.value
    switch (button.dataset.wi) {
      case 'toggle': if (card) this.tap(card); break
      case 'show-gi': this.showGI(); break
      case 'save-world': this.options.onSaveWorld?.(); break
      case 'copy-world': await this.copy(JSON.stringify(exportWorld(params.all().map(p => p.def as PropertyDef), valueOf), null, 2), 'This world'); break
      case 'copy-section': if (section) await this.copy(JSON.stringify(exportSection(section, valueOf), null, 2), section.title); break
      case 'paste-world': await this.sheet('Paste a world', null); break
      case 'paste-section': if (section) await this.sheet(`Paste into ${section.title}`, section.id); break
      case 'apply': this.apply(this.element.querySelector<HTMLTextAreaElement>('.wi-sheet textarea')!.value); break
      case 'close': this.element.querySelector<HTMLElement>('.wi-sheet')!.hidden = true; break
      case 'reset': {
        // Two presses: the first asks, the second (within four seconds) does it.
        if (!canEditWorld()) { this.say('The host has locked this world.'); break }
        // The label is the button's text span when it has a glyph beside it.
        const label = button.querySelector('span') ?? button
        if (!this.armed) { label.textContent = 'Confirm'; button.classList.add('is-warning'); this.armed = setTimeout(() => { this.armed = undefined; label.textContent = 'Reset'; button.classList.remove('is-warning') }, 4000); break }
        clearTimeout(this.armed); this.armed = undefined; label.textContent = 'Reset'; button.classList.remove('is-warning')
        this.say(resetWorld() ? 'World reset to its defaults.' : 'The host has locked this world.'); break
      }
    }
  }
  private async copy(json: string, what: string): Promise<void> {
    try { await navigator.clipboard.writeText(json); this.say(`${what} copied as JSON.`) }
    catch {
      // No clipboard access: show it, selected, to copy by hand.
      const sheet = this.element.querySelector<HTMLElement>('.wi-sheet')!, area = sheet.querySelector('textarea')!
      sheet.querySelector('strong')!.textContent = `${what} as JSON`; area.value = json; sheet.hidden = false; sheet.classList.add('is-copy'); area.focus(); area.select()
    }
  }
  private async sheet(title: string, sectionId: string | null): Promise<void> {
    const sheet = this.element.querySelector<HTMLElement>('.wi-sheet')!, area = sheet.querySelector('textarea')!
    this.pasteTarget = sectionId; sheet.querySelector('strong')!.textContent = title; sheet.classList.remove('is-copy'); area.value = ''
    // Fill it from the clipboard when the browser allows; otherwise the player pastes by hand.
    try { const text = await navigator.clipboard.readText(); if (text.trim().startsWith('{')) area.value = text } catch { /* Paste by hand. */ }
    sheet.hidden = false; area.focus()
  }
  /** Check pasted JSON and apply what is allowed. Returns the line shown to the player. */
  apply(text: string): string {
    const defs = params.all().map(p => p.def as PropertyDef)
    const result = parseWorld(text, defs, { personal: this.pasteTarget === 'you' })
    if (!result.ok) { this.say(result.why); return result.why }
    const world = result.entries.filter(entry => params.get(entry.id)?.def.scope === 'world')
    if (world.length && !canEditWorld()) { const why = 'The host has locked this world, so nothing was pasted.'; this.say(why); return why }
    params.applySnapshot(Object.fromEntries(result.entries.map(entry => [entry.id, entry.value])), 'local')
    this.element.querySelector<HTMLElement>('.wi-sheet')!.hidden = true
    const line = pasteSummary(result); this.say(line); return line
  }
  dispose(): void { this.glideStop?.(); this.visibilityMotion?.cancel(); this.settle(); this.unsubscribe(); this.abort.abort(); clearTimeout(this.armed); clearTimeout(this.tooltipTimer); this.tooltip.remove(); this.element.remove() }
}
