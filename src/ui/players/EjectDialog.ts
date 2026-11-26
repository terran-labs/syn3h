/**
 * Eject, asked once, in the game's own confirmation card (the owner, 25 November 2026: "have an
 * ejection modal where we ask if we're sure ... and add a banish for slider in this modal.
 * Default should be 0"). It reuses the Leave-world dialog's look (.exit-confirm, exploration.css),
 * so the pause screen keeps it visible the same way. No browser dialog, no slide.
 *
 * Focus starts on Cancel, never on Eject; Escape cancels; Tab stays inside. For a bot the card
 * asks to remove it and has no slider: a bot cannot come back on its own.
 */

/** The five stops of Banish for, left to right. `seconds` < 0 is permanent. */
export const BANISH_STOPS = [
  { id: 'none', short: 'None', words: 'None', seconds: 0, says: 'They can come back straight away.' },
  { id: '5m', short: '5 min', words: '5 minutes', seconds: 5 * 60, says: 'Banished for 5 minutes.' },
  { id: '30m', short: '30 min', words: '30 minutes', seconds: 30 * 60, says: 'Banished for 30 minutes.' },
  { id: '24h', short: '24 h', words: '24 hours', seconds: 24 * 3600, says: 'Banished for 24 hours.' },
  { id: 'permanent', short: 'Permanent', words: 'Permanently', seconds: -1, says: 'Banished permanently.' },
] as const
export type BanishStop = (typeof BANISH_STOPS)[number]

/** The quiet honest line under a non-zero stop: a banish is keyed to the browser, not the person. */
export const BANISH_SCOPE = 'A banish keeps them out of this world on the browser they used.'

/** The stop a key moves to from `index`, or null for a key the slider does not use. */
export function stopForKey(index: number, key: string): number | null {
  const last = BANISH_STOPS.length - 1
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': case 'PageUp': return Math.min(last, index + 1)
    case 'ArrowLeft': case 'ArrowDown': case 'PageDown': return Math.max(0, index - 1)
    case 'Home': return 0
    case 'End': return last
    default: return null
  }
}

/** The nearest stop to a position along the track, 0 at the left end and 1 at the right. */
export function stopAt(fraction: number): number {
  const last = BANISH_STOPS.length - 1
  return Math.round(Math.min(1, Math.max(0, fraction)) * last)
}

export interface EjectTarget { id: number; name: string; bot: boolean }

export class EjectDialog {
  readonly element = document.createElement('div')
  private readonly card = document.createElement('div')
  private readonly title = document.createElement('strong')
  private readonly slider = document.createElement('div')
  private readonly says = document.createElement('p')
  private readonly scope = document.createElement('p')
  private readonly cancel = document.createElement('button')
  private readonly confirm = document.createElement('button')
  private readonly banish = document.createElement('div')
  private index = 0
  private confirmFn: ((stop: BanishStop) => void) | null = null
  private returnFocus: HTMLElement | null = null

