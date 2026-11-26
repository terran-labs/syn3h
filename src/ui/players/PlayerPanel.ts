/**
 * The player panel (the owner, 25 November 2026): click any player or bot in the Players &
 * session card and a panel opens to the left of the sidebar, level with that row. A person's
 * panel shows their vehicle, device and place (never finer than a region), whether they host or
 * are paused, and the controls for them: Mute for me and Mute for everyone side by side, and
 * Eject. A bot's panel shows its personality as sliders. On a phone, where there is no room to
 * the left, it takes the sidebar's place as the one open card.
 *
 * Controls a viewer may not use are shown disabled with the reason (the server's moderation
 * rule, shared/moderation.ts, through `actions.moderation`), never hidden, except on your own
 * panel, which shows only what others see about you. The panel is a non-modal dialog: Escape,
 * a click outside, the x or a second click on the row close it and focus returns to the row.
 * No slide; nothing already on screen moves.
 *
 * With a mouse it is also a tooltip (the owner: "on desktop, can you have these panels open with
 * tooltips"): resting on a row for HOVER_MS opens it beside the row with a pointer toward it; it
 * stays while the pointer is on the row or the panel and closes LEAVE_MS after it leaves both,
 * long enough to cross the gap. Moving down the list moves it from row to row at once. A click
 * pins it open; touch and keyboard always open it pinned.
 */
import './player-panel.css'
import { CARD_CLOSE } from '../cardClose'
import { resetButton, type ResetButton } from '../resetControl'
import { vehicleIcon, vehicleGlyph, mutedIcon, slottedName } from './icons'
import { deviceName, placeName } from './rowLabel'
import { EjectDialog, type BanishStop } from './EjectDialog'
import type { SessionPlayer } from '../Scoreboard'

/** The bot personality traits that exist today (src/bots/mind/personality.ts), in its order. */
export const BOT_TRAITS = [
  { key: 'boldness', label: 'Boldness', says: 'Speed, late braking, steep ground, the summit.' },
  { key: 'curiosity', label: 'Curiosity', says: 'Unvisited places over familiar ones.' },
  { key: 'sociability', label: 'Sociability', says: 'Seeks other vehicles: convoys, tailing, pestering.' },
  { key: 'mischief', label: 'Mischief', says: 'Donuts, weaving, showing off.' },
  { key: 'patience', label: 'Patience', says: 'Sticks with a plan and with roads.' },
] as const
export type BotTrait = (typeof BOT_TRAITS)[number]['key']
export type BotTraits = Record<BotTrait, number>

/** The archetype word for the strongest trait, as personality.ts names it. */
const ARCHETYPE: Record<BotTrait, string> = { boldness: 'a daredevil', curiosity: 'an explorer', sociability: 'a shadow', mischief: 'a trickster', patience: 'a cruiser' }
export function archetypeOf(values: BotTraits): string {
  let best: BotTrait = 'curiosity', top = -1
  for (const { key } of BOT_TRAITS) if (values[key] > top) { top = values[key]; best = key }
  return ARCHETYPE[best]
}

/** Why a moderation control is or is not available (shared/moderation.ts canModerate). */
export type ModerationReason = 'creator' | 'host-private' | 'not-host' | 'public-world' | 'self' | 'target-creator' | 'unknown'
export interface Moderation { ok: boolean; reason: ModerationReason }

/** The words under a control a viewer may not use, by the rule's reason and the control. */
export function moderationWords(reason: ModerationReason, control: 'mute' | 'eject' | 'traits'): string {
  switch (reason) {
    case 'public-world': return "Only Mira's creator can, in a public world."
    case 'target-creator': return control === 'traits' ? 'Not available.' : "Mira's creator cannot be muted or ejected."
    case 'not-host': return control === 'mute' ? 'Only the host can mute for everyone.' : control === 'eject' ? 'Only the host can eject.' : 'Only the host can change these.'
    case 'self': return ''
    default: return 'Not available right now.'
  }
}

