export interface ScoreRow { name: string; score: number; self: boolean; it: boolean; flags: string }
/** Preserve networking's text API; parse only its explicit row markers and score column. */
export function parseScoreRow(line: string): ScoreRow | null {
  const match = /^([ >])\s+(.+?)\s+(-?\d+)\s{2,}((?:(?:\[IT\]|\(you\)|\(host\)|\(not responding\))\s*)*)$/.exec(line)
  if (!match) return null
  return { name: match[2].trim(), score: Number(match[3]), self: match[4].includes('(you)'), it: match[1] === '>' || match[4].includes('[IT]'), flags: match[4].trim() }
}
export class Scoreboard {
  private signature = ''
  private previousEvents = new Set<string>()
  constructor(private readonly host: HTMLElement, private readonly notify: (text: string) => void) {}
  setStatus(lines: readonly string[]): void {
    const signature = lines.join('\n')
    if (signature === this.signature) return
    this.signature = signature
    const fragment = document.createDocumentFragment(), events = new Set<string>()
    for (const line of lines) {
      const row = parseScoreRow(line), element = document.createElement('div')
      if (row) {
        element.className = `score-row${row.it ? ' is-it' : ''}${row.self ? ' is-self' : ''}`
        const name = document.createElement('span'), score = document.createElement('strong'), flags = document.createElement('small')
        name.textContent = row.name; score.textContent = String(row.score); flags.textContent = [row.it ? 'IT' : '', row.self ? 'YOU' : '', row.flags.includes('(host)') ? 'HOST' : ''].filter(Boolean).join(' · ')
        element.append(name, flags, score)
      } else {
        element.className = 'score-detail'; element.textContent = line
        if (!/^(net:|host:)/.test(line) && /joined|left|tagged| is it|locked|unlocked/i.test(line)) {
          events.add(line); if (!this.previousEvents.has(line)) this.notify(line)
        }
      }
      fragment.append(element)
    }
    this.previousEvents = events; this.host.replaceChildren(fragment)
  }
}
