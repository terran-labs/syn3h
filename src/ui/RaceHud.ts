import type { RaceState } from '../../shared/protocol'
import { raceDirection, raceView, type RacePosition, type RaceRole } from './raceModel'
export type { RaceRole } from './raceModel'

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
  // What was last written to the page. update() runs every frame, usually with no race on, so
  // it compares against these and touches the DOM only when something changed: no reads at all.
  private shown = false
  private captured: boolean | undefined
  private collapsedShown: boolean | undefined
  private leaveHidden: boolean | undefined
  private cancelHidden: boolean | undefined
  private arrowShown: boolean | undefined
  private arrowDegrees: number | undefined
  private statusShown = ''
  private destinationShown = ''
  private detailRole = ''
  private detailMetres: number | undefined

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
  private render(view = this.view()): void {
    if (!view || !this.snapshot) return
    if (view.status !== this.statusShown) { this.statusShown = view.status; this.status.textContent = view.status }
    const destination = this.snapshot.destination.label
    if (destination !== this.destinationShown) { this.destinationShown = destination; this.destination.textContent = destination }
    const leaveHidden = this.collapsed || !view.leave, cancelHidden = this.collapsed || !view.cancel
    if (leaveHidden !== this.leaveHidden) { this.leaveHidden = leaveHidden; this.leave.hidden = leaveHidden }
    if (cancelHidden !== this.cancelHidden) { this.cancelHidden = cancelHidden; this.cancel.hidden = cancelHidden }
    if (this.collapsed !== this.collapsedShown) {
      this.collapsedShown = this.collapsed
      this.hide.textContent = this.collapsed ? 'Show race' : 'Hide'
      this.hide.setAttribute('aria-expanded', String(!this.collapsed))
      this.element.classList.toggle('is-collapsed', this.collapsed)
    }
  }
  update(visible: boolean, captured: boolean, self?: RacePosition, size = 0): void {
    const show = visible && this.role.connected && !!this.snapshot
    if (show !== this.shown) { this.shown = show; this.element.hidden = !show; this.parent.classList.toggle('has-landmark-race', show) }
    if (!show) return
    const view = this.view()!
    this.render(view)
    if (captured !== this.captured) { this.captured = captured; this.element.classList.toggle('is-captured', captured) }
    const direction = self && size > 0 && view.active ? raceDirection(this.snapshot!, self, size) : null
    const arrowShown = direction !== null
    if (arrowShown !== this.arrowShown) { this.arrowShown = arrowShown; this.arrow.hidden = !arrowShown }
    // Half a degree is finer than the eye can tell on this arrow, and saves a style write on most frames.
    const degrees = direction ? Math.round(direction.degrees * 2) / 2 : undefined
    if (degrees !== undefined && degrees !== this.arrowDegrees) { this.arrowDegrees = degrees; this.arrow.style.transform = `rotate(${degrees}deg)` }
    const metres = direction?.metres
    if (view.role !== this.detailRole || metres !== this.detailMetres) {
      this.detailRole = view.role; this.detailMetres = metres
      this.detail.textContent = `${view.role}${direction ? ` · ${direction.metres} m` : ''}`
    }
  }
  dispose(): void { this.abort.abort(); this.parent.classList.remove('has-landmark-race'); this.element.remove() }
}