export interface PlayerPanelActions {
  /** Mute for me: hide their chat on this screen (src/net/chat.ts). */
  muteForMe(id: number, muted: boolean): void
  /** Mute for everyone: the room's mute (moderators). */
  muteForAll(id: number, muted: boolean): void
  /** May this viewer moderate that player or bot? */
  moderation(id: number): Moderation
  /** Eject a player (with a banish) or remove a bot. */
  eject(id: number, stop: BanishStop): void
  /**
   * A bot's effective traits, which are overridden, and its own nature (the values before any
   * override) when the room knows them, or null when unknown.
   */
  botTraits(id: number): { values: BotTraits; overridden: readonly BotTrait[]; nature?: Partial<BotTraits> } | null
  /** Set a trait (0..1), or reset it to the bot's own nature with null. */
  setBotTrait(id: number, trait: BotTrait, value: number | null): void
  /** Whether I share my place (the "Show my location" switch, Me), for my own panel's note. */
  sharesLocation(): boolean
  /** The phone layout is on: the panel takes the sidebar's place. */
  phone(): boolean
  /** aria-expanded on the rows follows the panel. */
  changed(): void
}

/** The sidebar edge the panel stands off, px. */
const GAP = 12
/** Resting on a row this long opens its tooltip, ms. */
export const HOVER_MS = 250
/** The tooltip closes this long after the pointer leaves the row and the panel, ms. */
export const LEAVE_MS = 300
const MARGIN = 8

export class PlayerPanel {
  readonly element = document.createElement('section')
  readonly dialog: EjectDialog
  private id: number | null = null
  private anchor: HTMLButtonElement | null = null
  private player: SessionPlayer | null = null
  private shape = ''
  private dragging = false
  /** Opened by a click, tap or key: stays until closed. Otherwise it is a hover tooltip. */
  private pinned = false
  private hoverTimer = 0
  private leaveTimer = 0
  private players: () => readonly SessionPlayer[] | undefined = () => undefined
  private readonly body = document.createElement('div')
  private readonly arrow = document.createElement('span')
  private resets = new Map<BotTrait, ResetButton>()

  constructor(private readonly host: HTMLElement, private readonly sidebar: () => HTMLElement | null, private readonly actions: PlayerPanelActions) {
    const el = this.element
    el.id = 'player-panel'
    el.className = 'player-panel'
    el.hidden = true
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false')
    this.body.className = 'pp-body'
    this.arrow.className = 'pp-arrow'; this.arrow.setAttribute('aria-hidden', 'true')
    el.append(this.arrow, this.body)
    host.append(el)
    el.addEventListener('pointerenter', () => clearTimeout(this.leaveTimer))
    el.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') this.leave() })
    // Using the panel pins it, so it does not vanish while a slider is dragged.
    el.addEventListener('pointerdown', () => { this.pinned = true })
    el.addEventListener('focusin', () => { this.pinned = true })
    el.addEventListener('pointerup', () => { this.dragging = false })
    this.dialog = new EjectDialog(host)
    document.addEventListener('pointerdown', event => {
      if (el.hidden || this.dialog.open) return
      const target = event.target as Element
      // The row's own click toggles (pick); anything else outside closes, returning focus.
      if (el.contains(target) || target.closest?.('.score-row.is-rich')) return
      this.close(false)
    }, { capture: true })
    window.addEventListener('resize', () => { if (!el.hidden) this.place() })
  }

  get openId(): number | null { return this.id }

  /**
   * Escape (Shell's key handler, which runs first): cancel the eject dialog, else close the
   * panel. True when it used the key.
   */
  escape(): boolean {
    if (this.dialog.open) { this.dialog.close(); return true }
    if (!this.element.hidden) { this.close(); return true }
    return false
  }

  /** Where the current roster comes from (Shell), for hover opening. */
  setRoster(players: () => readonly SessionPlayer[] | undefined): void { this.players = players }

  /**
   * A row was clicked, tapped or pressed: open its panel pinned; pin a hover tooltip already
   * showing it; close it when it is already pinned open.
   */
  pick(id: number, anchor: HTMLButtonElement, keyboard = false): void {
    clearTimeout(this.hoverTimer); clearTimeout(this.leaveTimer)
    if (this.id === id && !this.element.hidden) {
      if (this.pinned) { this.close(); return }
      this.pinned = true; this.element.classList.add('is-pinned')
      return
    }
    if (!this.show(id, anchor, true)) return
    if (keyboard) this.element.querySelector<HTMLElement>('.pp-close')?.focus()
  }

