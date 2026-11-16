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
import { canEditWorld, resetWorld } from '../worldPermissions'
import { buildTree, describe, exportSection, exportWorld, fraction, limits, parseWorld, pasteSummary, show, type PropertyDef, type SectionNode } from './model'
import './params'
import './inspector.css'
import './motion.css'

export interface InspectorOptions {
  /** One line for a closed card, for example "Alpine · Harimos". Empty hides it. */
  summary(sectionId: string): string
  /** The vehicles on offer and which is in use, for the switcher in the Me card. */
  vehicles(): { options: readonly { id: string; label: string }[]; current: string }
  onVehicle(id: string): void
  /** Current session identity; renaming remains owned by the session. */
  playerName?(): string
  /** The player's vehicle colours as #rrggbb. With onColor, two swatches sit beside the vehicle selector. */
  colors?(): { body: string; accent: string }
  /** Called on every movement in the colour picker, so the vehicle can repaint as it is dragged. */
  onColor?(key: 'body' | 'accent', value: string): void
  /** Capture a local bookmark. The caller owns storage and success or failure feedback. */
  onSaveWorld?(): void
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

/** How long a card takes to make room for another, and the curve it eases along. */
const CARD_MOTION: KeyframeAnimationOptions = { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }

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
  private sessionCard?: HTMLDetailsElement
  private shown = true
  private visibilityMotion?: Animation
  private visibilityInitialized = false
  private editable = true
  private armed?: ReturnType<typeof setTimeout>
  private pasteTarget: string | null = null
  private beforeSearch?: { cards: boolean[]; folds: boolean[] }
  /** The number being typed into, if any, and how to finish it. */
  private editing: { field: HTMLInputElement; finish(commit: boolean, refocus: boolean): void } | null = null
  /** Card height animations in flight. A new toggle starts from wherever these have got to. */
  private readonly moving = new Map<HTMLElement, Animation>()

