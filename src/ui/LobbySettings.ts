/**
 * The lobby's settings: Settings, Welcome and Updates stacked in the lower right of the galaxy
 * (Settings on top, the owner, 20 November 2026), the running version as plain text in the lower
 * left, and a right-hand settings card that Settings opens. The card is the in-game sidebar's own
 * component (an Inspector showing only the sections added here), so its rows, switches, sliders
 * and quality controls are the in-game ones and cannot drift. It holds only what acts in the
 * lobby, or what a player sets before entering a world:
 *
 *   Graphics  the quality level, Auto and the render resolution (pixel density): the galaxy is
 *             drawn at this level, so a change shows at once. Frame diagnostics describe a world
 *             in play and are left out.
 *   Sound     music and master volume and mute: the lobby has its own music and click cues. The
 *             other audio settings (engines, wind, ground, other vehicles) act only in a world.
 *   Play      "Bots may play with me": personal, and sent to a room as you join it.
 *   Room      the host's lock and reset, only while there is a room to act on.
 *
 * Left out, because they act only in a world and the in-game panel has them: touch hand, look
 * sensitivity, daydream, units, presentation mode, the advanced audio mix, name and colours.
 *
 * The card is one glass surface: `#lobby-settings` carries .liquid-glass and nothing inside it
 * does; its sections are plain rows. Tap outside or Escape closes it; focus stays inside while it
 * is open and returns to Settings. Closed, it is detached from the page, so the in-game rail stays
 * the only `.world-inspector` element there.
 */
import { params } from '../../shared/params'
import type { QualitySource } from '../core/quality'
import { createFrozenResourceResolver } from '../core/frozenResources'
import { Inspector } from './inspector/Inspector'
import type { PropertyDef } from './inspector/model'
import { PerformancePanel } from './PerformancePanel'
import { playWithMe } from '../bots/play/PlayDirector'
import { SOUND_STARTED, soundWaiting } from '../audio/unlock'
import './lobby-settings.css'

/** Sound settings shown before the Advanced fold, in this order. */
export const SOUND_MAIN = ['audio.music', 'audio.master', 'audio.muted'] as const
/** The lobby's sound rows: music, master and mute, in that order, from the Audio group. */
export function soundRows(defs: readonly PropertyDef[]): PropertyDef[] {
  const audio = defs.filter(def => def.group === 'Audio')
  return SOUND_MAIN.map(id => audio.find(def => def.id === id)).filter((def): def is PropertyDef => !!def)
}

/**
 * The version to show: a pinned page (?v= or /v/<version>/) shows the version it pins;
 * otherwise the build's own label, with a leading v when it is a bare release number.
 */
export function versionLabel(build: string | undefined, href: string): string {
  let pinned: string | null = null
  try { pinned = createFrozenResourceResolver(href).version } catch { /* An invalid pin is the server's to refuse. */ }
  if (pinned) return `v${pinned}`
  if (!build) return 'browser edition'
  return /^\d+\.\d+\.\d+$/.test(build) ? `v${build}` : build
}

/** Where Tab (or Shift+Tab) goes next among the panel's controls, wrapping at either end. */
export function cycleFocus<T>(focusable: readonly T[], current: T | null, back: boolean): T | null {
  if (!focusable.length) return null
  const at = current === null ? -1 : focusable.indexOf(current)
  if (at < 0) return back ? focusable[focusable.length - 1]! : focusable[0]!
  return focusable[(at + (back ? -1 : 1) + focusable.length) % focusable.length]!
}

/** A volume: an audio setting from 0 to 1, shown as a percentage like the card's summary. */
export const isVolume = (def: PropertyDef) => def.group === 'Audio' && def.min === 0 && def.max === 1

const percent = (id: string) => `${Math.round(Number(params.get(id)?.value ?? 0) * 100)}%`