  /** The mouse came onto a row (Scoreboard): open its tooltip after a rest, or at once when one is showing. */
  hoverRow(id: number, anchor: HTMLButtonElement): void {
    clearTimeout(this.leaveTimer); clearTimeout(this.hoverTimer)
    if (this.pinned || this.dialog.open || this.dragging) return
    if (this.id === id && !this.element.hidden) return
    if (!this.element.hidden) { this.show(id, anchor, false); return }
    this.hoverTimer = window.setTimeout(() => {
      if (!this.pinned && !this.dialog.open && !this.dragging && anchor.isConnected) this.show(id, anchor, false)
    }, HOVER_MS)
  }

  /** The mouse left a row or the panel: close the tooltip unless it reaches the other. */
  leave(): void {
    clearTimeout(this.hoverTimer)
    if (this.pinned || this.element.hidden) return
    clearTimeout(this.leaveTimer)
    this.leaveTimer = window.setTimeout(() => { if (!this.pinned && !this.dialog.open && !this.dragging) this.close(false) }, LEAVE_MS)
  }

  private show(id: number, anchor: HTMLButtonElement, pinned: boolean): boolean {
    const player = this.players()?.find(p => p.id === id)
    if (!player) return false
    if (this.id !== id) this.shape = ''
    this.id = id; this.anchor = anchor; this.player = player; this.pinned = pinned
    this.element.classList.toggle('is-pinned', pinned)
    this.element.hidden = false
    this.render()
    this.place()
    this.actions.changed()
    return true
  }

  /** The roster changed: refresh what is shown, or close when that player has gone. */
  update(players: readonly SessionPlayer[] | undefined, anchorFor: (id: number) => HTMLButtonElement | null): void {
    if (this.id === null || this.element.hidden) return
    const player = players?.find(p => p.id === this.id)
    if (!player) { this.close(false); return }
    this.player = player
    this.anchor = anchorFor(player.id) ?? this.anchor
    this.render()
    this.place()
  }

  close(restore = true): void {
    clearTimeout(this.hoverTimer); clearTimeout(this.leaveTimer)
    if (this.element.hidden) return
    this.dialog.close(false)
    this.element.hidden = true
    this.sidebar()?.classList.remove('is-under-sheet')
    const anchor = this.anchor
    this.id = null; this.player = null; this.anchor = null; this.pinned = false; this.dragging = false
    this.actions.changed()
    if (restore && anchor?.isConnected) anchor.focus()
  }

  /** Level with the row, to the left of the sidebar; on a phone, over the sidebar itself. */
  private place(): void {
    const el = this.element, bar = this.sidebar()?.getBoundingClientRect()
    const phone = this.actions.phone()
    el.classList.toggle('is-sheet', phone)
    this.sidebar()?.classList.toggle('is-under-sheet', phone)
    if (!bar) return
    if (phone) {
      Object.assign(el.style, { left: `${bar.left}px`, top: `${bar.top}px`, width: `${bar.width}px`, maxHeight: `${bar.height}px`, right: '' })
      return
    }
    const row = this.anchor?.closest('.score-row')?.getBoundingClientRect()
    el.style.width = ''; el.style.left = ''
    el.style.right = `${Math.max(MARGIN, innerWidth - bar.left + GAP)}px`
    el.style.maxHeight = `${innerHeight - 2 * MARGIN}px`
    const height = el.offsetHeight
    const top = Math.max(MARGIN, Math.min(Math.max(MARGIN, (row?.top ?? bar.top) - 10), innerHeight - MARGIN - height))
    el.style.top = `${top}px`
    // The pointer stays level with the row's middle, within the panel's rounded corners.
    const middle = row ? row.top + row.height / 2 - top : 24
    el.style.setProperty('--arrow-y', `${Math.min(Math.max(18, middle), height - 18)}px`)
  }

  private render(): void {
    const p = this.player!
    const mod = p.self ? { ok: false, reason: 'self' as const } : this.actions.moderation(p.id)
    const traits = p.bot ? this.actions.botTraits(p.id) : null
    // Rebuild only when what the panel is made of changes; otherwise sync values in place, so
    // a slider being dragged or a focused button keeps its focus.
    const shape = JSON.stringify([p.id, p.self, p.bot, p.name, p.kind, mod.ok, mod.reason, Boolean(traits)])
    if (shape !== this.shape) { this.shape = shape; this.build(p, mod, Boolean(traits)) }
    this.sync(p, mod, traits)
  }

