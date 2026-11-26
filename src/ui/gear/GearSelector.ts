/**
 * The gear selector: a vertical drum floating near the centre-left edge that shows the gear in
 * hand in its middle, its neighbours above and below fading out through a mask, and beside
 * it the controls that apply right now.
 *
 * It reads a gear rack through a small duck-typed source (the rack on window.miraNet.gear
 * fits it) and, when the rack offers controls(), the gear's state, status and actions. It
 * never handles gameplay keys itself: keyboard, mouse, wheel and gamepad for gear actions
 * belong to the gear lane. Here we only draw hints and, on touch, give the extra actions
 * (every action after the primary one, which the TAG button already covers) buttons that
 * call start() and stop().
 *
 * update() runs every frame and is written to touch the DOM only when something changed:
 * the list, the current id, the controls() object or the focus mode. Wiring notes are in
 * README.md beside this file.
 */
import './gear.css'
import { isKey, keycap, shortcut } from '../keycap'

export interface GearAction {
  readonly id: string
  readonly label: string
  /** Display strings, such as "Click", "Hold click", "V", "Wheel down". */
  readonly keys: readonly string[]
  /** Held actions run from start() until stop(); others are a single start(). */
  readonly hold: boolean
  start(): void
  stop?(): void
}

export interface GearControls {
  readonly gear: string
  readonly name: string
  readonly description: string
  readonly state: string
  readonly status?: string
  /** 0 to 1, drawn as a thin bar when present. */
  readonly level?: number
  readonly actions: readonly GearAction[]
}

export interface GearSource {
  list(): readonly string[]
  readonly current: string
  select(id: string): void
  next?(): void
  labelOf?(id: string): string
  /** Must return the same object until gear, state, status or actions change. */
  controls?(): GearControls
}

export interface GearSelectorOptions {
  /** Touch layout: larger targets, no key hints, buttons for the extra actions. */
  touch?: boolean
  /** Called after the player picks gear here, for a click sound or similar. */
  onSelect?: (id: string) => void
}

// ---------------------------------------------------------------------------------------
// Pure helpers, exported for tests.

/** Signed slot of item `index` relative to `current` on a ring of `count`, nearest way round. */
export function ringOffset(index: number, current: number, count: number): number {
  if (count <= 0) return 0
  const d = (((index - current) % count) + count) % count
  return d > count / 2 ? d - count : d
}

/** The ink of the selected gear's neighbours, a share of full white. */
const NEIGHBOUR_INK = 0.8
/** How long the meter takes to fade in and out on a change of gear (gear.css, .gs-meter). */
const METER_FADE_MS = 220
/**
 * How long the names take to slide when the number keys before them come and go (the cursor
 * captured or freed), decelerating. A deliberate exception to the interface's rule that
 * nothing slides (the owner, 25 November 2026: "slide the weapon names left and right"),
 * limited to these names. Reduced motion: no slide.
 */
const NAME_SLIDE_MS = 180
/** The space after the selected name before what it holds, with the cursor captured: a word's gap. */
const HELD_GAP = 15
const NAME_SLIDE_EASE = 'cubic-bezier(.16,1,.3,1)'

/** How a slot looks by its distance from the centre. Its position is CSS: offset times pitch. */
export function slotPose(offset: number): { scale: number; opacity: number } {
  const a = Math.abs(offset)
  if (a >= 3) return { scale: 0.6, opacity: 0 }
  return { scale: [1, 0.76, 0.64][a], opacity: [1, 0.66, 0.32][a] }
}

/**
 * The way to let go of what the gear holds, for the meter beside its status (the owner, 25
 * November 2026: "When the grapple is active, you need to show the G or double-tap to let go
 * message even when cursor input is locked"). Only while the gear holds something, which is
 * when it has a status: a Grapple cord attached ("Cord 13 m"), a Yoink holding a vehicle. The
 * key comes from the action itself (Gear.ts), never written here: a keyboard key as a keycap and
 * the action, or on touch its gesture ("double-tap to let go"). An action let go of with the
 * mouse button (Yoink's fling) reads "let go to fling".
 */
