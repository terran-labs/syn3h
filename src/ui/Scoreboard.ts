import { chatLink } from './chat/chatLink'
import { markedName, type MarkedPlayer } from './playerMarks'
import { labelLevel, rowLabels, type PlayerWhereabouts } from './players/rowLabel'
import { mutedIcon, slottedName, vehicleIcon } from './players/icons'
export interface ScoreRow { name: string; score: number; self: boolean; it: boolean; flags: string }
/** Preserve networking's text API; parse only its explicit row markers and score column. */
export function parseScoreRow(line: string): ScoreRow | null {
  const match = /^([ >])\s+(.+?)\s+(-?\d+)\s{2,}((?:(?:\[IT\]|\[KING\]|\(you\)|\(host\)|\(out\)|\(stuck\)|\(paused\)|\(not responding\))\s*)*)$/.exec(line)
  if (!match) return null
  return { name: match[2].trim(), score: Number(match[3]), self: match[4].includes('(you)'), it: match[1] === '>' || match[4].includes('[IT]'), flags: match[4].trim() }
}
/** Everyone in the room as their names are shown (main.ts, from the room's roster). */
export interface RosterPlayer extends MarkedPlayer, PlayerWhereabouts {
  id: number
  /** The vehicle they drive (shared/protocol.ts WireVehicleKind). */
  kind?: string
  /** Muted for everyone by a moderator: the room's mute, shown to all. */
  mutedForAll?: boolean
  /** Mira's creator (feat/creator-badge). */
  role?: 'creator'
}
export type PlayerRoster = () => readonly RosterPlayer[]

export interface SessionPlayer extends RosterPlayer {
  score: number
  self: boolean
  host: boolean
  it: boolean
  king: boolean
  paused: boolean
  /** Muted for me: this screen hides their chat (src/net/chat.ts). Only the muter sees it. */
  muted: boolean
}

/**
 * The Players & session card's richer rows (ui/player-panel): each row opens the player panel,
 * and carries the device and place label, the muted speaker and the vehicle silhouette. The
 * HUD's boards share this class without it.
 */
export interface RowPanel {
  /** A row was clicked, tapped or pressed: open, pin or close that player's panel. */
  pick(id: number, button: HTMLButtonElement, keyboard: boolean): void
  /** The mouse rests on a row (the desktop tooltip). */
  hoverRow(id: number, button: HTMLButtonElement): void
  /** The mouse left a row. */
  leave(): void
  /** The player whose panel is open, for aria-expanded. */
  openId(): number | null
}

interface DisplayRow extends ScoreRow {
  player?: RosterPlayer
  paused: boolean
  muted: boolean
  mutedForAll: boolean
}

export class Scoreboard {
  private detailSignature: string | undefined
  private rowLines: string | undefined
  private players?: readonly SessionPlayer[]
  private previousEvents = new Set<string>()
  private rows = new Map<string, { element: HTMLElement; label: string }>()

  private fitQueued = 0
  private readonly measure = document.createElement('canvas').getContext('2d')

  constructor(private readonly host: HTMLElement, private readonly notify: (text: string) => void, private readonly panel?: RowPanel) {
    host.addEventListener('click', (event) => {
      if (panel) {
        // Anywhere on a player's row opens their panel; the name is the row's real button.
        const row = (event.target as Element).closest<HTMLElement>('.score-row.is-rich')
        const button = row?.querySelector<HTMLButtonElement>('button.score-name')
        // detail 0: Enter or Space on the focused name, not a pointer.
        if (button) panel.pick(Number(button.dataset.id), button, (event as MouseEvent).detail === 0)
        return
      }
      // The local text mute menu, from a name on a board without the panel.
      const name = (event.target as Element).closest<HTMLButtonElement>('button.score-name')
      if (name) chatLink.openPersonMenu(Number(name.dataset.id), name, name.dataset.name ?? '')
    })
    if (panel) {
      host.addEventListener('pointerover', event => {
        if (event.pointerType !== 'mouse') return
        const button = (event.target as Element).closest('.score-row.is-rich')?.querySelector<HTMLButtonElement>('button.score-name')
        if (button) panel.hoverRow(Number(button.dataset.id), button)
      })
      host.addEventListener('pointerout', event => {
        if (event.pointerType !== 'mouse') return
        const from = (event.target as Element).closest('.score-row.is-rich')
        if (from && !from.contains(event.relatedTarget as Node | null)) panel.leave()
      })
    }
    // The sidebar is resizable: the label is chosen by the width each row actually has.
    if (panel && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.queueFit()).observe(host)
  }

