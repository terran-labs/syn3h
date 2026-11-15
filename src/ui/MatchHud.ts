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
  winnerColor?: string
  /** Remaining seconds from the authoritative round reset. */
  nextRoundIn?: number
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
  private roundEnds = 0
  private lastTick = -1
  private roundTimer?: ReturnType<typeof setInterval>
  constructor(private readonly parent: HTMLElement, private readonly countdownTick: () => void = () => {}) {
    this.element.className = 'match-hud'; this.element.hidden = true
    this.element.setAttribute('aria-label', 'King of the Hill match')
    this.announcement.className = 'match-announcement'; this.announcement.hidden = true
    this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-live', 'polite')
    parent.append(this.element, this.announcement)
  }
  setState(state: MatchState | null): void {
    if (!state || state.mode !== 'koth') {
      this.previous = null; this.signature = ''; this.element.hidden = true; this.announcement.hidden = true
      clearTimeout(this.timer); clearInterval(this.roundTimer); this.announcement.classList.remove('round-end'); this.parent.classList.remove('has-match', 'match-announcing'); return
    }
    // Copy snapshots because callers may reuse their score arrays between frames.
    const next: MatchState = { ...state, target: Math.max(1, Number.isFinite(state.target) ? state.target : 60), scores: state.scores.map(row => ({ ...row })) }
    const signature = JSON.stringify(next)
    if (signature === this.signature) return
    if (next.winner) {
      if (next.winner !== this.previous?.winner) {this.roundEnds = performance.now() + 6000;this.lastTick=-1}
      if (typeof next.nextRoundIn === 'number' && Number.isFinite(next.nextRoundIn)) this.roundEnds = performance.now() + Math.max(0, next.nextRoundIn) * 1000
    } else { if (this.previous?.winner) { this.announcement.hidden = true; this.parent.classList.remove('match-announcing') } clearInterval(this.roundTimer); this.announcement.classList.remove('round-end'); this.announcement.style.removeProperty('--winner-color') }
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
    if (next.winner) {
      clearTimeout(this.timer); this.announcement.classList.add('round-end'); this.announcement.hidden = false; this.parent.classList.add('match-announcing')
      this.announcement.style.setProperty('--winner-color', CSS.supports('color', next.winnerColor ?? '') ? next.winnerColor! : '#8dbce5')
      const title = document.createElement('strong'); title.textContent = `${next.winner} wins!`
      const count = document.createElement('small'); this.announcement.replaceChildren(title, count)
      const tick = () => { const seconds = Math.max(0, Math.ceil((this.roundEnds - performance.now()) / 1000)); if(seconds>0&&seconds<=5&&seconds!==this.lastTick){this.lastTick=seconds;this.countdownTick()} count.textContent = seconds ? `Next round in ${seconds}` : 'Waiting for the next round' }
      clearInterval(this.roundTimer); tick(); this.roundTimer = setInterval(tick, 100)
    } else if (message) {
      this.announcement.textContent = message; this.announcement.hidden = false; this.parent.classList.add('match-announcing')
      clearTimeout(this.timer); this.timer = setTimeout(() => { this.announcement.hidden = true; this.parent.classList.remove('match-announcing') }, next.winner ? 5000 : 2800)
    }
    this.previous = next
  }
  dispose(): void { clearTimeout(this.timer); clearInterval(this.roundTimer); this.element.remove(); this.announcement.remove(); this.parent.classList.remove('has-match', 'match-announcing') }
}
