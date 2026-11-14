export interface MatchScore { name: string; score: number; you?: boolean }
export interface MatchState {
  mode: 'tag' | 'koth'
  holderName: string | null
  holderIsYou: boolean
  contested: boolean
  /** Seconds held, provided by the authoritative match state. */
  scores: readonly MatchScore[]
  target: number
  winner: string | null
}
export function matchAnnouncement(previous: MatchState | null, next: MatchState): string | null {
  if (next.mode !== 'koth') return null
  if (next.winner && next.winner !== previous?.winner) return `${next.winner} wins!`
  if (next.winner) return null
  if (next.contested && !previous?.contested) return 'Hill contested!'
  if (!next.contested && next.holderName && (next.holderName !== previous?.holderName || previous?.contested)) return next.holderIsYou ? 'You hold the hill!' : `${next.holderName} holds the hill!`
  return null
}
export function raceScores(scores: readonly MatchScore[]): MatchScore[] {
  const sorted = scores.filter(row => Number.isFinite(row.score)).map(row => ({ ...row, score: Math.max(0, row.score) })).sort((a, b) => b.score - a.score)
  const top = sorted.slice(0, 3), self = sorted.find(row => row.you)
  if (self && !top.includes(self)) top.push(self)
  return top
}
export class MatchHud {
  readonly element = document.createElement('aside')
  private readonly announcement = document.createElement('div')
  private previous: MatchState | null = null
  private timer?: ReturnType<typeof setTimeout>
  private signature = ''
  constructor(private readonly parent: HTMLElement) {
    this.element.className = 'match-hud'; this.element.hidden = true
    this.element.setAttribute('aria-label', 'King of the Hill match')
    this.announcement.className = 'match-announcement'; this.announcement.hidden = true
    this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-live', 'polite')
    parent.append(this.element, this.announcement)
  }
  setState(state: MatchState | null): void {
    if (!state || state.mode !== 'koth') {
      this.previous = null; this.signature = ''; this.element.hidden = true; this.announcement.hidden = true
      clearTimeout(this.timer); this.parent.classList.remove('has-match', 'match-announcing'); return
    }
    // Copy snapshots because callers may reuse their score arrays between frames.
    const next: MatchState = { ...state, target: Math.max(1, Number.isFinite(state.target) ? state.target : 60), scores: state.scores.map(row => ({ ...row })) }
    const signature = JSON.stringify(next)
    if (signature === this.signature) return
    this.signature = signature; this.parent.classList.add('has-match'); this.element.hidden = false
    this.element.classList.toggle('is-contested', next.contested); this.element.classList.toggle('is-yours', next.holderIsYou && !next.contested)
    const title = document.createElement('strong'); title.textContent = 'King of the Hill'
    const holder = document.createElement('p'); holder.className = 'hill-holder'
    holder.textContent = next.winner ? `${next.winner} wins` : next.contested ? 'Contested · scoring paused' : next.holderName ? next.holderIsYou ? 'You hold the hill' : `${next.holderName} holds the hill` : 'Hill unclaimed'
    const timer = document.createElement('small')
    const holderScore = next.scores.find(row => next.holderIsYou ? row.you : row.name === next.holderName)?.score ?? 0
    timer.textContent = next.winner ? 'Round complete' : next.contested ? `First to ${next.target}s wins` : next.holderName ? `${Math.ceil(Math.max(0, next.target - holderScore))}s to win` : `Hold for ${next.target}s to win`
    const race = document.createElement('div'); race.className = 'match-race'
    for (const row of raceScores(next.scores)) {
      const entry = document.createElement('div'); entry.className = 'match-score'; entry.classList.toggle('is-you', Boolean(row.you))
      const name = document.createElement('span'); name.textContent = `${row.name}${row.you ? ' (you)' : ''}`; name.title = name.textContent
      const score = document.createElement('span'); score.textContent = `${Math.floor(row.score)} / ${next.target}s`
      const bar = document.createElement('progress'); bar.max = next.target; bar.value = Math.min(row.score, next.target); bar.setAttribute('aria-label', `${row.name}: ${score.textContent}`)
      entry.append(name, score, bar); race.append(entry)
    }
    this.element.replaceChildren(title, holder, timer, race)
    const message = matchAnnouncement(this.previous, next)
    if (message) {
      this.announcement.textContent = message; this.announcement.hidden = false; this.parent.classList.add('match-announcing')
      clearTimeout(this.timer); this.timer = setTimeout(() => { this.announcement.hidden = true; this.parent.classList.remove('match-announcing') }, next.winner ? 5000 : 2800)
    }
    this.previous = next
  }
  dispose(): void { clearTimeout(this.timer); this.element.remove(); this.announcement.remove(); this.parent.classList.remove('has-match', 'match-announcing') }
}