/** A gear outline drawn as one path: `teeth` square teeth around a ring, and a hub circle. */
export function gearPath(teeth = 8, outer = 10.5, inner = 8, hub = 3.4): string {
  const points: string[] = [], step = (Math.PI * 2) / teeth, half = step * 0.22
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    for (const [angle, r] of [[a - step / 2 + half, inner], [a - half, inner], [a - half * 0.7, outer], [a + half * 0.7, outer], [a + half, inner]] as const) {
      points.push(`${(12 + r * Math.cos(angle)).toFixed(2)} ${(12 + r * Math.sin(angle)).toFixed(2)}`)
    }
  }
  return `M${points.join('L')}Z M${12 + hub} 12a${hub} ${hub} 0 1 0 ${-2 * hub} 0a${hub} ${hub} 0 1 0 ${2 * hub} 0Z`
}

/** Welcome: an open book, a guide to the game. */
export const WELCOME_ICON = 'M12 6.6C10 5.3 7 4.9 3.6 5.3V18.4C7 18 10 18.4 12 19.7C14 18.4 17 18 20.4 18.4V5.3C17 4.9 14 5.3 12 6.6ZM12 6.6V19.7'
/** Updates: sparkles, for what is new. */
export const UPDATES_ICON = 'M10 3.5C10.6 7.1 12.4 8.9 16 9.5C12.4 10.1 10.6 11.9 10 15.5C9.4 11.9 7.6 10.1 4 9.5C7.6 8.9 9.4 7.1 10 3.5ZM18 13.5C18.3 15.3 19.2 16.2 21 16.5C19.2 16.8 18.3 17.7 18 19.5C17.7 17.7 16.8 16.8 15 16.5C16.8 16.2 17.7 15.3 18 13.5ZM18.5 3V6.5M16.75 4.75H20.25'
/**
 * One of the lobby's three buttons: a small icon at its left edge and its word, in the game's
 * one glass button style (.liquid-glass, glass.css). Its layout is lobby-settings.css.
 */
function controlButton(button: HTMLButtonElement, className: string, word: string, icon: string): void {
  button.type = 'button'; button.className = `lobby-control liquid-glass ${className}`; button.title = word
  button.innerHTML = `<svg class="lobby-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><span class="lobby-control-word"></span>`
  button.querySelector('.lobby-control-word')!.textContent = word
}

export interface LobbySettingsOptions {
  quality?: QualitySource
  /** The host fieldset the shell already wires, moved into the Room section. */
  host?: HTMLElement
  hostSummary?(): string
  /** Whether there is a room with something to act on (host, or open sliders); the Room card shows only then. */
  inRoom?(): boolean
  /** The build constant; see versionLabel. */
  build?: string
  /** A click cue. */
  cue?(): void
  /** Called as the card opens: the shell closes any lobby sheet. */
  opening?(): void
  /** Where the wordmark is on screen now, which the card must not cover, or null. */
  ceiling?(): { left: number; right: number; bottom: number } | null
}

/** Phones: the card is one full-width card at the top (lobby-settings.css), not fitted here. */
const PHONE = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'

export class LobbySettings {
  /** Settings, Welcome and Updates, for the lobby to place in its lower right. */
  readonly dock = document.createElement('div')
  readonly gear = document.createElement('button')
  /** The version's own corner, the lower left, for the lobby to place beside the dock. */
  readonly versionDock = document.createElement('div')
  /**
   * The running version, plain text in the lower left. A stable hook for the Updates view: find
   * it by `[data-lobby-version]` and listen for its click. It does nothing until something does.
   */
  readonly version = document.createElement('button')
  /** Welcome and Updates, under Settings. The shell wires their clicks to its sheets. */
  readonly about = document.createElement('button')
  readonly updates = document.createElement('button')
  /** Holds the panel and its tooltip; attached to the page only while open. */
  private readonly host = document.createElement('div')
  private readonly inspector: Inspector
  private readonly performance: PerformancePanel
  private readonly abort = new AbortController()
  private shown = false
  private closing?: Animation
  private roomCard?: HTMLElement