  private build(p: SessionPlayer, mod: Moderation, hasTraits: boolean): void {
    const el = this.body
    el.replaceChildren(); this.resets.clear()
    this.element.setAttribute('aria-label', p.self ? 'What others see about you' : `About ${p.name}`)

    const head = document.createElement('header'); head.className = 'pp-head'
    // The name with the same mark as its row; the vehicle silhouette at the head's far edge.
    const icon = vehicleIcon(p.kind, 'pp-vehicle')
    const title = document.createElement('h2'); title.className = 'pp-name'
    title.append(...slottedName(p))
    const sub = document.createElement('p'); sub.className = 'pp-sub'
    const close = document.createElement('button')
    close.type = 'button'; close.className = 'pp-close card-close'; close.setAttribute('aria-label', 'Close'); close.innerHTML = CARD_CLOSE
    close.addEventListener('click', () => this.close())
    head.append(title, ...(icon ? [icon] : []), close, sub)
    el.append(head)

    if (!p.bot) {
      const facts = document.createElement('dl'); facts.className = 'pp-facts'
      for (const [key, label] of [['device', 'Device'], ['place', 'Location'], ['status', 'Status']]) {
        const dt = Object.assign(document.createElement('dt'), { textContent: label })
        const dd = document.createElement('dd'); dd.dataset.fact = key
        facts.append(dt, dd)
      }
      el.append(facts)
      // Profile and social links will live here; nothing is collected yet, so nothing shows.
      const profile = document.createElement('div'); profile.className = 'pp-profile'; profile.hidden = true
      el.append(profile)
    }

    if (p.self) {
      el.append(Object.assign(document.createElement('p'), { className: 'pp-note', textContent: 'This is what other players see about you.' }))
      return
    }

    if (p.bot && hasTraits) el.append(this.traitSection(p, mod))

    if (!p.bot) {
      // Mute: two toggles side by side; Mute for me is everyone's, Mute for everyone the host's.
      const line = this.line('Mute', 'pp-mute')
      const pair = document.createElement('div'); pair.className = 'pp-pair'
      const forMe = this.toggle('For me', 'me', on => this.actions.muteForMe(p.id, on))
      const forAll = this.toggle('For everyone', 'all', on => this.actions.muteForAll(p.id, on))
      forAll.disabled = !mod.ok
      pair.append(forMe, forAll)
      line.append(pair,
        Object.assign(document.createElement('p'), { className: 'pp-why', textContent: 'For me hides their chat on your screen only.' }),
        Object.assign(document.createElement('p'), { className: 'pp-why', textContent: mod.ok ? 'For everyone silences their chat for the whole world.' : moderationWords(mod.reason, 'mute') }))
      el.append(line)
    }

    const eject = this.line(p.bot ? 'Remove' : 'Eject', 'pp-eject')
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'panel-action pp-eject-go', textContent: p.bot ? 'Remove…' : 'Eject…' })
    go.disabled = !mod.ok
    go.setAttribute('aria-haspopup', 'dialog')
    go.addEventListener('click', () => {
      if (go.disabled) return
      this.dialog.show({ id: p.id, name: p.name, bot: Boolean(p.bot) }, stop => { this.actions.eject(p.id, stop); this.close() }, go)
    })
    eject.querySelector('.pp-line-head')!.append(go)
    eject.append(Object.assign(document.createElement('p'), {
      className: 'pp-why',
      textContent: mod.ok ? (p.bot ? 'Takes this bot out of the world.' : 'Sends them back to the lobby.') : moderationWords(mod.reason, 'eject'),
    }))
    el.append(eject)
  }

  private line(title: string, className: string): HTMLElement {
    const line = document.createElement('div'); line.className = `pp-line ${className}`
    const head = document.createElement('div'); head.className = 'pp-line-head'
    head.append(Object.assign(document.createElement('span'), { className: 'pp-line-title', textContent: title }))
    line.append(head)
    return line
  }

  private toggle(text: string, which: string, run: (on: boolean) => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'panel-action pp-toggle'; b.dataset.mute = which
    b.setAttribute('aria-pressed', 'false')
    b.append(mutedIcon(), Object.assign(document.createElement('span'), { textContent: text }))
    b.addEventListener('click', () => { if (!b.disabled) run(b.getAttribute('aria-pressed') !== 'true') })
    return b
  }

  private traitSection(p: SessionPlayer, mod: Moderation): HTMLElement {
    const section = document.createElement('div'); section.className = 'pp-traits'
    const head = document.createElement('div'); head.className = 'pp-traits-head'
    head.append(Object.assign(document.createElement('span'), { className: 'pp-line-title', textContent: 'Personality' }))
    section.append(head)
    if (!mod.ok) section.append(Object.assign(document.createElement('p'), { className: 'pp-why', textContent: moderationWords(mod.reason, 'traits') }))
    for (const trait of BOT_TRAITS) {
      const row = document.createElement('div'); row.className = 'pp-trait'; row.dataset.trait = trait.key
      const id = `pp-trait-${trait.key}`
      const label = Object.assign(document.createElement('label'), { htmlFor: id, textContent: trait.label })
      const out = document.createElement('output'); out.htmlFor.add(id)
      // The shared reset (resetControl.ts): its place held, live only while overridden.
      const reset = resetButton(() => this.actions.setBotTrait(p.id, trait.key, null), 'pp-reset')
      this.resets.set(trait.key, reset)
      const input = Object.assign(document.createElement('input'), { type: 'range', id, min: '0', max: '100', step: '1' })
      input.disabled = !mod.ok
      input.setAttribute('aria-describedby', `${id}-says`)
      input.addEventListener('pointerdown', () => { this.dragging = true; this.pinned = true })
      input.addEventListener('change', () => { this.dragging = false })
      input.addEventListener('input', () => {
        if (input.disabled) return
        out.value = input.value
        this.actions.setBotTrait(p.id, trait.key, Number(input.value) / 100)
      })
      const says = Object.assign(document.createElement('p'), { className: 'pp-why', id: `${id}-says`, textContent: trait.says })
      row.append(label, out, reset.element, input, says)
      // On touch, nothing hovers: the reset writes the default under its arrow while the row is touched.
      row.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') row.classList.add('is-selected') })
      for (const type of ['pointerup', 'pointercancel'] as const) row.addEventListener(type, () => window.setTimeout(() => row.classList.remove('is-selected'), 1500))
      section.append(row)
    }
    return section
  }

  /** Values that change without changing the panel's make-up. */
  private sync(p: SessionPlayer, mod: Moderation, traits: ReturnType<PlayerPanelActions['botTraits']>): void {
    const el = this.element
    const vehicle = vehicleGlyph(p.kind)?.label
    const sub = el.querySelector<HTMLElement>('.pp-sub')!
    const subText = p.bot
      ? [vehicle, 'Bot', traits ? archetypeOf(traits.values) : ''].filter(Boolean).join(' · ')
      : [vehicle, p.host ? 'Host' : ''].filter(Boolean).join(' · ')
    if (sub.textContent !== subText) sub.textContent = subText
    const fact = (key: string, text: string) => {
      const dd = el.querySelector<HTMLElement>(`dd[data-fact="${key}"]`)
      if (dd && dd.textContent !== text) dd.textContent = text
    }
    fact('device', deviceName(p) || 'Unknown')
    const place = placeName(p, true)
    fact('place', place || (p.self && !this.actions.sharesLocation() ? 'Hidden' : 'Not shown'))
    fact('status', [p.host ? 'Host' : '', p.paused ? 'Paused' : 'Playing'].filter(Boolean).join(' · '))
    for (const b of el.querySelectorAll<HTMLButtonElement>('.pp-toggle')) {
      const on = b.dataset.mute === 'all' ? Boolean(p.mutedForAll) : p.muted
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on))
    }
    if (traits) for (const trait of BOT_TRAITS) {
      const row = el.querySelector<HTMLElement>(`.pp-trait[data-trait="${trait.key}"]`)
      if (!row) continue
      const input = row.querySelector('input')!, out = row.querySelector('output')!, reset = this.resets.get(trait.key)
      const value = String(Math.round(traits.values[trait.key] * 100))
      if (!(this.dragging && document.activeElement === input) && input.value !== value) { input.value = value; out.value = value }
      if (!out.value) out.value = value
      const nature = traits.nature?.[trait.key]
      reset?.set({ changed: traits.overridden.includes(trait.key), defaultText: nature === undefined ? 'its nature' : String(Math.round(nature * 100)), name: trait.label })
      if (reset) reset.element.disabled = !mod.ok
    }
  }
}