  /** The name button of a player's row in this board, if shown. */
  nameButton(id: number): HTMLButtonElement | null {
    return this.host.querySelector<HTMLButtonElement>(`.score-row.is-rich > button.score-name[data-id="${id}"]`)
  }

  /** aria-expanded follows the open panel (PlayerPanel calls this as it opens and closes). */
  syncExpanded(): void {
    const open = this.panel?.openId() ?? null
    for (const button of this.host.querySelectorAll<HTMLButtonElement>('.score-row.is-rich > button.score-name')) {
      const expanded = String(Number(button.dataset.id) === open)
      if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded)
    }
  }

  setStatus(lines: readonly string[], players?: readonly SessionPlayer[], details = true): void {
    const signature = details || !players ? lines.join('\n') : ''
    if (players !== this.players || (!players && signature !== this.rowLines)) {
      this.players = players
      this.rowLines = players ? undefined : signature
      this.updateRows(lines, players)
    }
    const detailSignature = details ? signature : ''
    if (detailSignature === this.detailSignature) return
    this.detailSignature = detailSignature
    this.updateDetails(details ? lines : [])
  }

  private updateRows(lines: readonly string[], players?: readonly SessionPlayer[]): void {
    const display: DisplayRow[] = []
    if (players) {
      // Room identities are the source of the roster. Display names need not be unique.
      for (const player of players) display.push({
        player, name: player.name, score: player.score, self: player.self, it: player.it,
        paused: player.paused, muted: player.muted, mutedForAll: Boolean(player.mutedForAll),
        flags: [player.king ? '[KING]' : '', player.host ? '(host)' : ''].join(' '),
      })
    } else {
      for (const line of lines) {
        const row = parseScoreRow(line)
        if (row) display.push({ ...row, paused: row.flags.includes('(paused)'), muted: false, mutedForAll: false })
      }
    }

    const next = new Map<string, { element: HTMLElement; label: string }>()
    display.forEach((row, index) => {
      const { player, name, self } = row
      const key = player ? `player-${player.id}` : `text-${index}`
      const label = JSON.stringify([name, self, player?.bot, player?.color, player?.kind])
      const previous = this.rows.get(key)
      const entry = previous?.label === label ? previous : { element: this.rowElement(row), label }
      this.updateRow(entry.element, row)
      next.set(key, entry)
    })
    for (const [key, old] of this.rows) if (next.get(key) !== old) old.element.remove()
    let anchor: Element | null = this.host.querySelector(':scope > .score-detail[data-after-rows]')
    for (const { element } of [...next.values()].reverse()) {
      if (element.parentNode !== this.host || element.nextSibling !== anchor) this.host.insertBefore(element, anchor)
      anchor = element
    }
    this.rows = next
    if (this.panel) { this.syncExpanded(); this.queueFit() }
  }

  private updateDetails(lines: readonly string[]): void {
    const events = new Set<string>()
    const before: HTMLElement[] = [], after: HTMLElement[] = []
    const first = lines.findIndex(line => parseScoreRow(line))
    lines.forEach((line, index) => {
      if (parseScoreRow(line)) return
      const element = document.createElement('div')
      element.className = `score-detail${/^(net:|host:)/.test(line) ? ' is-developer' : ''}`
      element.textContent = line
      if (!/^(net:|host:)/.test(line) && /joined|left|tagged| is it|locked|unlocked/i.test(line)) {
        events.add(line); if (!this.previousEvents.has(line)) this.notify(line)
      }
      if (first >= 0 && index > first) { element.dataset.afterRows = ''; after.push(element) }
      else before.push(element)
    })
    this.previousEvents = events
    for (const old of this.host.querySelectorAll(':scope > .score-detail')) old.remove()
    this.host.prepend(...before); this.host.append(...after)
  }

  private rowElement(row: DisplayRow): HTMLElement {
    const element = document.createElement('div')
    element.className = 'score-row'
    const { player } = row
    if (this.panel && player) return this.richRowElement(row, player)
    const name = document.createElement(player && !row.self ? 'button' : 'span')
    name.className = 'score-name'; name.append(...markedName(player ?? { name: row.name, bot: false })); name.title = row.name
    if (player) element.dataset.playerId = String(player.id)
    if (name instanceof HTMLButtonElement && player) {
      name.type = 'button'; name.dataset.id = String(player.id); name.dataset.name = row.name
      name.title = `Options for ${row.name}`
    }
    element.append(name, document.createElement('small'), document.createElement('strong'))
    return element
  }

  private updateRow(element: HTMLElement, row: DisplayRow): void {
    element.classList.toggle('is-it', row.it)
    element.classList.toggle('is-self', row.self)
    const flags = element.children[1], score = element.children[2]
    const rich = element.classList.contains('is-rich')
    const label = [
      row.flags.includes('[KING]') ? 'KING' : row.it ? 'IT' : '',
      row.self ? 'YOU' : '', row.flags.includes('(host)') ? 'HOST' : '',
      // The rich row shows muting as the crossed speaker instead of the word.
      row.paused ? 'PAUSED' : '', row.muted && !rich ? 'MUTED' : '',
    ].filter(Boolean).join(' · ')
    if (flags.textContent !== label) flags.textContent = label
    if (score.textContent !== String(row.score)) score.textContent = String(row.score)
    if (rich && row.player) this.updateRich(element, row, row.player)
  }

  /**
   * A row in the Players & session card: the name is a real button that opens the player panel;
   * after the name, flags and score (whose places other code relies on) come the device and place
   * label, the muted speaker, and the vehicle silhouette, which CSS pins to the far edge.
   */
  private richRowElement(row: DisplayRow, player: RosterPlayer): HTMLElement {
    const element = document.createElement('div')
    element.className = 'score-row is-rich'
    element.dataset.playerId = String(player.id)
    const name = document.createElement('button')
    name.type = 'button'; name.className = 'score-name'
    name.dataset.id = String(player.id); name.dataset.name = row.name
    name.setAttribute('aria-expanded', 'false'); name.setAttribute('aria-controls', 'player-panel')
    name.setAttribute('aria-haspopup', 'dialog')
    name.append(...slottedName(player)); name.title = row.self ? 'What others see about you' : `About ${row.name}`
    const meta = document.createElement('span'); meta.className = 'score-meta'
    const muted = document.createElement('span'); muted.className = 'score-muted'
    const vehicle = document.createElement('span'); vehicle.className = 'score-vehicle'
    const icon = vehicleIcon(player.kind); if (icon) vehicle.append(icon)
    element.append(name, document.createElement('small'), document.createElement('strong'), meta, muted, vehicle)
    return element
  }

  private updateRich(element: HTMLElement, row: DisplayRow, player: RosterPlayer): void {
    const meta = element.querySelector<HTMLElement>('.score-meta')!
    // Bots have no device or place; a person's label is chosen by width (fit).
    const labels = player.bot ? [] : rowLabels(player)
    const key = labels.join('\n')
    if (meta.dataset.labels !== key) { meta.dataset.labels = key; meta.dataset.level = ''; this.queueFit() }
    // Muted for everyone: the bright speaker, seen by all. Muted for me: the same speaker dimmed,
    // on my screen only. Both: bright.
    const state = row.mutedForAll ? 'all' : row.muted ? 'me' : ''
    const muted = element.querySelector<HTMLElement>('.score-muted')!
    if (muted.dataset.state !== state) {
      muted.dataset.state = state
      muted.replaceChildren(...state ? [mutedIcon(state === 'all' ? 'Muted for everyone' : 'Muted for you')] : [])
    }
  }

  private queueFit(): void {
    if (this.fitQueued || typeof requestAnimationFrame === 'undefined') return
    this.fitQueued = requestAnimationFrame(() => { this.fitQueued = 0; this.fit() })
  }

  /**
   * Choose each row's label level by the room it has: full, then device and country, then
   * nothing, so the name is never cut to make room (labelLevel). Reads layout once per row and
   * writes only when a level changes.
   */
  private fit(): void {
    for (const row of this.host.querySelectorAll<HTMLElement>(':scope > .score-row.is-rich')) {
      const meta = row.querySelector<HTMLElement>('.score-meta')!
      const labels = meta.dataset.labels ? meta.dataset.labels.split('\n') : []
      let level = -1
      if (labels.length && row.offsetParent) {
        const name = row.querySelector<HTMLElement>('.score-name')!
        const style = getComputedStyle(row)
        const gap = parseFloat(style.columnGap) || 0
        const inner = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        let fixed = 0, shown = 0
        for (const child of row.children as unknown as Iterable<HTMLElement>) {
          if (child === name || child === meta || !child.offsetWidth) continue
          fixed += child.offsetWidth; shown++
        }
        fixed += gap * shown
        // The name's whole width even while the flex box squeezes it.
        const nameWidth = Math.max(name.scrollWidth, name.offsetWidth)
        const font = getComputedStyle(meta).font
        if (this.measure) this.measure.font = font
        const widths = labels.map(text => Math.ceil(this.measure?.measureText(text).width ?? text.length * 7))
        level = labelLevel(inner, nameWidth, fixed, widths, gap)
      }
      const text = level >= 0 ? labels[level] : ''
      if (meta.textContent !== text) meta.textContent = text
      meta.dataset.level = String(level)
    }
  }
}