export function releaseHint(own: GearControls | undefined, touch: boolean): { key?: string; alt?: string; text: string } | null {
  if (!own?.status) return null
  const action = own.actions.find(a => a.id === 'release' || a.id === 'fling')
  if (!action) return null
  const label = action.label.toLowerCase()
  if (touch) {
    // Touch: a thumb button that lets go (TouchControls, touchActions) says it already. Yoink's
    // fling is the TAG thumb itself letting go, which the thumb is doing: nothing to add.
    if (action.id !== 'release' || touchActions(own).includes(action)) return null
    const gesture = action.keys.find(k => /\btap\b/i.test(k))
    return { text: gesture ? `${gesture.toLowerCase().replace(/\s+/g, '-')} to ${label}` : label }
  }
  // A keyboard: the key as a cap, then any other real input in words. A double tap of the tag
  // control is a double-click (or a double press of L) here.
  const key = action.keys.find(k => !k.includes(' ') && isKey(k))
  // The second input is `alt`, dropped where the line would run too far (placeHeld).
  const other = action.keys.find(k => /\btap\b/i.test(k)) ? 'double-click' : undefined
  if (key) return other ? { key, alt: `or ${other} to`, text: label } : { key, text: label }
  return { text: label === 'let go' ? label : `let go to ${label}` }
}

/** A live level, quantised so a slowly creeping value does not write the DOM every frame. */
export function levelStep(level: number | undefined): number {
  if (level === undefined || level !== level) return -1
  return Math.round(Math.max(0, Math.min(1, level)) * 200) / 200
}

/**
 * Where an item should start before it eases to `to`. Items that cross the back of the ring
 * enter from beyond the visible edge instead of sweeping across the whole drum.
 */
export function entryOffset(from: number, to: number, shift: number, count: number): number | null {
  if (Math.abs(to - from) <= count / 2) return null
  return to - shift
}

export interface Hint { readonly id: string; readonly label: string; readonly keys: readonly string[]; readonly hold: boolean }

/** The hint lines for the current state: every action with its keys. */
export function hintModel(controls: GearControls | undefined): Hint[] {
  if (!controls) return []
  return controls.actions.map(a => ({ id: a.id, label: a.label, keys: a.keys, hold: a.hold }))
}

/** Actions that get their own touch button: all but the primary, which the TAG button runs. */
export function touchActions(controls: GearControls | undefined): readonly GearAction[] {
  return controls ? controls.actions.slice(1) : []
}

/** The quiet reminder shown beside the drum: the number keys that pick a gear. None for one gear. */
export function keyHint(count: number): string {
  return count <= 1 ? '' : count === 2 ? '1 or 2' : `1 to ${Math.min(count, 9)}`
}

/** A readable fallback when the rack offers no names: "pester" becomes "Pester". */
export function fallbackLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** One string per set of hints, so a status-only change does not rebuild the hint lines. */
export function hintSignature(hints: readonly Hint[]): string {
  return hints.map(h => `${h.id}:${h.label}:${h.keys.join('+')}:${h.hold ? 1 : 0}`).join('|')
}

// ---------------------------------------------------------------------------------------

interface Item { id: string; button: HTMLButtonElement; label: HTMLElement; offset: number }

interface ActionButton { id: string; button: HTMLButtonElement; action: GearAction; held: GearAction | null; pointers: Set<number> }

export class GearSelector {
  readonly element = document.createElement('div')
  private readonly actionsElement = document.createElement('div')
  private readonly drum = document.createElement('div')
  private readonly detail = document.createElement('div')
  private readonly descEl = document.createElement('p')
  /** Under the selected gear's name: its status and its charge or recharge bar. */
  private readonly meter = document.createElement('div')
  private readonly statusEl = document.createElement('p')
  /**
   * The charge ring round the selected gear's node (the owner, 25 November 2026: "a donut circle
   * begin from the 12:00 position and extend around the outside ... as it charges, then have it
   * glow a little bit when fully charged"): Plasma Thunder's charge, Grapple's cord tension,
   * Yoink's hold. One SVG stroke drawn to the level's share of its length; nothing at 0.
   */
  private readonly ringEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  /** The way out of what the gear holds (a cord, a grabbed vehicle), beside its status. */
  private readonly releaseEl = document.createElement('span')
  /** Desktop: what the gear holds and how to let go, the first line of the detail beside the name. */
  private readonly heldEl = document.createElement('p')
  private readonly heldStatusEl = document.createElement('span')
  private releaseShown = ''
  private readonly hintsEl = document.createElement('ul')
  private readonly keyHintEl = document.createElement('p')
  private readonly abort = new AbortController()
  private readonly touch: boolean
  private readonly onSelect?: (id: string) => void

