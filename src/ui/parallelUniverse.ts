/**
 * Parallel universes in play (net/parallel.ts): a full room sends the player to a fresh universe
 * of the world they were entering; the Players & session card offers one to anyone in the public
 * room, and from a universe the way back. Every move is the existing exit and entry flow: a
 * navigation to the room's entry address with autoplay, as a vehicle change by reload does.
 */
import { DEFAULT_ROOM, canonicalRoom, isDefaultRoom, writeRoom } from '../core/roomAddress'
import { arrivalLine, isParallelRoom, onRefused, parallelRoomName, putMove, takeMove, type RoomMove } from '../net/parallel'
import { ROOM_FULL_STATUS } from '../net'

export interface NoticeAction { label: string; run(): void }
export type UniverseState = { kind: 'public'; enter(): void } | { kind: 'parallel'; copy(): void; back(): void } | null
export interface UniverseDeps {
  /** The room this page asked for. */
  room(): string
  /** The entry address (LobbyAddress.playURL): the visit's own flags, ?v= included. */
  entryURL(): URL
  /** The current world's code (planets.ts encodeWorld). */
  world(): string
  navigate(url: URL): void
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
    url.searchParams.set('world', this.d.world())
    url.searchParams.delete('planet'); url.searchParams.delete('seed')
    url.searchParams.set('autoplay', '1')
    return url
  }
  private go(url: URL, move: RoomMove): void {
    if (this.leaving) return
    this.leaving = true
    putMove(move)
    this.d.navigate(url)
  }

  /** Networking's join status. Returns true when the refusal was taken care of here. */
  onJoinStatus(message: string): boolean {
    if (message !== ROOM_FULL_STATUS) return false
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
    if (this.arrived?.reason === 'full') actions.push({ label: this.arrived.asked === DEFAULT_ROOM ? 'Try the main world again' : 'Try that room again', run: () => this.tryAgain(this.arrived!.asked) })
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