  constructor(parent: HTMLElement, private readonly options: InspectorOptions) {
    this.element.className = 'world-inspector'; this.element.setAttribute('aria-label', 'World inspector')
    this.element.innerHTML = `<div class="wi-top wi-glass"><input class="wi-search" type="search" placeholder="Search" aria-label="Find a setting" autocomplete="off" spellcheck="false">
      <div class="wi-actions"><button type="button" data-wi="copy-world">Copy world</button><button type="button" data-wi="paste-world">Paste world</button><button type="button" data-wi="reset">Reset</button></div></div>
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
    this.vehicleControl.dataset.search = "vehicle colour color body accent buggy jet hovercraft tank"
    this.build()
    this.unsubscribe = params.onChange((id, value) => this.rows.get(id)?.sync(value))
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
    if (!animate) { this.element.hidden = !value; return }
    const frames = [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'translateX(0)' }]
    const motion = this.element.animate(value ? frames : [...frames].reverse(), { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
    this.visibilityMotion = motion
    motion.onfinish = () => {
      if (this.visibilityMotion !== motion) return
      this.element.hidden = !this.shown
      this.visibilityMotion = undefined
    }
  }
  /** Keep the session controls and their listeners intact through registry rebuilds. */
  setSessionCard(card: HTMLDetailsElement): void {
    this.sessionCard = card
    card.dataset.section = 'players'
    this.placeSessionCard()
  }
  private placeSessionCard(): void {
    if (!this.sessionCard) return
    const cards = this.element.querySelector('.wi-cards')!
    const game = cards.querySelector('[data-section="game"]')
    if (game) game.after(this.sessionCard); else cards.prepend(this.sessionCard)
  }

  /** Rebuild if properties have been defined since the last look; refresh summaries and locks. */
  update(): void {
    if (params.all().length !== this.known) this.build()
    const editable = canEditWorld()
    if (editable !== this.editable) { this.editable = editable; for (const { row, def } of this.rows.values()) if (def.scope === 'world') for (const control of row.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = !editable; this.element.classList.toggle('is-locked', !editable) }
    for (const card of this.element.querySelectorAll<HTMLElement>('.wi-card')) {
      const id = card.dataset.section!, extra = this.extras.get(id), sum = card.querySelector('.wi-sum')!
      const text = extra ? extra.summary() : this.options.summary(id) || `${this.tree.find(s => s.id === id)?.count ?? 0} properties`
      if (sum.textContent !== text) sum.textContent = text
    }
    const vehicles = this.options.vehicles()
    const select = this.element.querySelector<HTMLSelectElement>('.wi-vehicle-select')!
    if (document.activeElement !== select) select.value = vehicles.current
    const name = this.element.querySelector('.wi-person-name output')
    if (name && name.textContent !== this.options.playerName?.()) name.textContent = this.options.playerName?.() ?? ''
    const colors = this.options.colors?.()
    if (colors) for (const dot of this.element.querySelectorAll<HTMLElement>('[data-colour]')) dot.style.backgroundColor = colors[dot.dataset.colour as 'body' | 'accent']
    if (colors) for (const input of this.tintInputs) { const value = colors[input.dataset.tint as 'body' | 'accent']; if (input.value !== value && document.activeElement !== input) input.value = value }
  }
  private build(): void {
    const all = params.all(); this.known = all.length
    const open = new Set([...this.element.querySelectorAll<HTMLElement>('.wi-card.is-open')].map(card => card.dataset.section))
    const owned = new Set([...this.extras.values()].flatMap(extra => extra.owns?.() ?? []))
    this.tree = buildTree(all.map(p => p.def as PropertyDef).filter(def => !owned.has(def.id)))
    this.rows.clear(); this.editing = null; this.settle()
    const cards = this.element.querySelector('.wi-cards')!; cards.replaceChildren()
    for (const section of this.tree) {
      const card = document.createElement('section'); card.className = 'wi-card wi-glass'; card.dataset.section = section.id
      const head = document.createElement('button'); head.type = 'button'; head.className = 'wi-head'; head.dataset.wi = 'toggle'; head.setAttribute('aria-expanded', 'false')
      head.innerHTML = '<h3></h3><span class="wi-sum"></span><span class="wi-chev" aria-hidden="true"></span>'; head.querySelector('h3')!.textContent = section.title
      const body = document.createElement('div'); body.className = 'wi-body'; body.hidden = true
      if (section.id === 'you') {
        body.append(this.vehicleControl)
        const identity = document.createElement('p'); identity.className = 'wi-person-name'; identity.dataset.search = 'player name identity'
        const caption = document.createElement('span'); caption.textContent = 'Player name'
        const name = document.createElement('output'); identity.append(caption, name); body.append(identity)
        const dots = document.createElement('span'); dots.className = 'wi-colour-dots'; dots.setAttribute('aria-label', 'Vehicle colours')
        dots.innerHTML = '<i data-colour="body"></i><i data-colour="accent"></i>'; head.querySelector('.wi-sum')!.after(dots)
      }
      const blurb = document.createElement('p'); blurb.className = 'wi-blurb'; blurb.textContent = section.blurb; body.append(blurb)

      section.tree.forEach((group, index) => {
        const fold = document.createElement('details'); fold.className = 'wi-group'; fold.dataset.group = group.name; fold.open = index === 0 && !['Tag', 'Tag beams', 'Zorb', 'Sun', 'Sky', 'Weather'].includes(group.name)
        const summary = document.createElement('summary'); summary.innerHTML = '<span></span><small></small>'
        summary.querySelector('span')!.textContent = group.name; summary.querySelector('small')!.textContent = String(group.properties.length)
        fold.append(summary); for (const def of group.properties) fold.append(this.row(def)); body.append(fold)
      })
      const foot = document.createElement('div'); foot.className = 'wi-actions wi-foot'
      foot.innerHTML = '<button type="button" data-wi="copy-section">Copy JSON</button><button type="button" data-wi="paste-section">Paste</button>'
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
    this.placeSessionCard()
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
    head.innerHTML = '<h3></h3><span class="wi-sum"></span><span class="wi-chev" aria-hidden="true"></span>'; head.querySelector('h3')!.textContent = title
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
    if (card && !card.classList.contains('is-open')) this.reflow(() => this.toggle(card, true))
  }
  private vehicleSwitch(): HTMLElement {
    const label = document.createElement('label'); label.textContent = 'Vehicle'
    const select = document.createElement('select'); select.className = 'wi-vehicle-select'; select.setAttribute('aria-label', 'Vehicle')
    for (const option of this.options.vehicles().options) { const item = document.createElement('option'); item.value = option.id; item.textContent = option.label; select.append(item) }
    select.addEventListener('change', () => this.options.onVehicle(select.value), { signal: this.abort.signal })
    label.append(select)
    if (!this.options.colors || !this.options.onColor) return label
    // Vehicle colours live beside the vehicle choice. Each swatch opens the platform's own
    // colour picker; the vehicle repaints while it is dragged, with no reload.
    const wrap = document.createElement('div'); wrap.className = 'wi-vehicle'
    const tint = document.createElement('span'); tint.className = 'wi-tint'; tint.setAttribute('role', 'group'); tint.setAttribute('aria-label', 'Vehicle colours')
    for (const [key, name] of [['body', 'Body colour'], ['accent', 'Accent colour']] as const) {
      const swatch = document.createElement('label'); swatch.className = 'wi-swatch'; swatch.title = name
      const input = document.createElement('input'); input.type = 'color'; input.dataset.tint = key; input.setAttribute('aria-label', name)
      input.addEventListener('input', () => this.options.onColor!(key, input.value), { signal: this.abort.signal })
      swatch.append(input); tint.append(swatch); this.tintInputs.push(input)
    }
    wrap.append(label, tint); return wrap
  }
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
  /** One property row: slider, toggle, choice or number, kept in sync with the registry. */
  row(def: PropertyDef): HTMLElement {
    if (def.id === 'post.gi') def = { ...def, label: 'Global illumination (GI)' }
    if (def.id === 'post.giRadius') def = { ...def, label: 'GI light reach (m)' }
    const row = document.createElement('div'); row.className = 'wi-row'; row.dataset.id = def.id
    const label = document.createElement('span'); label.className = 'wi-label'
    const output = document.createElement('output')
    const param = params.get(def.id)!, choices = choicesOf(def)
    let sync: (value: ParamValue) => void
    if (choices) {
      label.textContent = choices.name
      const seg = document.createElement('div'); seg.className = 'wi-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', choices.name)
      for (const option of choices.options) { const button = document.createElement('button'); button.type = 'button'; button.dataset.value = String(option.value); button.textContent = option.label; button.addEventListener('click', () => params.set(def.id, option.value, 'local')); seg.append(button) }
      row.classList.add('is-choice'); row.append(label, seg)
      sync = value => { for (const button of seg.querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-on', Number(button.dataset.value) === Math.round(Number(value))) }
    } else if (typeof def.default === 'boolean') {
      label.textContent = def.label
      const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('aria-label', def.label)
      box.addEventListener('change', () => params.set(def.id, box.checked, 'local'))
      // The box stays small; the label around it is the 44 px target a thumb can hit.
      const hit = document.createElement('label'); hit.className = 'wi-hit'; hit.append(box)
      row.append(label, hit, output)
      sync = value => { box.checked = Boolean(value); output.textContent = show(Boolean(value)) }
    } else {
      label.textContent = def.label
      const ranged = def.min !== undefined && def.max !== undefined
      const input = document.createElement('input'); input.type = ranged ? 'range' : 'number'; input.setAttribute('aria-label', def.label)
      if (ranged) { input.min = String(Math.min(def.min!, def.max!)); input.max = String(Math.max(def.min!, def.max!)) }
      input.step = String(def.step ?? 'any')
      // The number beside the slider is a button: press it and it becomes a field to type into.
      const number = document.createElement('button'); number.type = 'button'; number.className = 'wi-num'
      const display = (text: string) => { number.textContent = text; number.setAttribute('aria-label', `${def.label}: ${text}, edit`) }
      number.addEventListener('click', () => this.edit(def, number))
      number.addEventListener('keydown', event => { if (event.key === 'F2') { event.preventDefault(); this.edit(def, number) } })
      // A property marked deferred (the terrain rebuilds) applies when the slider is let go.
      input.addEventListener(def.deferred ? 'change' : 'input', () => params.set(def.id, Number(input.value), 'local'))
      if (def.deferred) input.addEventListener('input', () => display(show(Number(input.value), def)))
      row.append(label, input, number)
      sync = value => { if (document.activeElement !== input) input.value = String(value); display(show(value, def)) }
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
    const before = number.textContent ?? ''
    field.value = before
    let done = false, flash: ReturnType<typeof setTimeout> | undefined
    const mark = (element: HTMLElement) => { element.classList.remove('is-invalid'); void element.offsetWidth; element.classList.add('is-invalid'); clearTimeout(flash); flash = setTimeout(() => element.classList.remove('is-invalid'), 700) }
    const finish = (commit: boolean, refocus: boolean) => {
      if (done) return
      if (commit) {
        const value = parseEdit(field.value, def)
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
    const body = card.querySelector<HTMLElement>('.wi-body')!
    card.classList.toggle('is-open', open); body.hidden = !open; body.inert = !open; card.querySelector('.wi-head')!.setAttribute('aria-expanded', String(open))
  }
  /**
   * Open or close cards, easing every card's height from where it was to where it lands
   * (FLIP on height). The browser runs the animation; no script runs per frame. A closing
   * body stays drawn, inert and clipped, until its card has shrunk to the header.
   */
  private reflow(change: () => void): void {
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
      const motion = card.animate([frame(from[i]), frame(to[i])], CARD_MOTION)
      motion.onfinish = () => { if (this.moving.get(card) === motion) this.land(card) }
      this.moving.set(card, motion)
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
    if (this.sessionCard) this.sessionCard.hidden = words.length > 0 && !words.every(word => this.sessionCard!.textContent!.toLowerCase().includes(word))
    if (!words.length && this.beforeSearch) {
      const before = this.beforeSearch; this.beforeSearch = undefined
      cards.forEach((card, i) => this.toggle(card, before.cards[i] ?? false)); folds.forEach((fold, i) => { fold.open = before.folds[i] ?? false })
    }
    this.say(words.length ? `${[...this.rows.values()].filter(r => !r.row.hidden).length} found` : '')
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
      case 'toggle': if (card) this.reflow(() => this.toggle(card)); break
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
        if (!this.armed) { button.textContent = 'Press again to reset'; button.classList.add('is-warning'); this.armed = setTimeout(() => { this.armed = undefined; button.textContent = 'Reset'; button.classList.remove('is-warning') }, 4000); break }
        clearTimeout(this.armed); this.armed = undefined; button.textContent = 'Reset'; button.classList.remove('is-warning')
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
  dispose(): void { this.visibilityMotion?.cancel(); this.settle(); this.unsubscribe(); this.abort.abort(); clearTimeout(this.armed); clearTimeout(this.tooltipTimer); this.tooltip.remove(); this.element.remove() }
}