  constructor(private readonly parent: HTMLElement, private readonly options: LobbySettingsOptions = {}) {
    const signal = this.abort.signal
    const label = versionLabel(options.build, location.href)
    this.dock.className = 'lobby-gear-dock'
    // Settings, Welcome and Updates, top to bottom, each a labelled glass button.
    controlButton(this.gear, 'lobby-gear', 'Settings', gearPath())
    controlButton(this.about, 'lobby-about', 'Welcome', WELCOME_ICON)
    controlButton(this.updates, 'lobby-updates', 'Updates', UPDATES_ICON)
    for (const button of [this.about, this.updates]) button.setAttribute('aria-haspopup', 'dialog')
    this.gear.setAttribute('aria-expanded', 'false'); this.gear.setAttribute('aria-controls', 'lobby-settings')
    this.version.type = 'button'; this.version.className = 'lobby-version'; this.version.dataset.lobbyVersion = ''
    this.version.textContent = label; this.version.title = `Version ${label}`; this.version.setAttribute('aria-label', `Version ${label}`)
    this.dock.append(this.gear, this.about, this.updates)
    // The version sits apart, in the lower left (versionDock): plain shadowed text, no card.
    this.versionDock.className = 'lobby-version-dock'; this.versionDock.append(this.version)

    this.host.className = 'lobby-settings-host'
    // One section open at a time, and the card scrolls inside: it is capped below the wordmark,
    // so Graphics alone may be taller than the card, and must not close itself to fit.
    this.inspector = new Inspector(this.host, { summary: () => '', vehicles: () => ({ options: [], current: '' }), onVehicle() {}, sections: [], percent: isVolume, oneOpen: () => true })
    const panel = this.inspector.element
    // One card, one glass surface: the class is on the card and on nothing inside it.
    panel.classList.add('lobby-settings', 'liquid-glass'); panel.id = 'lobby-settings'
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Settings')
    const head = document.createElement('header'); head.className = 'lobby-settings-head'
    head.innerHTML = '<h2>Settings</h2><button type="button" class="lobby-settings-close" aria-label="Close settings"><span aria-hidden="true">×</span><span class="lobby-settings-close-text">Close</span></button>'
    // The world tools (search, copy, paste, reset world) belong to a world, not the lobby.
    panel.querySelector('.wi-top')?.remove()
    panel.querySelector('.wi-cards')!.before(head)
    head.querySelector('.lobby-settings-close')!.addEventListener('click', () => this.close(), { signal })

    // Graphics first: the in-game Performance card on the same quality controller.
    this.performance = new PerformancePanel(this.host, () => {}, options.quality, this.inspector)
    const graphics = panel.querySelector<HTMLElement>(`.wi-card[data-section="${PerformancePanel.CARD}"]`)
    if (graphics) {
      graphics.classList.add('lobby-graphics'); graphics.querySelector('h3')!.textContent = 'Graphics'
      // Frame history and renderer diagnostics describe a world in play: not shown here.
      graphics.querySelector('.performance-diagnostics')?.remove()
    }
    // Sound: the two volumes and mute; the world's own sounds are set in a world.
    const sound = document.createElement('div')
    this.inspector.addCard('sound', 'Sound', sound, () => `Music ${percent('audio.music')} · Master ${percent('audio.master')}${params.get('audio.muted')?.value ? ' · Muted' : ''}${soundWaiting() ? ' · Tap to start sound' : ''}`, {
      fill: () => {
        const note = document.createElement('p'); note.className = 'wi-blurb'
        note.textContent = 'The music is generated as you play and follows what you do. It starts with your first click or key press.'
        sound.replaceChildren(...soundRows(params.all().map(p => p.def as PropertyDef)).map(def => this.inspector.row(def)), note)
      },
    })
    // The browser holds sound until a first gesture; the summary says so quietly until it starts.
    window.addEventListener(SOUND_STARTED, () => this.inspector.update(), { signal })
    // Play: whether the bots may play with you, set before you join a world.
    const play = document.createElement('div')
    this.inspector.addCard('play', 'Play', play, () => `Bots may play with me: ${params.get(playWithMe.def.id)?.value ? 'yes' : 'no'}`, {
      fill: () => { play.replaceChildren(this.inspector.row(playWithMe.def as PropertyDef)) },
    })
    if (options.host) {
      const room = document.createElement('div'); room.append(options.host)
      this.roomCard = this.inspector.addCard('room', 'Room', room, () => options.hostSummary?.() ?? '')
    }

    this.gear.addEventListener('click', () => { if (this.shown) this.close(); else this.open() }, { signal })
    // Tap outside closes; that tap does nothing else (it does not also pick a planet).
    const outside = (event: Event) => {
      if (!this.shown) return
      const target = event.target as Node
      if (this.host.contains(target) || this.dock.contains(target)) return
      event.preventDefault(); event.stopPropagation()
      if (event.type === 'pointerdown') this.close()
    }
    for (const type of ['pointerdown', 'click'] as const) window.addEventListener(type, outside, { capture: true, signal })
    window.addEventListener('resize', () => { if (this.shown) this.fit() }, { signal })
    window.addEventListener('keydown', event => {
      if (!this.shown) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return }
      if (event.key === 'Tab') {
        // The panel owns Tab while open; the lobby's own trap would pull focus back to the galaxy.
        const next = cycleFocus(this.focusable(), document.activeElement as HTMLElement | null, event.shiftKey)
        event.preventDefault(); event.stopImmediatePropagation(); next?.focus()
      }
    }, { capture: true, signal })
  }

  get isOpen(): boolean { return this.shown }

  /** A quiet mark on the Updates icon while a newer version is out. */
  markUpdate(version: string | null): void {
    const on = version !== null
    this.updates.classList.toggle('has-update', on)
    this.updates.setAttribute('aria-label', on ? 'Updates, a newer version is out' : 'Updates')
    this.updates.title = on ? 'Updates: a newer version is out' : 'Updates'
  }

  private focusable(): HTMLElement[] {
    return [...this.inspector.element.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0)
  }

  open(): void {
    if (this.shown) return
    this.shown = true; this.closing?.cancel(); this.closing = undefined
    this.options.cue?.(); this.options.opening?.()
    this.parent.append(this.host)
    this.inspector.rebuild(); this.update()
    // Glass never nests: the card is the one glass surface, so the in-game cards' own glass
    // marks (the phone close x in each card head) are plain here.
    for (const el of this.inspector.element.querySelectorAll('.liquid-glass')) el.classList.remove('liquid-glass', 'glass-round')
    this.fit()
    this.gear.setAttribute('aria-expanded', 'true'); this.gear.classList.add('is-current'); this.dock.classList.add('is-open')
    // It rises out of Settings, below it (lobby-settings.css sets the origin at its foot).
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.inspector.element.animate([{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }
    this.inspector.element.querySelector<HTMLElement>('.lobby-settings-close')!.focus({ preventScroll: true })
  }

  /** `returnFocus` false: something else is taking over (a sheet opening) and owns focus. */
  close(returnFocus = true): void {
    if (!this.shown) return
    this.shown = false
    this.inspector.hideTooltip()
    this.gear.setAttribute('aria-expanded', 'false'); this.gear.classList.remove('is-current'); this.dock.classList.remove('is-open')
    if (returnFocus) this.gear.focus({ preventScroll: true })
    const detach = () => { if (!this.shown) this.host.remove() }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { detach(); return }
    this.closing = this.inspector.element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.98)' }], { duration: 160, easing: 'ease-in' })
    this.closing.onfinish = detach
  }

  /**
   * Desktop: the card stands on Settings and grows upward as its sections open, so cap its height
   * where it would reach the wordmark (the owner's logo stays whole); taller contents scroll
   * inside. Where the wordmark does not reach over the card's column, the screen's top edge is
   * the cap. Phones place the card themselves.
   */
  private fit(): void {
    const card = this.inspector.element
    if (matchMedia(PHONE).matches) { card.style.removeProperty('max-height'); return }
    const box = card.getBoundingClientRect(), mark = this.options.ceiling?.() ?? null
    const over = mark && mark.right > box.left - 8 && mark.left < box.right + 8
    const top = over ? mark.bottom + 16 : parseFloat(getComputedStyle(card).getPropertyValue('--edge-top')) || 28
    card.style.maxHeight = `${Math.max(180, Math.floor(box.bottom - top))}px`
  }

  /** Refresh summaries while open; call from the shell's update. */
  update(): void {
    if (!this.shown) return
    // Card styles set display, so the attribute alone would not hide it.
    if (this.roomCard) { const hide = !(this.options.inRoom?.() ?? true); if (this.roomCard.hidden !== hide) { this.roomCard.hidden = hide; this.roomCard.style.display = hide ? 'none' : '' } }
    this.inspector.update()
  }

  dispose(): void { this.abort.abort(); this.performance.dispose(); this.inspector.dispose(); this.host.remove(); this.dock.remove() }
}
