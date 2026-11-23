import { chatLink } from './chat/chatLink'
import { markedName, type MarkedPlayer } from './playerMarks'
export interface ScoreRow { name: string; score: number; self: boolean; it: boolean; flags: string }
/** Preserve networking's text API; parse only its explicit row markers and score column. */
export function parseScoreRow(line: string): ScoreRow | null {
  const match = /^([ >])\s+(.+?)\s+(-?\d+)\s{2,}((?:(?:\[IT\]|\[KING\]|\(you\)|\(host\)|\(out\)|\(paused\)|\(not responding\))\s*)*)$/.exec(line)
  if (!match) return null
  return { name: match[2].trim(), score: Number(match[3]), self: match[4].includes('(you)'), it: match[1] === '>' || match[4].includes('[IT]'), flags: match[4].trim() }
}
/** Everyone in the room as their names are shown (main.ts, from the room's roster). */
export interface RosterPlayer extends MarkedPlayer { id: number }
export type PlayerRoster = () => readonly RosterPlayer[]

export class Scoreboard {
  private signature = ''
  private previousEvents = new Set<string>()
  private roster: PlayerRoster = () => []
  constructor(private readonly host: HTMLElement, private readonly notify: (text: string) => void) {
    // Another player's name opens the per-player menu (Mute or Unmute on this screen), the one
    // the Chat card's log opens; it replaced the Chat card's People list on 22 November 2026.
    host.addEventListener('click', (event) => {
      const name = (event.target as Element).closest<HTMLButtonElement>('button.score-name')
      if (name) chatLink.openPersonMenu(Number(name.dataset.id), name, name.dataset.name ?? '')
    })
  }
  /** Resolve row names to players, for their marks and the per-player menu. */
  setRoster(roster: PlayerRoster): void { this.roster = roster; this.signature = '' }
  setStatus(lines: readonly string[]): void {
    const signature = lines.join('\n')
    if (signature === this.signature) return
    this.signature = signature
    const fragment = document.createDocumentFragment(), events = new Set<string>(), roster = this.roster()
    for (const line of lines) {
      const row = parseScoreRow(line), element = document.createElement('div')
      if (row) {
        element.className = `score-row${row.it ? ' is-it' : ''}${row.self ? ' is-self' : ''}`
        const player = roster.find(p => p.name === row.name) ?? null
        const name = document.createElement(player && !row.self ? 'button' : 'span'), score = document.createElement('strong'), flags = document.createElement('small')
        // The name with its marks (a bot's icon in its colour), as every surface draws it.
        name.className = 'score-name'; name.append(...markedName(player ?? { name: row.name, bot: false })); name.title = row.name
        if (name instanceof HTMLButtonElement && player) { name.type = 'button'; name.dataset.id = String(player.id); name.dataset.name = row.name; name.title = `Options for ${row.name}` }
        score.textContent = String(row.score); flags.textContent = [row.flags.includes('[KING]') ? 'KING' : row.it ? 'IT' : '', row.self ? 'YOU' : '', row.flags.includes('(host)') ? 'HOST' : ''].filter(Boolean).join(' · ')
        element.append(name, flags, score)
      } else {
        element.className = `score-detail${/^(net:|host:)/.test(line) ? ' is-developer' : ''}`; element.textContent = line
        if (!/^(net:|host:)/.test(line) && /joined|left|tagged| is it|locked|unlocked/i.test(line)) {
          events.add(line); if (!this.previousEvents.has(line)) this.notify(line)
        }
      }
      fragment.append(element)
    }
    this.previousEvents = events; this.host.replaceChildren(fragment)
  }
}
