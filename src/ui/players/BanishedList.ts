/**
 * Banished (N): the room's active banishes, for whoever may moderate, at the foot of the
 * Players card above Invite and Welcome. Folded by default and absent when there are none, so
 * it is quiet. Each line: the name they had when ejected, the time left, and Lift.
 */

export interface Banish {
  /** The server's handle for this banish, passed back to lift it. */
  id: string
  /** The name they had when ejected. */
  name: string
  /** When it ends, ms since the epoch; null for permanent. */
  until: number | null
}

/** "22 min left", "3 h left", "Permanently"; "Ending" in the last few seconds. */
export function timeLeft(until: number | null, now = Date.now()): string {
  if (until === null) return 'Permanently'
  const seconds = Math.max(0, Math.round((until - now) / 1000))
  if (seconds < 60) return seconds > 5 ? '1 min left' : 'Ending'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.ceil(minutes / 60)
  return `${hours} h left`
}

export class BanishedList {
  private readonly details = document.createElement('details')
  private readonly summary = document.createElement('summary')
  private readonly list = document.createElement('ul')
  private items: readonly Banish[] = []
  private timer = 0

  constructor(private readonly host: HTMLElement) {
    this.details.className = 'banished'
    this.list.className = 'banished-list'
    this.details.append(this.summary, this.list)
    host.append(this.details)
    host.hidden = true
  }

  /** Show `list` with Lift buttons, or hide the whole fold when it is empty or `lift` is null. */
  set(list: readonly Banish[], lift: ((id: string) => void) | null): void {
    this.items = lift ? list : []
    this.host.hidden = !this.items.length
    this.summary.textContent = `Banished (${this.items.length})`
    this.list.replaceChildren(...this.items.map(banish => {
      const li = document.createElement('li')
      const name = Object.assign(document.createElement('span'), { className: 'banished-name', textContent: banish.name })
      const left = Object.assign(document.createElement('span'), { className: 'banished-left', textContent: timeLeft(banish.until) })
      left.dataset.until = banish.until === null ? '' : String(banish.until)
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'panel-action banished-lift', textContent: 'Lift' })
      b.setAttribute('aria-label', `Lift the banish on ${banish.name}`)
      b.addEventListener('click', () => lift?.(banish.id))
      li.append(name, left, b)
      return li
    }))
    // Times left tick once a minute while anything is listed.
    clearInterval(this.timer)
    if (this.items.some(item => item.until !== null)) this.timer = window.setInterval(() => this.tick(), 30_000)
  }

  private tick(): void {
    for (const left of this.list.querySelectorAll<HTMLElement>('.banished-left')) {
      if (left.dataset.until) left.textContent = timeLeft(Number(left.dataset.until))
    }
  }
}
