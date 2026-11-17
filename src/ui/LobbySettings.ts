/**
 * The lobby's settings: a floating holographic gear in a lower corner of the galaxy, with the
 * running version beside it and the About and Updates icons stacked above it (the shell opens
 * their sheets), that slides a settings panel in from that edge. The panel is the
 * in-game sidebar's own component (an Inspector showing only the cards added here), so the
 * cards, rows, accordion motion and glass are the same and cannot drift:
 *
 *   Sound     music and master volume and mute, then an Advanced fold with every other audio
 *             setting (effects, engine, ground rumble, wind, ambience, other vehicles, cues and
 *             whatever audio setting is defined later).
 *   Graphics  the in-game Performance card's quality controls (a second PerformancePanel on the
 *             same quality controller), without the in-world frame diagnostics.
 *   Controls  left-handed touch, look sensitivity, daydream, and presentation mode.
 *   Room      the host's lock and reset, when the shell supplies them.
 *
 * Tap outside or Escape closes it; focus stays inside while it is open and returns to the gear.
 * Closed, the panel is detached from the page, so the in-game rail stays the only
 * `.world-inspector` element there.
 */
import { params } from '../../shared/params'
import type { QualitySource } from '../core/quality'
import { createFrozenResourceResolver } from '../core/frozenResources'
import { Inspector } from './inspector/Inspector'
import type { PropertyDef } from './inspector/model'
import { PerformancePanel } from './PerformancePanel'
import { SOUND_STARTED, soundWaiting } from '../audio/unlock'
import './lobby-settings.css'

/** Sound settings shown before the Advanced fold, in this order. */
export const SOUND_MAIN = ['audio.music', 'audio.master', 'audio.muted'] as const
/** Personal control settings, in this order. Missing ones are skipped. */
export const CONTROL_IDS = ['touch.leftHanded', 'camera.sensitivity', 'daydream.seconds'] as const

