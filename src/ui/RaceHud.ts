import type { RaceState } from '../../shared/protocol'
import { raceDirection, raceView, type RacePosition, type RaceRole } from './raceModel'
import { distanceText } from './units'
export type { RaceRole } from './raceModel'
const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value }

/** Presentation of canonical snapshots only. No countdown timers, input capture or audio. */
export class RaceHud {
  readonly element = document.createElement('aside')
  private snapshot: Readonly<RaceState> | null = null
  private role: Readonly<RaceRole> = { id: 0, host: false, connected: false }
  private roomNow = () => 0
  private collapsed = false
  private readonly status = document.createElement('strong')
  private readonly destination = document.createElement('span')
  private readonly detail = document.createElement('span')
  private readonly arrow = document.createElement('span')
  private readonly controls = document.createElement('div')
  private readonly leave = document.createElement('button')
  private readonly cancel = document.createElement('button')
  private readonly hide = document.createElement('button')
  private readonly abort = new AbortController()

  constructor(private readonly parent: HTMLElement, actions: { leave(): void; cancel(): void }) {
    this.element.className = 'race-hud'; this.element.hidden = true
    this.element.setAttribute('aria-label', 'Landmark race')
    this.status.className = 'race-status'
    this.destination.className = 'race-destination'; this.detail.className = 'race-detail'
    this.arrow.className = 'race-arrow'; this.arrow.textContent = '↑'; this.arrow.setAttribute('aria-hidden', 'true')
    this.controls.className = 'race-controls'
    this.leave.textContent = 'Leave race'; this.cancel.textContent = 'Cancel race'; this.hide.textContent = 'Hide'
    for (const button of [this.leave, this.cancel, this.hide]) button.type = 'button'
    const signal = this.abort.signal
    this.leave.addEventListener('click', () => { if (this.view()?.leave) actions.leave() }, { signal })
    this.cancel.addEventListener('click', () => { if (this.view()?.cancel) actions.cancel() }, { signal })
    this.hide.addEventListener('click', () => { this.collapsed = !this.collapsed; this.render() }, { signal })
    this.controls.append(this.leave, this.cancel, this.hide)
    this.element.append(this.arrow, this.status, this.destination, this.detail, this.controls)
    parent.append(this.element)
  }
  setState(snapshot: Readonly<RaceState> | null, roomNow: () => number, role: Readonly<RaceRole>): void {
    if (snapshot?.id !== this.snapshot?.id) this.collapsed = false
    this.snapshot = snapshot; this.roomNow = roomNow; this.role = { ...role }
    this.render()
  }
  private view() { return this.snapshot ? raceView(this.snapshot, this.role, this.roomNow()) : null }
  private render(): void {
    const view = this.view()
    if (!view || !this.snapshot) return
    // Keep countdown updates quiet and avoid replacing unchanged text every frame.
    text(this.status, view.status)
    text(this.destination, this.snapshot.destination.label)
    this.leave.hidden = this.collapsed || !view.leave; this.cancel.hidden = this.collapsed || !view.cancel
    text(this.hide, this.collapsed ? 'Show race' : 'Hide')
    this.hide.setAttribute('aria-expanded', String(!this.collapsed))
    this.element.classList.toggle('is-collapsed', this.collapsed)
  }
  update(visible: boolean, captured: boolean, self?: RacePosition, size = 0): void {
    this.element.hidden = !visible || !this.role.connected || !this.snapshot
    this.parent.classList.toggle('has-landmark-race', !this.element.hidden)
    if (this.element.hidden) return
    this.render()
    this.element.classList.toggle('is-captured', captured)
    const view = this.view()!
    const direction = self && size > 0 && view.active ? raceDirection(this.snapshot!, self, size) : null
    this.arrow.hidden = !direction
    if (direction) this.arrow.style.transform = `rotate(${direction.degrees}deg)`
    text(this.detail, `${view.role}${direction ? ` · ${distanceText(direction.metres)}` : ''}`)
  }
  dispose(): void { this.abort.abort(); this.parent.classList.remove('has-landmark-race'); this.element.remove() }
}
