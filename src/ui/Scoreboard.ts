import { chatLink } from './chat/chatLink'
import { markedName, type MarkedPlayer } from './playerMarks'
export interface ScoreRow { name: string; score: number; self: boolean; it: boolean; flags: string }
/** Preserve networking's text API; parse only its explicit row markers and score column. */
export function parseScoreRow(line: string): ScoreRow | null {
  const match = /^([ >])\s+(.+?)\s+(-?\d+)\s{2,}((?:(?:\[IT\]|\[KING\]|\(you\)|\(host\)|\(out\)|\(stuck\)|\(paused\)|\(not responding\))\s*)*)$/.exec(line)
  if (!match) return null
  return { name: match[2].trim(), score: Number(match[3]), self: match[4].includes('(you)'), it: match[1] === '>' || match[4].includes('[IT]'), flags: match[4].trim() }
}
/** Everyone in the room as their names are shown (main.ts, from the room's roster). */
export interface RosterPlayer extends MarkedPlayer { id: number }
export type PlayerRoster = () => readonly RosterPlayer[]

export interface SessionPlayer extends RosterPlayer {
  score: number
  self: boolean
  host: boolean
  it: boolean
  king: boolean
  paused: boolean
  muted: boolean
}

interface DisplayRow extends ScoreRow {
  player?: RosterPlayer
  paused: boolean
  muted: boolean
}

export class Scoreboard {
  private detailSignature: string | undefined
  private rowLines: string | undefined
  private players?: readonly SessionPlayer[]
  private previousEvents = new Set<string>()
  private rows = new Map<string, { element: HTMLElement; label: string }>()

  constructor(private readonly host: HTMLElement, private readonly notify: (text: string) => void) {
    // The same local text mute menu opens from a name in Chat or Players & session.
    host.addEventListener('click', (event) => {
      const name = (event.target as Element).closest<HTMLButtonElement>('button.score-name')
      if (name) chatLink.openPersonMenu(Number(name.dataset.id), name, name.dataset.name ?? '')
    })
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
        paused: player.paused, muted: player.muted,
        flags: [player.king ? '[KING]' : '', player.host ? '(host)' : ''].join(' '),
      })
    } else {
      for (const line of lines) {
        const row = parseScoreRow(line)
        if (row) display.push({ ...row, paused: row.flags.includes('(paused)'), muted: false })
      }
    }

    const next = new Map<string, { element: HTMLElement; label: string }>()
    display.forEach((row, index) => {
      const { player, name, self } = row
      const key = player ? `player-${player.id}` : `text-${index}`
      const label = JSON.stringify([name, self, player?.bot, player?.color])
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
    const label = [
      row.flags.includes('[KING]') ? 'KING' : row.it ? 'IT' : '',
      row.self ? 'YOU' : '', row.flags.includes('(host)') ? 'HOST' : '',
      row.paused ? 'PAUSED' : '', row.muted ? 'MUTED' : '',
    ].filter(Boolean).join(' · ')
    if (flags.textContent !== label) flags.textContent = label
    if (score.textContent !== String(row.score)) score.textContent = String(row.score)
  }
}