/** Split the Audio group: the main rows, and everything else for the Advanced fold. */
export function soundRows(defs: readonly PropertyDef[]): { main: PropertyDef[]; advanced: PropertyDef[] } {
  const audio = defs.filter(def => def.group === 'Audio')
  const main = SOUND_MAIN.map(id => audio.find(def => def.id === id)).filter((def): def is PropertyDef => !!def)
  return { main, advanced: audio.filter(def => !main.includes(def)) }
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

/** About: an i in the ring, drawn as strokes like the gear. */
export const ABOUT_ICON = 'M12 10.6V17.4M10.2 17.4H13.8M10.6 10.6H12M12 6.4a.9 .9 0 1 0 .01 0Z'
/** Updates: a turning arrow round a clock's hands, for what changed and when. */
export const UPDATES_ICON = 'M18.6 12a6.6 6.6 0 1 1-1.93-4.67M17.4 3.9v3.6h-3.6M12 8.4V12l2.6 1.6'

export interface LobbySettingsOptions {
  quality?: QualitySource
  /** Elements the shell already wires, moved into cards: presentation toggle and host fieldset. */
  presentation?: HTMLElement
  host?: HTMLElement
  hostSummary?(): string
  /** Whether there is a room with something to act on (host, or open sliders); the Room card shows only then. */
  inRoom?(): boolean
  /** The build constant; see versionLabel. */
  build?: string
  /** A click cue. */
  cue?(): void
}

export class LobbySettings {
  /** The gear and the version beside it, for the lobby to place. */
  readonly dock = document.createElement('div')
  readonly gear = document.createElement('button')
  /**
   * The running version beside the gear. A stable hook for the Updates view in About: find it
   * by `[data-lobby-version]` and listen for its click. It does nothing until something does.
   */
  readonly version = document.createElement('button')
  /** About and Updates, stacked above the gear. The shell wires their clicks to its sheets. */
  readonly about = document.createElement('button')
  readonly updates = document.createElement('button')
  /** Holds the panel and its tooltip; attached to the page only while open. */
  private readonly host = document.createElement('div')
  private readonly inspector: Inspector
  private readonly performance: PerformancePanel
  private readonly abort = new AbortController()
  private shown = false
  private closing?: Animation
  private readonly advancedOpen = { value: false }
  private roomCard?: HTMLElement

  constructor(private readonly parent: HTMLElement, private readonly options: LobbySettingsOptions = {}) {
    const signal = this.abort.signal
    const label = versionLabel(options.build, location.href)
    this.dock.className = 'lobby-gear-dock'
    this.gear.type = 'button'; this.gear.className = 'lobby-gear'
    this.gear.setAttribute('aria-label', 'Settings'); this.gear.setAttribute('aria-expanded', 'false'); this.gear.setAttribute('aria-controls', 'lobby-settings')
    this.gear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${gearPath()}"/></svg>`
    this.version.type = 'button'; this.version.className = 'lobby-version'; this.version.dataset.lobbyVersion = ''
    this.version.textContent = label; this.version.title = `Version ${label}`; this.version.setAttribute('aria-label', `Version ${label}`)
    for (const [button, name, path] of [[this.about, 'About Syn3h', ABOUT_ICON], [this.updates, 'Updates', UPDATES_ICON]] as const) {
      button.type = 'button'; button.className = `lobby-dock-icon lobby-${name === 'Updates' ? 'updates' : 'about'}`
      button.setAttribute('aria-label', name); button.setAttribute('aria-haspopup', 'dialog'); button.title = name
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`
    }
    this.dock.append(this.about, this.updates, this.gear, this.version)

    this.host.className = 'lobby-settings-host'
    this.inspector = new Inspector(this.host, { summary: () => '', vehicles: () => ({ options: [], current: '' }), onVehicle() {}, sections: [], percent: isVolume })
    const panel = this.inspector.element
    panel.classList.add('lobby-settings'); panel.id = 'lobby-settings'
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Settings')
    const head = document.createElement('header'); head.className = 'lobby-settings-head wi-glass'
    head.innerHTML = '<h2>Settings</h2><button type="button" class="lobby-settings-close" aria-label="Close settings"><span aria-hidden="true">×</span><span class="lobby-settings-close-text">Close</span></button>'
    // The world tools (search, copy, paste, reset world) belong to a world, not the lobby.
    panel.querySelector('.wi-top')?.remove()
    panel.querySelector('.wi-cards')!.before(head)
    const foot = document.createElement('footer'); foot.className = 'lobby-settings-foot'
    const build = document.createElement('span'); build.className = 'build-line'; build.textContent = `Version ${label}`
    foot.append(build); panel.append(foot)
    head.querySelector('.lobby-settings-close')!.addEventListener('click', () => this.close(), { signal })

    // Sound: the two volumes and mute up front, every other audio setting in Advanced.
    const sound = document.createElement('div')
    this.inspector.addCard('sound', 'Sound', sound, () => `Music ${percent('audio.music')} · Master ${percent('audio.master')}${params.get('audio.muted')?.value ? ' · Muted' : ''}${soundWaiting() ? ' · Tap to start sound' : ''}`, {
      fill: () => {
        const { main, advanced } = soundRows(params.all().map(p => p.def as PropertyDef))
        const fold = document.createElement('details'); fold.className = 'wi-group lobby-advanced'; fold.open = this.advancedOpen.value
        fold.innerHTML = '<summary><span>Advanced</span><small></small></summary>'; fold.querySelector('small')!.textContent = String(advanced.length)
        fold.addEventListener('toggle', () => { this.advancedOpen.value = fold.open })
        for (const def of advanced) fold.append(this.inspector.row(def))
        const note = document.createElement('p'); note.className = 'wi-blurb'
        note.textContent = 'The music is generated as you play and follows what you do. It starts with your first click or key press.'
        sound.replaceChildren(...main.map(def => this.inspector.row(def)), fold, note)
      },
    })
    // The browser holds sound until a first gesture; the summary says so quietly until it starts.
    window.addEventListener(SOUND_STARTED, () => this.inspector.update(), { signal })
    // Graphics: the in-game Performance card on the same quality controller.
    this.performance = new PerformancePanel(this.host, () => {}, options.quality, this.inspector)
    const graphics = panel.querySelector<HTMLElement>(`.wi-card[data-section="${PerformancePanel.CARD}"]`)
    if (graphics) {
      graphics.classList.add('lobby-graphics'); graphics.querySelector('h3')!.textContent = 'Graphics'
      // Frame history and renderer diagnostics describe a world in play: not shown here.
      graphics.querySelector('.performance-diagnostics')?.remove()
    }
    // Controls: personal control settings, then presentation mode.
    const controls = document.createElement('div')
    this.inspector.addCard('controls', 'Controls', controls, () => {
      const parts = [params.get('touch.leftHanded')?.value ? 'Left-handed' : 'Right-handed']
      const sensitivity = params.get('camera.sensitivity'); if (sensitivity) parts.push(`Look ${sensitivity.value}`)
      return parts.join(' · ')
    }, {
      fill: () => {
        const rows = CONTROL_IDS.map(id => params.get(id)).filter(p => !!p).map(p => this.inspector.row(p!.def as PropertyDef))
        controls.replaceChildren(...rows, ...(options.presentation ? [options.presentation] : []))
      },
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
    this.options.cue?.()
    this.parent.append(this.host)
    this.inspector.rebuild(); this.update()
    this.gear.setAttribute('aria-expanded', 'true'); this.dock.classList.add('is-open')
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.inspector.element.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }
    this.inspector.element.querySelector<HTMLElement>('.lobby-settings-close')!.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.shown) return
    this.shown = false
    this.inspector.hideTooltip()
    this.gear.setAttribute('aria-expanded', 'false'); this.dock.classList.remove('is-open')
    this.gear.focus({ preventScroll: true })
    const detach = () => { if (!this.shown) this.host.remove() }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { detach(); return }
    this.closing = this.inspector.element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 160, easing: 'ease-in' })
    this.closing.onfinish = detach
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
