/**
 * Parallel universes in play (net/parallel.ts): a full room sends the player to a fresh universe
 * of the world they were entering; the Players & session card offers one to anyone in the public
 * room, and from a universe the way back. Every move is the existing exit and entry flow: a
 * navigation to the room's entry address with autoplay, as a vehicle change by reload does.
 */
import { DEFAULT_ROOM, canonicalRoom, isDefaultRoom, writeRoom } from '../core/roomAddress'
import { arrivalLine, isParallelRoom, onRefused, parallelRoomName, putMove, storageWorks, takeMove, type RoomMove } from '../net/parallel'
import { ROOM_FULL_STATUS } from '../net'
import { recipeOfWorld } from '../core/publicWorlds'

export interface NoticeAction { label: string; run(): void }

/** What the loading veil says during a move (net/parallel.ts RoomMove): the main world only when it is the one asked for. */
export function moveVeilLine(move: Pick<RoomMove, 'reason' | 'asked'>): string {
  // Any public room, "lobby" or a planet's own (core/publicWorlds.ts), is the main world.
  const main = isDefaultRoom(move.asked)
  switch (move.reason) {
    case 'full': return 'This world is full. Opening a parallel universe of it.'
    case 'chosen': return 'Opening a parallel universe of this planet.'
    case 'returning': return main ? 'Trying the main world.' : 'Trying that world again.'
    case 'still-full': return main ? 'The main world is still full. Back to your parallel universe.' : 'That world is still full. Back to your parallel universe.'
  }
}
/**
 * Keep the loading veil up (index.html, html[data-room-move]) with `text` on its status line (or
 * the line it has, when null) until `onScreen()` says the game is showing or the page's failure
 * message shows. Never released on a timer: a lobby appearing a minute into an entry the player
 * did not cancel is worse than a line that says so. After 45 seconds the line becomes "This is
 * taking a while." with a Reload, the same as the veil's own inline watch (index.html), which
 * owns the hold on a page the move opened even if this script never arrives.
 */
export function holdVeil(text: string | null, onScreen: () => boolean, doc: Document = document): void {
  const root = doc.documentElement
  const veil = doc.querySelector<HTMLElement>('.boot-veil')
  const status = doc.querySelector<HTMLElement>('.boot-status')
  // Once the veil has said it is taking a while (index.html's own watch), that warning stays.
  if (status && text !== null && !doc.getElementById('move-reload')) status.textContent = text
  root.dataset.bootLate = ''
  root.dataset.roomMove = ''
  // The veil's 60-second failsafe animation has long finished for anyone who waited in the lobby.
  if (veil) veil.style.animation = 'none'
  const started = Date.now()
  const timer = setInterval(() => {
    const fatal = doc.getElementById('fatal')
    const failed = !!fatal && fatal.style.display !== '' && fatal.style.display !== 'none'
    if (onScreen() || failed) { clearInterval(timer); delete root.dataset.roomMove; return }
    if (Date.now() - started > 45_000 && status && !doc.getElementById('move-reload')) {
      status.textContent = 'This is taking a while.'
      const reload = Object.assign(doc.createElement('button'), { id: 'move-reload', type: 'button', className: 'boot-retry', textContent: 'Reload' })
      reload.addEventListener('click', () => location.reload())
      status.parentElement?.append(reload)
    }
  }, 200)
}
/** The game is on screen: in play, past the descent, and not waiting behind the tap that lets sound start. */
export const gameOnScreen = (doc: Document = document): boolean => {
  const shell = doc.querySelector('.mira-shell')
  return !!shell && shell.classList.contains('is-playing') && !shell.classList.contains('is-descending') && doc.documentElement.dataset.boot !== 'ready'
}
export type UniverseState = { kind: 'public'; enter(): void } | { kind: 'parallel'; copy(): void; back(): void } | null
export interface UniverseDeps {
  /** The room this page asked for. */
  room(): string
  /** The entry address (LobbyAddress.playURL): the visit's own flags, ?v= included. */
  entryURL(): URL
  /** The current world's code (planets.ts encodeWorld). */
  world(): string
  navigate(url: URL, move: RoomMove): void
  notice(text: string, actions: NoticeAction[]): void
  setUniverse(state: UniverseState): void
  copyLink(): void
}

export class ParallelUniverses {
  /** Why this page is in its room, if it came here by a move; read once at start. */
  readonly arrived: RoomMove | null
  private welcomed = false
  private leaving = false
  constructor(private readonly d: UniverseDeps, arrived: RoomMove | null = takeMove()) { this.arrived = arrived }

  /** The entry address of `room` with this world: what a reload or a friend's link opens. */
  roomURL(room: string): URL {
    const url = this.d.entryURL()
    writeRoom(url, room)
    url.searchParams.delete('world'); url.searchParams.delete('planet'); url.searchParams.delete('seed')
    // A public room by its planet alone (core/publicWorlds.ts): a seed would open a universe of it.
    if (isDefaultRoom(room)) { const planet = recipeOfWorld(this.d.world()); if (planet) url.searchParams.set('planet', planet) }
    else url.searchParams.set('world', this.d.world())
    url.searchParams.set('autoplay', '1')
    return url
  }
  private go(url: URL, move: RoomMove): void {
    if (this.leaving) return
    this.leaving = true
    putMove(move)
    this.d.navigate(url, move)
  }

  /** Networking's join status. Returns true when the refusal was taken care of here. */
  onJoinStatus(message: string): boolean {
    if (message !== ROOM_FULL_STATUS) return false
    // No storage to carry the move: stay in the local play networking has already started.
    if (!storageWorks()) { this.d.notice("This world is full, so you're exploring on your own with bots.", []); return true }
    const next = onRefused(this.arrived, this.d.room())
    if (next.go === 'universe') this.go(this.roomURL(next.room), next.move)
    else if (next.go === 'back') this.go(new URL(next.url), next.move)
    else this.d.notice("Every room we tried was full, so you're exploring on your own with bots.", [])
    return true
  }

  /** Each welcome: the arrival line once, and the card's room block. */
  onWelcome(): void {
    const room = this.d.room()
    if (isDefaultRoom(room)) this.d.setUniverse({ kind: 'public', enter: () => this.enterUniverse() })
    else if (isParallelRoom(room)) this.d.setUniverse({ kind: 'parallel', copy: () => this.d.copyLink(), back: () => this.tryAgain(DEFAULT_ROOM) })
    else this.d.setUniverse(null)
    if (this.welcomed) return
    this.welcomed = true
    const line = arrivalLine(this.arrived)
    if (!line) return
    const actions: NoticeAction[] = [{ label: 'Copy link', run: () => this.d.copyLink() }]
    if (this.arrived?.reason === 'full') actions.push({ label: isDefaultRoom(this.arrived.asked) ? 'Try the main world again' : 'Try that room again', run: () => this.tryAgain(this.arrived!.asked) })
    this.d.notice(line, actions)
  }

  /** The card's button: a fresh universe of this world. */
  enterUniverse(): void {
    this.go(this.roomURL(parallelRoomName()), { reason: 'chosen', asked: canonicalRoom(this.d.room()), hops: 0, at: Date.now() })
  }
  /** One attempt at `room`; if it is full, back to this very universe, said once (onRefused). */
  tryAgain(room: string): void {
    this.go(this.roomURL(room), { reason: 'returning', asked: canonicalRoom(room), back: this.roomURL(this.d.room()).href, hops: 0, at: Date.now() })
  }
}