  constructor(parent: HTMLElement) {
    const el = this.element
    el.className = 'exit-confirm eject-confirm'
    el.hidden = true
    el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true')
    el.setAttribute('aria-labelledby', 'eject-confirm-title')
    this.card.className = 'exit-confirm-card eject-confirm-card'
    this.title.id = 'eject-confirm-title'

    // Banish for: a heading, the track with five ticks and their words, and what the stop means.
    this.banish.className = 'banish'
    const heading = Object.assign(document.createElement('span'), { className: 'banish-heading', id: 'banish-heading', textContent: 'Banish for' })
    const s = this.slider
    s.className = 'banish-slider'; s.tabIndex = 0
    s.setAttribute('role', 'slider'); s.setAttribute('aria-labelledby', 'banish-heading')
    s.setAttribute('aria-valuemin', '0'); s.setAttribute('aria-valuemax', String(BANISH_STOPS.length - 1))
    s.innerHTML = '<span class="banish-track"><span class="banish-fill"></span></span><span class="banish-thumb"></span>'
    const ticks = document.createElement('div'); ticks.className = 'banish-stops'; ticks.setAttribute('aria-hidden', 'true')
    BANISH_STOPS.forEach((stop, i) => {
      const tick = Object.assign(document.createElement('span'), { textContent: stop.short })
      tick.style.setProperty('--at', String(i / (BANISH_STOPS.length - 1)))
      tick.addEventListener('click', () => this.set(i))
      ticks.append(tick)
    })
    s.append(ticks)
    this.says.className = 'banish-says'; this.says.setAttribute('aria-live', 'polite')
    this.scope.className = 'banish-scope'; this.scope.textContent = BANISH_SCOPE
    this.banish.append(heading, s, this.says, this.scope)

    const actions = document.createElement('div'); actions.className = 'exit-confirm-actions'
    Object.assign(this.cancel, { type: 'button', className: 'panel-action eject-cancel', textContent: 'Cancel' })
    Object.assign(this.confirm, { type: 'button', className: 'panel-action eject-go is-danger' })
    actions.append(this.cancel, this.confirm)
    this.card.append(this.title, this.banish, actions)
    el.append(this.card)
    parent.append(el)

    this.cancel.addEventListener('click', () => this.close())
    this.confirm.addEventListener('click', () => {
      const fn = this.confirmFn, stop = BANISH_STOPS[this.index]
      this.close(false); fn?.(stop)
    })
    // A click on the dimmed world outside the card cancels, as Escape does.
    el.addEventListener('pointerdown', event => { if (event.target === el) this.close() })
    el.addEventListener('keydown', event => this.key(event))
    s.addEventListener('keydown', event => {
      const next = stopForKey(this.index, event.key)
      if (next === null) return
      event.preventDefault(); event.stopPropagation(); this.set(next)
    })
    // Drag anywhere on the track, by mouse, pen or touch; it snaps to the nearest stop.
    s.addEventListener('pointerdown', event => {
      if ((event.target as Element).closest('.banish-stops')) return
      s.setPointerCapture(event.pointerId); this.drag(event); s.focus()
    })
    s.addEventListener('pointermove', event => { if (s.hasPointerCapture(event.pointerId)) this.drag(event) })
  }

  get open(): boolean { return !this.element.hidden }

  /** Ask about `target`; `onConfirm` runs only on Eject (or Remove), with the chosen stop. */
  show(target: EjectTarget, onConfirm: (stop: BanishStop) => void, returnFocus?: HTMLElement): void {
    this.confirmFn = onConfirm
    this.returnFocus = returnFocus ?? (document.activeElement as HTMLElement | null)
    this.title.textContent = target.bot ? `Remove ${target.name} from this world?` : `Eject ${target.name} from this world?`
    this.confirm.textContent = target.bot ? 'Remove' : 'Eject'
    this.banish.hidden = target.bot
    this.set(0)
    this.element.hidden = false
    this.cancel.focus()
  }

  close(restore = true): void {
    if (this.element.hidden) return
    this.element.hidden = true
    this.confirmFn = null
    if (restore && this.returnFocus?.isConnected) this.returnFocus.focus()
    this.returnFocus = null
  }

  private set(index: number): void {
    this.index = index
    const stop = BANISH_STOPS[index]
    this.slider.setAttribute('aria-valuenow', String(index))
    this.slider.setAttribute('aria-valuetext', stop.words)
    this.slider.style.setProperty('--at', String(index / (BANISH_STOPS.length - 1)))
    this.slider.querySelectorAll('.banish-stops > span').forEach((tick, i) => tick.classList.toggle('is-current', i === index))
    this.says.textContent = stop.says
    this.scope.hidden = stop.seconds === 0
  }

  private drag(event: PointerEvent): void {
    const track = this.slider.querySelector('.banish-track')!.getBoundingClientRect()
    if (track.width > 0) this.set(stopAt((event.clientX - track.left) / track.width))
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return }
    if (event.key !== 'Tab') return
    // Keep Tab inside the card.
    const stops = [this.banish.hidden ? null : this.slider, this.cancel, this.confirm].filter(Boolean) as HTMLElement[]
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next = (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    event.preventDefault(); stops[next].focus()
  }
}