  private items: Item[] = []
  private ids: string[] = []
  private current = ''
  private controls: GearControls | undefined = undefined
  private focused: boolean | null = null
  private visible = false
  private hintsKey = ''
  private status = ''
  private level = -1
  private own: GearControls | undefined = undefined
  private description = ''
  private actionsKey = ''
  private actionButtons: ActionButton[] = []

  // Gesture state.
  private drag: { pointer: number; y: number; moved: boolean } | null = null
  private suppressClick = false
  private wheelAcc = 0
  private wheelAt = 0
  /** Refits the names whenever the drum changes size (mode, viewport, shown). */
  private readoutWatched: HTMLElement | null = null
  private readonly fitter = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fit())

  constructor(parent: HTMLElement, private readonly source: () => GearSource | undefined, options: GearSelectorOptions = {}) {
    this.touch = Boolean(options.touch)
    this.onSelect = options.onSelect
    const root = this.element
    root.className = 'gear-selector'
    root.hidden = true
    if (this.touch) root.dataset.touch = ''

    this.drum.className = 'gs-drum'
    // The selected name's size settles at the end of its row's scale transition: place what the
    // gear holds after it again then (placeHeld).
    this.drum.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'transform' && (e.target as Element).classList.contains('gs-label')) this.placeHeld()
    }, { signal: this.abort.signal })
    this.drum.setAttribute('role', 'listbox')
    this.drum.setAttribute('aria-label', 'Gear')
    this.drum.setAttribute('aria-orientation', 'vertical')

    // A hairline spine down the drum's left side, and the pill-shaped window whose brighter
    // rim marks the active slot. The items scroll through it.
    const spine = document.createElement('span')
    spine.className = 'gs-spine'
    spine.setAttribute('aria-hidden', 'true')
    const window_ = document.createElement('span')
    window_.className = 'gs-window'
    window_.setAttribute('aria-hidden', 'true')

    this.detail.className = 'gs-detail'
    this.descEl.className = 'gs-desc'
    this.statusEl.className = 'gs-status'
    this.statusEl.hidden = true
    // Centred on the lit node, inside the window (gear.css, hud-column.css), so it never moves it.
    this.ringEl.setAttribute('class', 'gs-ring is-idle')
    this.ringEl.setAttribute('viewBox', '0 0 16 16')
    this.ringEl.setAttribute('aria-hidden', 'true')
    this.ringEl.innerHTML = '<circle cx="8" cy="8" r="6.5" pathLength="100"/>'
    window_.append(this.ringEl)
    this.hintsEl.className = 'gs-hints'
    this.hintsEl.setAttribute('aria-label', 'Controls')
    this.keyHintEl.className = 'gs-keyhint'
    this.keyHintEl.setAttribute('aria-hidden', 'true')
    // The status and the charge or recharge bar sit under the selected gear's name (the owner,
    // 21 November 2026), inside its row, so they travel with the name as the drum turns
    // (placeMeter). Screen readers get the status as the row's description instead.
    this.meter.className = 'gs-meter'
    this.meter.setAttribute('aria-hidden', 'true')
    this.releaseEl.className = 'gs-release'
    this.releaseEl.hidden = true
    this.heldEl.className = 'gs-held'
    this.heldEl.hidden = true
    this.heldStatusEl.className = 'gs-held-status'
    this.heldEl.append(this.heldStatusEl)
    // Where the way to let go goes: beside the name on a desktop, under the status on touch
    // (only when no thumb button lets go, releaseHint).
    if (this.touch) this.meter.append(this.releaseEl); else this.heldEl.append(this.releaseEl)
    // Under the name: the bar (and on touch the status, the bar after it, so it never moves the
    // words when it appears). On a desktop the status and the way to let go sit beside the name
    // instead, the detail's first line (gear.css, hud-column.css): clear of the rows below.
    this.meter.prepend(this.statusEl)
    this.detail.append(this.heldEl, this.descEl, this.hintsEl, this.keyHintEl)

    root.append(spine, window_, this.drum, this.detail)
    parent.append(root)

    // A sibling, not a child: the selector is transformed, which would trap position: fixed.
    this.actionsElement.className = 'gear-actions'
    this.actionsElement.setAttribute('role', 'group')
    this.actionsElement.setAttribute('aria-label', 'Gear actions')
    this.actionsElement.hidden = true
    parent.append(this.actionsElement)

    this.listen()
    this.fitter?.observe(this.drum)
    document.fonts?.ready.then(() => this.fit(), () => {})
  }

  /** Call every frame. `focused` is true while the cursor is captured for driving. */
  update(focused: boolean): void {
    const source = this.source()
    const list = source?.list()
    const show = Boolean(list && list.length > 1)
    if (show !== this.visible) { this.visible = show; this.element.hidden = !show }
    if (focused !== this.focused) this.setFocused(focused)

    if (source && list) {
      if (!this.sameList(list)) this.rebuild(source, list)
      const current = source.current
      if (current !== this.current) this.moveTo(source, current)
    }
    const controls = source?.controls?.()
    if (controls !== this.controls) this.setControls(controls)
    // The rack's level is a live getter: read it every frame, write only when it moves.
    else if (this.own) this.showLevel(this.own)
  }

  private showLevel(own: GearControls | undefined): void {
    const level = levelStep(own?.level)
    if (level === this.level) return
    this.level = level
    // The share of the ring drawn (its circle's pathLength is 100), from 12 o'clock clockwise.
    // Idle (nothing charged, taut or held) there is no ring; full, it completes and glows.
    const shown = Math.max(0, level)
    this.ringEl.style.setProperty('--level', String(shown))
    this.ringEl.classList.toggle('is-idle', shown <= 0)
    this.ringEl.classList.toggle('is-full', shown >= 1)
  }

  dispose(): void {
    this.releaseAll()
    this.abort.abort()
    this.fitter?.disconnect()
    this.element.remove()
    this.actionsElement.remove()
  }

  // -------------------------------------------------------------------------------------

  private sameList(list: readonly string[]): boolean {
    if (list.length !== this.ids.length) return false
    for (let i = 0; i < list.length; i++) if (list[i] !== this.ids[i]) return false
    return true
  }

  private labelOf(source: GearSource, id: string): string {
    const named = source.labelOf?.(id)
    if (named) return named
    const controls = source.controls?.()
    if (controls && controls.gear === id && controls.name) return controls.name
    return fallbackLabel(id)
  }

  private rebuild(source: GearSource, list: readonly string[]): void {
    this.ids = [...list]
    this.items = this.ids.map((id, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gs-item'
      button.id = `gs-${id}-${Math.random().toString(36).slice(2, 7)}`
      button.setAttribute('role', 'option')
      button.dataset.id = id
      button.tabIndex = -1
      const label = document.createElement('span')
      label.className = 'gs-label'
      const number = keycap(String(index + 1))
      number.classList.add('gs-index')
      const text = document.createElement('span')
      text.className = 'gs-text'
      text.textContent = this.labelOf(source, id)
      label.append(number, text)
      button.append(label)
      button.setAttribute('aria-label', text.textContent)
      return { id, button, label, offset: 99 }
    })
    this.drum.replaceChildren(...this.items.map(i => i.button))
    // The number range, its numbers drawn as key glyphs like every other key in the column.
    const range = keyHint(list.length)
    this.keyHintEl.replaceChildren(...shortcut(range))
    this.keyHintEl.hidden = !range
    this.current = ''
    this.moveTo(source, source.current, true)
    this.fit()
  }

  /**
   * A gear's name is never cut off: where a name at full size is wider than its row (a long
   * name on a narrow phone), it is drawn smaller to fit (--fit, multiplied into the slot's
   * scale). Layout widths ignore transforms, so this reads the name's true width. Runs on
   * rebuild, when the fonts arrive and when the drum changes size; never per frame.
   */
  private fit(): void {
    for (const item of this.items) {
      const natural = item.label.offsetWidth
      if (!natural) continue
      const style = getComputedStyle(item.button)
      const room = item.button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2
      const fit = room > 0 && natural > room ? Math.floor(room / natural * 1000) / 1000 : 1
      item.label.style.setProperty('--fit', String(fit))
    }
    this.fitDetail()
    this.placeHeld()
  }

  /**
   * Cursor captured on a desktop, what the gear holds and how to let go follow the selected name
   * on its own line, a word's space after its last letter (the Foreman, 25 November 2026: there
   * is no description to align with, and beside the description's column it floated mid-sky).
   * The detail moves there by transform (--gs-held-shift, hud-column.css); with the cursor free it
   * stays in its column, the description's first line. Measured from the name as drawn, again
   * once its row's scale has settled. Where the name and the line
   * would run past a third of the window, the line drops its second input ("or double-click").
   */
  private placeHeld(): void {
    const el = this.element
    const item = this.items[this.ids.indexOf(this.current)]
    if (this.touch || !this.focused || this.heldEl.hidden || !item) { el.style.removeProperty('--gs-held-shift'); this.releaseEl.classList.remove('is-short'); return }
    const text = item.label.querySelector<HTMLElement>('.gs-text')
    if (!text) return
    // The name as drawn, in the selector's frame. Its size settles after a change of gear or of
    // form (the row's scale transition): placeHeld runs again when it ends (the drum listens).
    const nameRight = text.getBoundingClientRect().right - el.getBoundingClientRect().left
    // The line's own left edge in the selector, untransformed (inside the detail's padding).
    const shift = Math.round(nameRight + HELD_GAP - this.detail.offsetLeft - this.heldEl.offsetLeft)
    el.style.setProperty('--gs-held-shift', `${shift}px`)
    this.releaseEl.classList.remove('is-short')
    const right = el.getBoundingClientRect().left + this.detail.offsetLeft + this.heldEl.offsetLeft + shift + this.heldEl.offsetWidth
    this.releaseEl.classList.toggle('is-short', right > innerWidth / 3)
  }

  /**
   * The detail sits beside the selected gear and must never run into the speed readout beside
   * the left arc (inspector/focus-readouts.css), keeping room for a three-digit speed, since the
   * readout grows leftwards with its number. Where the two would meet, the detail is narrowed to
   * the room left of the readout (--gs-detail-max, hud-column.css); where that room is under
   * 160 px (narrow screens), it keeps its width and drops just below the readout instead
   * (--gs-detail-drop). Runs with fit(): on rebuild, fonts, mode and size changes, and when the
   * gear's text changes; never per frame.
   */
  private fitDetail(): void {
    const detail = this.detail
    detail.style.removeProperty('--gs-detail-max'); detail.style.removeProperty('--gs-detail-drop')
    if (this.element.hidden || !detail.offsetWidth) return
    const readout = document.querySelector<HTMLElement>('.focus-hud .fh-left')
    // Watched too: it appears after the drum, and widens when its number gains a digit.
    if (readout && readout !== this.readoutWatched) { this.fitter?.observe(readout); this.readoutWatched = readout }
    if (!readout || !readout.offsetWidth) return
    const a = detail.getBoundingClientRect(), r = readout.getBoundingClientRect()
    const left = Math.min(r.left, r.right - 112)
    if (a.bottom + 8 < r.top || a.top - 8 > r.bottom || a.right + 12 <= left) return
    const room = Math.floor(left - 12 - a.left)
    if (room >= 160) detail.style.setProperty('--gs-detail-max', `${room}px`)
    else detail.style.setProperty('--gs-detail-drop', `${Math.ceil(r.bottom + 8 - a.top)}px`)
  }

  private moveTo(source: GearSource, current: string, force = false): void {
    const count = this.items.length
    const was = this.ids.indexOf(this.current)
    const now = this.ids.indexOf(current)
    this.current = current
    if (now < 0) return
    const instant = force || was < 0
    const shift = instant ? 0 : -ringOffset(now, was, count)
    const entering: Item[] = []
    for (let i = 0; i < count; i++) {
      const item = this.items[i]
      const to = ringOffset(i, now, count)
      if (instant) item.button.classList.add('gs-snap')
      else {
        const entry = entryOffset(item.offset, to, shift, count)
        if (entry !== null) { item.button.classList.add('gs-snap'); this.pose(item, entry); entering.push(item) }
      }
      item.offset = to
      const active = to === 0
      item.button.setAttribute('aria-selected', String(active))
      item.button.tabIndex = active ? 0 : -1
      item.button.classList.toggle('is-active', active)
    }
    // Items crossing the back of the ring jump, unseen, to just beyond the far edge first.
    if (entering.length) { void this.drum.offsetHeight; for (const item of entering) item.button.classList.remove('gs-snap') }
    for (const item of this.items) this.pose(item, item.offset)
    if (instant) { void this.drum.offsetHeight; for (const item of this.items) item.button.classList.remove('gs-snap') }
    const active = this.items[now]
    this.placeMeter(active.button)
    this.placeHeld()
    this.drum.setAttribute('aria-activedescendant', active.button.id)
    if (this.drum.contains(document.activeElement) && document.activeElement !== active.button) active.button.focus({ preventScroll: true })
    this.element.dataset.gear = current
  }

  /**
   * The meter rides in the selected row. On a change of gear the row leaving keeps a copy that
   * fades out as it scrolls away, and the meter fades in on the row arriving: both move with
   * their names, and nothing appears or vanishes in one frame.
   */
  private placeMeter(row: HTMLElement): void {
    const from = this.meter.parentElement
    if (from === row) return
    if (from) {
      const leaving = this.meter.cloneNode(true) as HTMLElement
      leaving.classList.remove('is-arriving'); leaving.classList.add('is-leaving')
      from.append(leaving)
      setTimeout(() => leaving.remove(), METER_FADE_MS + 60)
      from.removeAttribute('aria-description')
    }
    this.meter.classList.remove('is-arriving'); void this.meter.offsetWidth; this.meter.classList.add('is-arriving')
    row.append(this.meter)
    if (this.status) row.setAttribute('aria-description', this.status)
  }

  private pose(item: Item, offset: number): void {
    const p = slotPose(offset)
    const s = item.button.style
    s.setProperty('--o', String(Math.max(-3, Math.min(3, offset))))
    s.setProperty('--s', String(p.scale))
    // The neighbours fade by their ink (--a, gear.css), not by opacity, so the dark falloff
    // under their letters stays whole and holds them over bright sky (the owner, 21 November
    // 2026: "faded text above and below"). Rows further out fade as a whole.
    const ink = p.opacity > 0 ? Math.max(NEIGHBOUR_INK, p.opacity) : 1
    s.setProperty('--a', String(ink))
    s.opacity = String(p.opacity / ink)
    s.visibility = p.opacity === 0 ? 'hidden' : ''
  }

  private setFocused(focused: boolean): void {
    const first = this.focused === null
    this.focused = focused
    this.slideNames(first, () => { this.element.dataset.mode = focused ? 'locked' : 'free' })
    // Captured: the drum is a display. Drop focus so driving keys are not eaten here.
    this.element.toggleAttribute('inert', focused)
    if (focused && this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    if (focused) this.endDrag()
    // The number keys show only with the cursor free, so a name's width changes with the mode.
    this.fit()
  }

  /**
   * Change the list's form in `change`, sliding each name from where it was drawn to its new
   * laid-out place: a transform only, ending on nothing, so the layout is never touched and
   * nothing is left a pixel off. Each name's own offset inside its row is measured, so the
   * selected gear's larger scale moves with it. Interrupted midway, a slide restarts from where
   * the name is drawn.
   */
  private slideNames(first: boolean, change: () => void): void {
    const still = first || matchMedia('(prefers-reduced-motion: reduce)').matches
    const texts = this.items.map(item => item.label.querySelector<HTMLElement>('.gs-text')).filter((t): t is HTMLElement => !!t)
    const drawn = still ? [] : texts.map(t => t.offsetLeft + new DOMMatrixReadOnly(getComputedStyle(t).transform).m41)
    for (const t of texts) for (const a of t.getAnimations()) a.cancel()
    change()
    if (still) return
    const slides: Animation[] = []
    texts.forEach((t, i) => {
      const dx = drawn[i] - t.offsetLeft
      if (Math.abs(dx) < 0.25) return
      slides.push(t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: NAME_SLIDE_MS, easing: NAME_SLIDE_EASE }))
    })
    // What the gear holds follows the name to where it comes to rest (placeHeld).
    if (slides.length) Promise.all(slides.map(a => a.finished)).then(() => this.placeHeld(), () => {})
  }

  private setControls(controls: GearControls | undefined): void {
    this.controls = controls
    const own = controls && controls.gear === this.current ? controls : undefined
    const description = own?.description ?? ''
    if (description !== this.description) { this.description = description; this.descEl.textContent = description; this.descEl.hidden = !description; this.fitDetail() }
    const status = own?.status ?? ''
    if (status !== this.status) {
      this.status = status; this.statusEl.textContent = status; this.statusEl.hidden = !status
      this.heldStatusEl.textContent = status; this.heldEl.hidden = !status; this.fitDetail(); this.placeHeld()
      const row = this.meter.parentElement
      if (row && row !== this.element) { if (status) row.setAttribute('aria-description', status); else row.removeAttribute('aria-description') }
    }
    // The release hint follows the status: shown while the gear holds something.
    const release = releaseHint(own, this.touch)
    const releaseKey = release ? `${release.key ?? ''}|${release.alt ?? ''}|${release.text}` : ''
    if (releaseKey !== this.releaseShown) {
      this.releaseShown = releaseKey
      const alt = release?.alt ? Object.assign(document.createElement('span'), { className: 'gs-release-alt', textContent: `${release.alt} ` }) : null
      this.releaseEl.replaceChildren(...(release ? [...(release.key ? [keycap(release.key), ' '] : []), ...(alt ? [alt] : []), release.text] : []))
      this.releaseEl.hidden = !release
      this.placeHeld()
    }
    this.own = own
    this.showLevel(own)
    const hints = hintModel(own)
    const key = hintSignature(hints)
    if (key !== this.hintsKey) { this.hintsKey = key; this.renderHints(hints) }
    if (this.touch) this.renderActions(own)
  }

  private renderHints(hints: readonly Hint[]): void {
    this.hintsEl.replaceChildren(...hints.map(h => {
      const li = document.createElement('li')
      li.dataset.action = h.id
      const keys = document.createElement('span')
      keys.className = 'gs-keys'
      h.keys.forEach((k, i) => {
        if (i) { const or = document.createElement('span'); or.className = 'gs-or'; or.textContent = '/'; keys.append(or) }
        // A double tap of the tag control is a double-click on a desktop, where these hints show.
        keys.append(...shortcut(/^double tap$/i.test(k) ? 'double-click' : k))
      })
      const label = document.createElement('span')
      label.className = 'gs-act'
      label.textContent = h.label
      li.append(keys, label)
      return li
    }))
    this.hintsEl.hidden = hints.length === 0
  }

  // --- Touch action buttons ------------------------------------------------------------

  private renderActions(controls: GearControls | undefined): void {
    const actions = touchActions(controls)
    const key = actions.map(a => `${a.id}:${a.label}:${a.hold ? 1 : 0}`).join('|')
    if (key === this.actionsKey) {
      // Same buttons; point them at the fresh action objects. A running hold keeps its own.
      for (let i = 0; i < actions.length; i++) this.actionButtons[i].action = actions[i]
      return
    }
    this.actionsKey = key
    const keep = new Map(this.actionButtons.map(b => [b.id, b]))
    const next: ActionButton[] = []
    for (const action of actions) {
      const old = keep.get(action.id)
      if (old && old.button.dataset.hold === String(action.hold)) {
        keep.delete(action.id)
        old.action = action
        if (old.button.textContent !== action.label) { old.button.textContent = action.label; old.button.setAttribute('aria-label', action.label) }
        next.push(old)
      } else next.push(this.actionButton(action))
    }
    // Anything that no longer applies lets go before it disappears.
    for (const gone of keep.values()) { this.release(gone); gone.button.remove() }
    this.actionButtons = next
    this.actionsElement.replaceChildren(...next.map(b => b.button))
    this.actionsElement.hidden = next.length === 0
  }

  private actionButton(action: GearAction): ActionButton {
    const button = document.createElement('button')
    button.type = 'button'
    // The shared round glass button, like the shell's thumb buttons (touch-stick.css).
    button.className = 'liquid-glass glass-round gs-action'
    button.dataset.action = action.id
    button.dataset.hold = String(action.hold)
    button.textContent = action.label
    button.setAttribute('aria-label', action.label)
    const entry: ActionButton = { id: action.id, button, action, held: null, pointers: new Set() }
    const signal = this.abort.signal
    if (action.hold) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        entry.pointers.add(event.pointerId)
        this.press(entry)
      }, { signal })
      const up = (event: PointerEvent) => {
        if (!entry.pointers.delete(event.pointerId)) return
        if (!entry.pointers.size) this.release(entry)
      }
      for (const name of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'] as const) button.addEventListener(name, up, { signal })
      button.addEventListener('keydown', (event) => {
        if (event.code !== 'Space' && event.code !== 'Enter') return
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) this.press(entry)
      }, { signal })
      button.addEventListener('keyup', (event) => { if (event.code === 'Space' || event.code === 'Enter') this.release(entry) }, { signal })
      button.addEventListener('blur', () => { entry.pointers.clear(); this.release(entry) }, { signal })
    } else {
      button.addEventListener('click', () => { entry.action.start(); this.refreshControls() }, { signal })
    }
    button.addEventListener('contextmenu', (event) => event.preventDefault(), { signal })
    return entry
  }

  private press(entry: ActionButton): void {
    if (entry.held) return
    entry.held = entry.action
    entry.button.classList.add('held')
    entry.action.start()
    this.refreshControls()
  }

  /** After an action, show its new state now rather than on the next frame. */
  private refreshControls(): void {
    const controls = this.source()?.controls?.()
    if (controls !== this.controls) this.setControls(controls)
  }

  private release(entry: ActionButton): void {
    const held = entry.held
    if (!held) return
    entry.held = null
    entry.pointers.clear()
    entry.button.classList.remove('held')
    held.stop?.()
  }

  private releaseAll(): void { for (const b of this.actionButtons) this.release(b) }

  // --- Picking gear -------------------------------------------------------------------

  private choose(id: string): void {
    const source = this.source()
    if (!source || id === source.current || !source.list().includes(id)) return
    source.select(id)
    this.onSelect?.(id)
    if (source.current !== this.current) this.moveTo(source, source.current)
    this.refreshControls()
  }

  private step(by: number): void {
    const count = this.ids.length
    if (count < 2) return
    const at = Math.max(0, this.ids.indexOf(this.current))
    this.choose(this.ids[(at + by + count * 4) % count])
  }

  private endDrag(): void {
    if (!this.drag) return
    if (this.drum.hasPointerCapture(this.drag.pointer)) this.drum.releasePointerCapture(this.drag.pointer)
    this.drag = null
  }

  private pitch(): number {
    return this.items[0]?.button.offsetHeight || 46
  }

  private listen(): void {
    const signal = this.abort.signal
    const drum = this.drum
    // The readouts move with the viewport, so the detail's room is checked again on resize.
    addEventListener('resize', () => this.fitDetail(), { signal })
    drum.addEventListener('click', (event) => {
      if (this.suppressClick) { this.suppressClick = false; event.preventDefault(); return }
      const button = (event.target as Element).closest<HTMLElement>('.gs-item')
      if (button?.dataset.id) this.choose(button.dataset.id)
    }, { signal })

    // Drag or swipe: past a small threshold the drum takes the pointer and steps one slot
    // for each pitch travelled. A tap that never moves stays a click on the item.
    drum.addEventListener('pointerdown', (event) => {
      if (this.focused || event.button !== 0 || this.drag) return
      this.drag = { pointer: event.pointerId, y: event.clientY, moved: false }
      this.suppressClick = false
    }, { signal })
    drum.addEventListener('pointermove', (event) => {
      const drag = this.drag
      if (!drag || event.pointerId !== drag.pointer) return
      const dy = event.clientY - drag.y
      if (!drag.moved) {
        if (Math.abs(dy) < 8) return
        drag.moved = true
        try { drum.setPointerCapture(drag.pointer) } catch { /* the pointer already ended */ }
      }
      const pitch = this.pitch() * 0.7
      if (Math.abs(dy) >= pitch) {
        const steps = Math.trunc(dy / pitch)
        drag.y += steps * pitch
        // Dragging up pulls the next gear into the centre.
        this.step(-steps)
      }
    }, { signal })
    const end = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.pointer) return
      if (this.drag.moved) this.suppressClick = true
      this.endDrag()
      // A drag that ends outside the drum produces no click to swallow.
      setTimeout(() => { this.suppressClick = false }, 0)
    }
    drum.addEventListener('pointerup', end, { signal })
    drum.addEventListener('pointercancel', end, { signal })

    drum.addEventListener('wheel', (event) => {
      if (this.focused) return
      event.preventDefault()
      const now = event.timeStamp
      if (now - this.wheelAt > 250) this.wheelAcc = 0
      this.wheelAt = now
      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY
      this.wheelAcc += delta
      if (Math.abs(this.wheelAcc) >= 50) {
        this.step(Math.sign(this.wheelAcc))
        this.wheelAcc = 0
      }
    }, { signal, passive: false })

    // Arrow keys move through the ring while it has focus. Only the keys handled here stop;
    // key up always passes so a driving key released after focus moves still clears.
    drum.addEventListener('keydown', (event) => {
      let by = 0
      if (event.code === 'ArrowDown' || event.code === 'ArrowRight') by = 1
      else if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') by = -1
      else if (event.code === 'Home') { event.preventDefault(); event.stopPropagation(); this.choose(this.ids[0]); return }
      else if (event.code === 'End') { event.preventDefault(); event.stopPropagation(); this.choose(this.ids[this.ids.length - 1]); return }
      else if (event.code === 'Space' || event.code === 'Enter') { event.stopPropagation(); return }
      else return
      event.preventDefault(); event.stopPropagation()
      this.step(by)
    }, { signal })

    window.addEventListener('blur', () => this.releaseAll(), { signal })
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll() }, { signal })
  }
}
