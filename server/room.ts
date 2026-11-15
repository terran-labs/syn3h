/**
 * A multiplayer room, independent of any transport. The Node dev server and the Cloudflare
 * Durable Object both wrap this class; tests drive it with fake peers.
 *
 * What the room owns: who is here, the shared parameter values, who is "it" and the scores.
 * What it trusts a client for: only that client's own vehicle state. Everything else a
 * client says (parameter changes, shots, hits, rams) is validated against what the room
 * already knows before it changes shared state.
 */
import { recipeIdForLook } from '../shared/recipes'
import { type ParamDef, params as registry, sanitize } from '../shared/params'
import {
  type ClientMessage,
  type GameState,
  type ParamWireValue,
  type PlayerInfo,
  type ServerMessage,
  type ShotInfo,
  type CordWire,
  type YoinkWire,
  type RaceState, type RaceUpdate,
  RACE_COUNTDOWN_MS, RACE_RUNNING_MS, RACE_RESULT_MS, RACE_COOLDOWN_MS,
  type TagEvent,
  BOT_ID_BASE,
  DEFAULT_COLORS,
  type HillZone,
  type KothState,
  MODE_EXPLORE,
  MODE_KOTH,
  MODE_TAG,
  MAX_NAME_LENGTH,
  MAX_PLAYER_ID,
  PROTOCOL_VERSION,
  STATE_BYTES,
  type WireState,
  cleanColor,
  cleanKind,
  cleanZone,
  inZone,
  decodeState,
  isBotId,
  encodeState,
  isVec3,
  parseJson,
  stampStateId,
  WRAP_SIZES,
  MAX_BOTS, type WireVehicleKind,
} from '../shared/protocol'
// Imported for their side effect of defining world parameters, so the server knows their
// ranges. Modules that define parameters next to Three.js code cannot be imported here; their
// ids pass through with a basic type check instead.
import { MIN_CLOSING, SHOVE_SHARE, cleanShove } from '../src/net/shove'
import { wrapDistance } from '../shared/wrap'
import { TERRAIN_PARAM_IDS } from '../src/world/terrain/settings'
import { laserInterval, laserLifetime, laserSpeed, lasersAllowed } from '../src/weapons/params'
import { bungeeAllowed, bungeeLength, bungeeSnap, bungeeVehicles } from '../src/weapons/bungee/params'
import { bigRedAllowed, bigRedCooldown } from '../src/weapons/bigRedParams'
import { pesterAllowed, pesterCooldown, pesterLife, pesterMax, pesterRange } from '../src/weapons/pester/params'
import { yoinkAllowed, yoinkCooldown, yoinkFling, yoinkHoldDistance, yoinkHoldTime, yoinkPunt, yoinkPuntRange, yoinkRange } from '../src/weapons/yoink/params'
import {
  KNOCK_WINDOW, WIN_PAUSE, raceAuto, gameMode, kothKnockBonus, kothRespawnDelay, kothTargetScore, tagCooldown, tagRamReach,
  REJOIN_GRACE, gameRejoin,
} from '../src/modes/params'

/** One connection, as the room sees it. */
export interface Peer {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
}

export interface RoomOptions {
  /** Milliseconds. Injected so tests can control time. */
  now?: () => number
  maxPlayers?: number
  /** Called after anything worth persisting changes (params, tag state, scores). */
  onPersist?: (snapshot: RoomSnapshot) => void
}

/** What a Durable Object stores to survive hibernation. */
export interface RoomSnapshot {
  params: Record<string, ParamWireValue>
  it: number
  scores: Record<number, number>
  nextId: number
  host: number
  locked: boolean
  zone?: HillZone | null
  /** Server ms when an active (not parked) player was last seen; see IDLE_RESET_MS. */
  activeAt?: number
  /** The world was reset for being idle: the next player to join brings theirs. */
  vacant?: boolean
  /**
   * 2 once Explore exists. A snapshot without it was stored when Tag was the default and
   * every room was a game of Tag whether or not anyone chose one: its mode 0 is read as
   * Explore, so a room that outlives the release does not start a game nobody asked for.
   */
  modes?: number
  /**
   * With `game.rejoin` on: who was in the room, by their rejoin secret, so that a room
   * rebuilt from storage (a release reset it, everyone dropped at once) can hold their
   * places. `at` is server ms when the entry was written.
   */
  roster?: { token: string; info: PlayerInfo; at: number }[]
  race?: { state: RaceState | null; deadline: number; cooldownUntil: number; lastId: string }
}

interface Player {
  /** Explicit local driving state, independent of hidden-tab heartbeats. */
  raceDriving: boolean
  info: PlayerInfo
  lastState: WireState | null
  /** Server ms when lastState arrived. */
  lastStateAt: number
  /** Server ms when anything at all last arrived from this player. */
  lastHeardAt: number
  /** The fastest this player has been in the last half second, m/s, and when: its speed
   * going into a ram, even if its newest state is from after the impact. */
  fast: number
  fastAt: number
  /** Server ms of the last push relayed from this player, by rammed player id. */
  shoved: Map<number, number>
  /** The room last relayed this player's Bungee cord as attached. */
  cordOn: boolean
  /** The vehicle that cord is tied to, or null for a ground anchor, so it can be let go when that vehicle goes. */
  cordTo: number | null
  /** The vehicle this player is carrying with Yoink, and since when (server ms). */
  carry: { to: number; at: number } | null
  /** Server ms of this player's last relayed grab or fling, and of its last gust per target. */
  yoinkAt: number
  gusted: Map<number, number>
  /** The secret this player may rejoin with, when it sent a valid one. */
  token: string | null
  /** Server ms until which a dropped player's place is held, or 0 while connected. */
  heldUntil: number
  lastFireAt: number
  /** Server ms of the last Big Red (Weapons lane), rate limited on its own. */
  lastRedAt: number
  /** Live Pesters (Weapons lane): shot id to server ms of launch. Capped at pester.max. */
  pesters: Map<number, number>
  /** Who each live Pester chases. */
  pesterTargets: Map<number, number>
  lastPesterAt: number
  /** Shots fired recently, by shot id, with server ms of firing. */
  shots: Map<number, number>
  /** Server ms of this player's last tag change. */
  lastTag: number
  /** Simple per second budgets against floods. */
  windowStart: number
  stateCount: number
  jsonCount: number
  /** Server ms of joining; 0 for a player adopted after hibernation (not newly arrived). */
  joinedAt: number
}

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_UNKNOWN_PARAMS = 256
const MAX_STATES_PER_SECOND = 70
const MAX_JSON_PER_SECOND = 40
/** A player whose state is older than this cannot ram or be rammed (the original's isResponding). */
const RESPONDING_MS = 1500
/**
 * A bot holds or contests the hill only while moving faster than this (m/s): a parked or
 * stuck bot must not block the hill forever. People count whether moving or not.
 */
const BOT_CONTEST_SPEED = 2
/** A bot the host has not updated for this long is gone (bot count lowered, or no host). */
const BOT_EXPIRY_MS = 5000
/**
 * In tag, "it" moves on when its holder has been away this long (phone locked, tab hidden,
 * connection gone quiet). Otherwise one person putting their phone down stops the game for
 * the whole room: a parked player cannot be rammed, and never reports being tagged.
 */
const IT_ABSENT_MS = 8000
/**
 * A connection that has sent nothing at all for this long is closed. A hidden tab still sends
 * a heartbeat (Chrome slows timers in long hidden tabs to once a minute), so only a client
 * that is truly gone, without its socket ever closing, goes this quiet. It would otherwise
 * hold a place in the room and a line in everyone's player list. If it comes back, it rejoins.
 */
const SILENT_MS = 180_000
/** No carry lasts longer than this, whatever the sliders say, ms. */
const YOINK_MAX_CARRY_MS = 30_000
/** Grace past the carry time limit before the room ends a carry itself, ms. */
const YOINK_CARRY_SLACK_MS = 1500
/**
 * The most of a player's reported speed that the room believes when a check gives leeway for
 * speed, m/s. Positions and velocities are each client's own word. Several checks rightly
 * allow more distance to a faster vehicle (a beam leaves from "near" its sender, a ram
 * reaches "about as far as the two travelled since their last states"), which made the
 * allowance as large as a client cared to claim: a state saying 10,000 m/s let a beam start
 * five kilometres away, beside anyone, and let a "ram" pass the tag across the whole world.
 * No vehicle here approaches this; anything above it earns no more leeway.
 */
const TRUSTED_SPEED = 100

/** A player's speed for the purpose of leeway: see TRUSTED_SPEED. */
function leewaySpeed(v: readonly number[]): number {
  return Math.min(TRUSTED_SPEED, Math.hypot(v[0], v[1], v[2]))
}

/** The most of a sender's own reported speed that counts toward its fling limit, m/s. */
const YOINK_OWN_SPEED = 60
/** At most one relayed push per rammer and rammed player in this time. */
const SHOVE_REPEAT_MS = 500
/** How long a player's top speed is remembered for bounding its push. */
const SHOVE_SPEED_MEMORY_MS = 500
/**
 * A room nobody is actually playing in forgets its world, so the next visitor does not inherit
 * a stale night sky or someone's gravity. "Active" means connected and sending live (not
 * parked) states, or joined in the last JOIN_GRACE_MS. With no active player for
 * IDLE_RESET_MS (only hidden tabs left), or for LEFT_RESET_MS after the last active player
 * left (long enough to survive a page reload), the world parameters and game state return to
 * defaults and the next player to join brings their world, as into an empty room.
 */
export const IDLE_RESET_MS = 5 * 60_000
export const LEFT_RESET_MS = 15_000
const ACTIVE_STATE_MS = 5000
const JOIN_GRACE_MS = 10_000
/** How often, at most, a busy room persists "still active" for the Durable Object. */
const ACTIVE_PERSIST_MS = 30_000

export class Room {
  readonly name: string
  private readonly now: () => number
  private readonly maxPlayers: number
  private readonly onPersist?: (s: RoomSnapshot) => void
  /** Connected peers that have not said hello yet. */
  private readonly pending = new Set<Peer>()
  private readonly players = new Map<Peer, Player>()
  /** Vehicles the host simulates, by bot id. */
  private readonly bots = new Map<number, Player>()
  private readonly values = new Map<string, ParamWireValue>()
  private unknownCount = 0
  private it = 0
  private host = 0
  private race: RaceState | null = null
  private raceDeadline = 0
  private raceCooldownUntil = 0
  private lastRaceId = ''
  private locked = false
  private mode: number = MODE_EXPLORE
  private koth: KothState = emptyKoth()
  /** Fractions of a point earned on the hill, per player. */
  private readonly holdFrac = new Map<number, number>()
  /** Who last touched each vehicle, and when (server ms), for dunk credit. */
  private readonly lastContact = new Map<number, { by: number; at: number }>()
  private lastTick = 0
  private scores: Record<number, number> = {}
  private nextId = 1
  /** Server ms an active player was last seen. */
  private activeAt: number
  private activePersistedAt = 0
  /** The last active player left; the shorter LEFT_RESET_MS applies. */
  private activeLeft = false
  /** Reset for idleness: the next hello brings its world, as into an empty room. */
  private vacant = false

  constructor(name: string, opts: RoomOptions = {}) {
    this.name = name
    this.now = opts.now ?? Date.now
    this.maxPlayers = opts.maxPlayers ?? 16
    this.onPersist = opts.onPersist
    this.setDefaults()
    this.activeAt = this.now()
  }

  /** Advance time based rules. Called on every message; transports may also call it on a timer. */
  tick(): void {
    this.tickSilent(this.now())
    this.expireBots()
    for (const bot of this.bots.values()) {
      if (!bot.lastState || bot.lastState.paused || this.now() - bot.lastStateAt > RESPONDING_MS) this.dropCord(bot)
    }
    // Bungee switched off: refreshes are refused from now on, so say the live cords are off
    // rather than leave them to each client's copy of the setting.
    if (!this.paramBool(bungeeAllowed.def)) for (const p of [...this.players.values(), ...this.bots.values()]) this.dropCord(p)
    this.tickYoink(this.now())
    this.tickHeld(this.now())
    this.tickIdle(this.now())
    this.tickTag(this.now())
    this.tickKoth(this.now())
    this.tickRace()
  }

  /** Authoritative current world, not the first hello or the mutable global registry. */
  presence() {
    const value = (id: string) => this.values.get(id) ?? registry.get(id)?.def.default
    return { players: this.playerCount - this.heldCount,
      recipeId: recipeIdForLook(value('terrain.look')), seed: value('world.seed') ?? null }
  }

  get playerCount(): number {
    return this.players.size
  }

  /** Players plus connections that have not said hello yet. Held places (game.rejoin) count:
   * a transport must keep the room and its storage while someone may still come back. */
  get connectionCount(): number {
    return this.players.size + this.pending.size
  }

  // -------------------------------------------------------------------------------------
  // Transport hooks
  // -------------------------------------------------------------------------------------

  connect(peer: Peer): void {
    this.pending.add(peer)
  }

  receive(peer: Peer, data: string | ArrayBuffer | Uint8Array): void {
    // Before the tick, which closes connections that have gone silent: this one just spoke.
    const heard = this.players.get(peer)
    if (heard) heard.lastHeardAt = this.now()
    this.tick()
    if (typeof data !== 'string') {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      const player = this.players.get(peer)
      if (player) this.onState(player, bytes)
      return
    }
    const msg = parseJson<ClientMessage>(data)
    if (!msg) return
    const player = this.players.get(peer)
    if (!player) {
      if (msg.type === 'hello' && this.pending.has(peer)) this.onHello(peer, msg)
      return
    }
    if (!this.budget(player, 'json')) return
    switch (msg.type) {
      case 'ping':
        if (typeof msg.t === 'number') this.sendTo(peer, { type: 'pong', t: msg.t, serverTime: this.now() / 1000 })
        break
      case 'race-ready':
        if (typeof msg.driving === 'boolean') {
          player.raceDriving = msg.driving
          if (!msg.driving) this.withdrawRace(player.info.id)
        }
        break
      case 'race': {
        const before = this.race
        this.onRace(player, msg.race)
        // A rejected proposal still needs an acknowledgment, including a null snapshot.
        if (this.race === before) this.sendTo(peer, { type: 'race', race: this.raceView() })
        break
      }
      case 'race-leave':
        if (msg.id === this.race?.id) this.withdrawRace(player.info.id)
        break
      case 'param':
        this.onParam(player, msg.id, msg.value)
        break
      case 'fire': {
        const actor = this.gearActor(player, msg.bot)
        if (actor) this.onFire(peer, actor, msg.shot)
        break
      }
      case 'hit':
        this.onHit(player, msg.shooter, msg.shot, msg.victim)
        break
      case 'profile':
        this.onProfile(player, msg.kind, msg.colors)
        break
      case 'ram':
        this.onRam(player, msg.other, msg.push)
        break
      case 'lock':
        this.onLock(player, msg.locked)
        break
      case 'zone':
        this.onZone(player, msg.zone)
        break
      case 'reset':
        // Same permission as moving a shared slider.
        if (!this.locked || player.info.id === this.host) this.resetWorld('host', player.info.id)
        break
      case 'bot':
        this.onBotKind(player, msg.id, msg.kind)
        break
      case 'cord': {
        const actor = this.gearActor(player, msg.bot)
        if (actor) this.onCord(peer, actor, msg.cord)
        break
      }
      case 'yoink': {
        const actor = this.gearActor(player, msg.bot)
        if (actor) this.onYoink(peer, actor, msg.y)
        break
      }
      case 'stuck':
      case 'died': // the name older bundles send
        if (typeof msg.bot === 'number') {
          // Only the host simulates bots, so only the host can say one is stuck.
          const bot = this.bots.get(msg.bot)
          if (bot && player.info.id === this.host) this.onStuck(bot)
        } else {
          this.onStuck(player)
        }
        break
    }
  }

  disconnect(peer: Peer): void {
    this.pending.delete(peer)
    const player = this.players.get(peer)
    if (!player) return
    if (this.rejoinOn() && player.token && !player.heldUntil) {
      this.hold(peer, player)
      return
    }
    this.leave(peer, player)
  }

  // -------------------------------------------------------------------------------------
  // Rejoining as the same player (game.rejoin)
  // -------------------------------------------------------------------------------------
  //
  // A dropped player is not removed at once. Its place is held: it stays in the room, in the
  // list and in every rule exactly as a player whose states have stopped (it cannot be rammed
  // or hold the hill, and "it" moves on after eight seconds), keeping its id, score and host
  // role. If the same tab says hello again with its secret before the hold runs out, it takes
  // the place back and nobody is told anything: to the others it was "not responding" for a
  // moment. If not, it leaves in the ordinary way.

  private rejoinOn(): boolean {
    return this.paramBool(gameRejoin.def)
  }

  /** Keep a dropped player's place. The map key is a stand-in peer that goes nowhere. */
  private hold(peer: Peer, player: Player, until = this.now() + REJOIN_GRACE * 1000): void {
    const wasActive = this.isActive(player, this.now())
    player.heldUntil = until
    player.raceDriving = false
    if (player.info.id === this.host) this.cancelRace('Host disconnected')
    else this.withdrawRace(player.info.id)
    this.rekey(peer, { send() {}, close() {} }, player)
    // Its owner is not there to let go of it: a held place holds no cord and carries nobody.
    this.dropCord(player)
    this.endCarry(player)
    // Nor is it there to be pulled or carried: its vehicle is frozen where it was last seen.
    this.releaseTiesTo(player.info.id)
    if (player.info.id === this.host) this.clearBots()
    if (wasActive && !this.anyActive(this.now())) {
      this.activeLeft = true
      this.activeAt = this.now()
    }
    this.persist()
  }

  /**
   * Put a player under another connection without moving it in the room's order: players are
   * kept in join order, which decides who becomes host next. A player not yet in the room is
   * added at the end.
   */
  private rekey(from: Peer, to: Peer, player: Player): void {
    const entries = [...this.players]
    this.players.clear()
    let placed = false
    for (const [peer, p] of entries) {
      if (peer === from) {
        this.players.set(to, player)
        placed = true
      } else this.players.set(peer, p)
    }
    if (!placed) this.players.set(to, player)
  }

  /** Places whose hold has run out leave for real. Turning the rule off releases them all. */
  private tickHeld(now: number): void {
    const on = this.rejoinOn()
    for (const [key, p] of [...this.players]) {
      if (p.heldUntil && (!on || now >= p.heldUntil)) this.leave(key, p)
    }
  }

  /** Places being held for dropped players. They count as connections: see connectionCount. */
  get heldCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.heldUntil) n++
    return n
  }

  /** The held or duplicate-free player this secret belongs to, if any. */
  private heldFor(token: string | null): [Peer, Player] | undefined {
    if (!token) return undefined
    for (const entry of this.players) if (entry[1].token === token && entry[1].heldUntil) return entry
    return undefined
  }

  /** The rejoin secret of a connected player, so a transport can store it with the socket. */
  token(peer: Peer): string | null {
    return this.players.get(peer)?.token ?? null
  }

  private leave(peer: Peer, player: Player): void {
    if (player.info.id === this.host) this.cancelRace('Host disconnected')
    else this.withdrawRace(player.info.id)
    const wasActive = this.isActive(player, this.now())
    this.endCarry(player)
    this.players.delete(peer)
    this.releaseTiesTo(player.info.id)
    if (wasActive && !this.anyActive(this.now())) {
      this.activeLeft = true
      this.activeAt = this.now()
    }
    const id = player.info.id
    delete this.scores[id]
    this.broadcast({ type: 'leave', id })
    // Players are kept in join order, so the first remaining one has been here longest.
    const next = this.players.values().next().value as Player | undefined
    const nextId = next ? next.info.id : 0
    const hostLeft = this.host === id
    if (hostLeft) {
      this.host = nextId
      this.clearBots()
      if (!next) this.locked = false
    }
    // "It" is a tag role: announce its move only in tag. A leaver who was host as well gets
    // both announcements, so the room always hears who the new host is.
    const wasIt = this.it === id
    if (wasIt) this.it = nextId
    if (wasIt && this.mode === MODE_TAG) this.setIt(nextId, 'leave')
    if (hostLeft && next) this.broadcastGame('host', nextId)
    else if (!wasIt || this.mode !== MODE_TAG) this.persist()
  }

  // -------------------------------------------------------------------------------------
  // Persistence (Durable Object hibernation)
  // -------------------------------------------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      params: Object.fromEntries(this.values), it: this.it, scores: { ...this.scores }, nextId: this.nextId,
      host: this.host, locked: this.locked, zone: this.koth.zone, activeAt: this.activeAt, vacant: this.vacant, modes: 2,
      ...(this.rejoinOn() ? { roster: this.roster() } : {}),
      race: { state: this.race, deadline: this.raceDeadline, cooldownUntil: this.raceCooldownUntil, lastId: this.lastRaceId },
    }
  }

  private roster(): NonNullable<RoomSnapshot['roster']> {
    const at = this.now()
    return [...this.players.values()].filter((p) => p.token).map((p) => ({ token: p.token!, info: { ...p.info }, at }))
  }

  restore(s: RoomSnapshot): void {
    for (const id in s.params) {
      const v = this.validateParam(id, s.params[id])
      if (v !== null) this.values.set(id, v)
    }
    // See RoomSnapshot.modes: an old room's Tag was the default, not a choice.
    if (s.modes !== 2 && this.values.get(gameMode.def.id) === MODE_TAG) this.values.set(gameMode.def.id, MODE_EXPLORE)
    this.it = s.it
    this.scores = { ...s.scores }
    this.nextId = Math.max(this.nextId, s.nextId)
    this.host = s.host ?? 0
    this.locked = Boolean(s.locked)
    this.mode = this.paramNumber(gameMode.def)
    this.koth.zone = s.zone ? cleanZone(s.zone) : null
    if (this.mode === MODE_EXPLORE) this.resetRound()
    // A snapshot from before activity was recorded counts as long idle.
    this.activeAt = typeof s.activeAt === 'number' ? s.activeAt : 0
    this.vacant = Boolean(s.vacant)
    // The room was rebuilt from storage with nobody connected: hold a place for everyone who
    // was in it recently, so they come back as themselves and the host and scores stand.
    if (this.rejoinOn() && Array.isArray(s.roster)) {
      const now = this.now()
      for (const entry of s.roster) {
        if (!entry || !isToken(entry.token) || !entry.info || typeof entry.info.id !== 'number') continue
        if (now - entry.at > REJOIN_GRACE * 1000 || this.byId(entry.info.id)) continue
        const player = this.newPlayer({
          ...entry.info, score: this.scores[entry.info.id] ?? 0,
          kind: cleanKind(entry.info.kind) ?? 'buggy', colors: cleanColors(entry.info.colors) ?? [...DEFAULT_COLORS],
        })
        player.token = entry.token
        player.joinedAt = 0
        this.nextId = Math.max(this.nextId, entry.info.id + 1)
        this.hold({ send() {}, close() {} }, player, now + REJOIN_GRACE * 1000)
      }
    }
    if (s.race) {
      this.race = s.race.state
      this.raceDeadline = s.race.deadline
      this.raceCooldownUntil = s.race.cooldownUntil
      this.lastRaceId = s.race.lastId
      // Host simulation cannot be reconstructed from a room snapshot.
      this.cancelRace('Room restarted')
      if (this.race && this.raceDeadline <= this.now()) this.race = null
    }
  }

  /** Re-attach a peer that was already joined before the process hibernated. No broadcast. */
  adopt(peer: Peer, info: PlayerInfo, token?: string | null): void {
    // After hibernation the room is restored from storage first, which holds a place for
    // everyone on its roster, and then the sockets that are still connected are adopted. A
    // connected player is not absent: it takes its held place, it is not added beside it.
    for (const [key, held] of this.players) {
      if (!held.heldUntil || held.info.id !== info.id) continue
      this.rekey(key, peer, held)
      held.heldUntil = 0
      held.lastHeardAt = this.now()
      if (isToken(token)) held.token = token
      return
    }
    const full: PlayerInfo = {
      ...info, score: this.scores[info.id] ?? info.score ?? 0,
      kind: cleanKind(info.kind) ?? 'buggy', colors: cleanColors(info.colors) ?? [...DEFAULT_COLORS],
    }
    const player = this.newPlayer(full)
    // Not a new arrival: waking from hibernation must not make a parked room look active.
    player.joinedAt = 0
    player.token = isToken(token) ? token : null
    this.players.set(peer, player)
    this.nextId = Math.max(this.nextId, info.id + 1)
  }

  /** Player info for a peer, so a transport can store it alongside the socket. */
  info(peer: Peer): PlayerInfo | undefined {
    return this.players.get(peer)?.info
  }

  // -------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------

  private onHello(peer: Peer, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    if (msg.v !== PROTOCOL_VERSION) {
      this.sendTo(peer, { type: 'error', message: `protocol ${msg.v} not supported, server speaks ${PROTOCOL_VERSION}` })
      peer.close(4000, 'protocol')
      return
    }
    // A dropped player coming back for its held place: the same player carries on.
    const token = isToken(msg.resume) ? msg.resume : null
    const held = this.rejoinOn() ? this.heldFor(token) : undefined
    if (held) {
      const [key, player] = held
      this.pending.delete(peer)
      this.rekey(key, peer, player)
      player.heldUntil = 0
      player.lastHeardAt = this.now()
      player.joinedAt = this.now()
      player.windowStart = this.now()
      player.stateCount = player.jsonCount = 0
      this.welcome(peer, player)
      this.persist()
      return
    }
    if (this.players.size >= this.maxPlayers) {
      this.sendTo(peer, { type: 'error', message: 'room is full' })
      peer.close(4001, 'full')
      return
    }
    this.pending.delete(peer)

    // The first player into an empty room brings the world, as the host did in the original.
    // So does the first into a room reset for idleness; parked players there are told.
    const bringsWorld = this.players.size === 0 || this.vacant
    if (bringsWorld && msg.params && typeof msg.params === 'object') {
      for (const id in msg.params) {
        // Frozen protocol-2 clients send Tag as a default, not an explicit choice.
        // They can still choose Tag later through the existing param message.
        if (id === gameMode.def.id && msg.modes !== 2 && msg.params[id] === MODE_TAG) continue
        this.storeParam(id, msg.params[id])
      }
      const mode = this.paramNumber(gameMode.def)
      if (mode !== this.mode) {
        this.mode = mode
        this.resetRound()
      }
      this.vacant = false
      if (this.players.size > 0) this.broadcast({ type: 'reset', reason: 'join', from: 0, params: Object.fromEntries(this.values), game: this.gameState() })
    }

    const used = new Set([...this.players.values()].map((p) => p.info.slot))
    let slot = 0
    while (used.has(slot)) slot++
    const id = this.nextId++
    if (this.nextId > MAX_PLAYER_ID) this.nextId = 1
    const info: PlayerInfo = {
      id, name: this.uniqueName(cleanName(msg.name, id)), slot, score: 0,
      kind: cleanKind(msg.kind) ?? 'buggy',
      colors: cleanColors(msg.colors) ?? [...DEFAULT_COLORS],
    }
    const player = this.newPlayer(info)
    // Two connections must never share a secret (a duplicated tab copies it): the second is
    // an ordinary new player with none.
    player.token = token && ![...this.players.values()].some((p) => p.token === token) ? token : null
    this.players.set(peer, player)
    this.scores[info.id] = 0

    if (!this.it || !this.byId(this.it)) this.it = info.id
    if (!this.host || !this.byId(this.host)) {
      // The stored host is not here: the room was rebuilt from storage with nobody connected
      // (a deploy or a restart reset it). Whoever returns first becomes host, and a lock the
      // old host set does not carry over to them: the old host may be seconds behind.
      if (this.host) this.locked = false
      this.host = info.id
    }
    // Scores for players who are no longer in the room (the same rebuild) are not kept.
    for (const old in this.scores) if (!this.byId(Number(old))) delete this.scores[old]

    this.welcome(peer, player)
    this.broadcast({ type: 'join', player: info }, peer)
    // Being "it" by default is news only while a game of tag is on.
    this.broadcast({ type: 'game', game: this.gameState(), event: this.mode === MODE_TAG && this.it === info.id ? 'default' : undefined, actor: this.mode === MODE_TAG ? this.it : 0 })
    this.persist()
  }

  /** Tell a player who it is and what the room holds, and where everyone else is. */
  private welcome(peer: Peer, player: Player): void {
    this.sendTo(peer, {
      type: 'welcome',
      v: PROTOCOL_VERSION,
      id: player.info.id,
      slot: player.info.slot,
      room: this.name,
      players: this.playerList(),
      params: Object.fromEntries(this.values),
      game: this.gameState(),
      serverTime: this.now() / 1000,
      race: this.raceView(),
    })
    // Show the newcomer where everyone already is, even players who are standing still.
    for (const other of this.players.values()) {
      if (other !== player && other.lastState) peer.send(encodeStored(other))
    }
  }

  private onState(player: Player, bytes: Uint8Array): void {
    if (bytes.byteLength !== STATE_BYTES) return
    const state = decodeState(bytes)
    if (!state) return
    if (state.bot) {
      this.onBotState(player, state, bytes)
      return
    }
    if (!this.budget(player, 'state')) return
    state.id = player.info.id
    player.lastState = state
    player.lastStateAt = this.now()
    const speed = leewaySpeed(state.v)
    if (speed >= player.fast || player.lastStateAt - player.fastAt > SHOVE_SPEED_MEMORY_MS) {
      player.fast = speed
      player.fastAt = player.lastStateAt
    }
    // Copy before stamping: the transport may reuse its buffer.
    const out = bytes.slice()
    stampStateId(out, player.info.id)
    for (const [peer, other] of this.players) if (other !== player) peer.send(out)
  }

  /** Only the host simulates bots, so only the host may speak for them. */
  private onBotState(sender: Player, state: WireState, bytes: Uint8Array): void {
    if (sender.info.id !== this.host || !isBotId(state.id)) return
    let bot = this.bots.get(state.id)
    if (!bot) {
      const n = state.id - BOT_ID_BASE
      bot = this.newPlayer({ id: state.id, name: `Bot ${n + 1}`, slot: -1, score: 0, kind: this.botKinds.get(state.id) ?? 'buggy', colors: ['#3a3f47', '#ffb000'], bot: true })
      // Bots appear and vanish with a slider; they do not get a newcomer's grace period.
      bot.lastTag = -Infinity
      this.bots.set(state.id, bot)
      this.scores[state.id] ??= 0
      this.broadcast({ type: 'join', player: bot.info })
    }
    // Twenty Hz per simulated vehicle, with jitter headroom. The finite host-only bot
    // slots cannot consume the human's budget, or mint an unlimited number of budgets.
    if (!this.budget(bot, 'state', 30)) return
    bot.lastState = state
    bot.lastStateAt = this.now()
    const out = bytes.slice()
    for (const [peer, other] of this.players) if (other !== sender) peer.send(out)
  }

  /** Vehicle kinds the host has announced for its bots, by bot id; a bot not named is a buggy. */
  private readonly botKinds = new Map<number, WireVehicleKind>()

  /** The host says which vehicle a bot is. Guests are told when it changes for a bot they see. */
  private onBotKind(sender: Player, id: unknown, kind: unknown): void {
    if (sender.info.id !== this.host || typeof id !== 'number' || !isBotId(id) || id >= BOT_ID_BASE + MAX_BOTS) return
    const clean = cleanKind(kind)
    if (!clean || this.botKinds.get(id) === clean) return
    this.botKinds.set(id, clean)
    const bot = this.bots.get(id)
    if (!bot || bot.info.kind === clean) return
    bot.info.kind = clean
    this.broadcast({ type: 'profile', player: bot.info })
  }

  private expireBots(): void {
    const now = this.now()
    for (const [id, bot] of this.bots) {
      if (now - bot.lastStateAt < BOT_EXPIRY_MS) continue
      this.removeBot(id, bot)
    }
  }

  /** Bot simulations belong to this host connection, never to its successor or held place. */
  private clearBots(): void {
    for (const [id, bot] of this.bots) this.removeBot(id, bot)
    this.botKinds.clear()
  }

  private removeBot(id: number, bot: Player): void {
    this.withdrawRace(id)
    this.dropCord(bot)
    this.endCarry(bot)
    this.releaseTiesTo(id)
    this.bots.delete(id)
    delete this.scores[id]
    this.broadcast({ type: 'leave', id })
    if (this.it === id) {
      const next = this.players.values().next().value as Player | undefined
      this.setIt(next ? next.info.id : 0, 'leave')
    }
  }

  /** Keep the connection's budget, but use the actor's own positions and gear limits. */
  private gearActor(sender: Player, botId: unknown): Player | undefined {
    if (botId === undefined) return sender
    if (sender.info.id !== this.host || sender.heldUntil || typeof botId !== 'number' || !Number.isInteger(botId) || !isBotId(botId)) return
    const bot = this.bots.get(botId)
    if (!bot?.lastState || bot.lastState.paused || this.now() - bot.lastStateAt > RESPONDING_MS) return
    return bot
  }

  private onProfile(player: Player, kind: unknown, colors: unknown): void {
    const k = kind === undefined ? player.info.kind : cleanKind(kind)
    const c = colors === undefined ? player.info.colors : cleanColors(colors)
    if (!k || !c) return
    if (k === player.info.kind && c[0] === player.info.colors[0] && c[1] === player.info.colors[1]) return
    player.info.kind = k
    player.info.colors = c
    this.broadcast({ type: 'profile', player: player.info })
  }

  private onParam(player: Player, id: unknown, raw: unknown): void {
    if (typeof id !== 'string') return
    if (this.locked && player.info.id !== this.host) {
      // Snap the sender's slider back to the room's value.
      const current = this.values.get(id)
      const peer = this.peerOf(player)
      if (current !== undefined && peer) this.sendTo(peer, { type: 'param', id, value: current, from: 0 })
      return
    }
    const previous = this.values.get(id)
    const value = this.storeParam(id, raw)
    if (value === null) return
    if (value !== previous && (TERRAIN_PARAM_IDS.has(id) || ['world.lavaAltitude', 'world.seaKind', 'world.gravity'].includes(id))) this.cancelRace('World changed')
    // Everyone, including the sender, gets the stored value: if the server clamped it, the
    // sender's slider snaps to what the room actually uses.
    this.broadcast({ type: 'param', id, value, from: player.info.id })
    this.persist()
    if (id === raceAuto.def.id && value === false) this.cancelRace('Automatic races disabled')
    if (id === gameMode.def.id && value !== this.mode) {
      this.mode = value as number
      this.resetRound()
      this.broadcastGame('mode', player.info.id)
    }
  }

  /** New mode or new round: everyone back to zero. */
  private resetRound(): void {
    for (const id in this.scores) this.scores[id] = 0
    for (const p of [...this.players.values(), ...this.bots.values()]) p.info.score = 0
    this.holdFrac.clear()
    this.lastContact.clear()
    const zone = this.koth.zone
    this.koth = emptyKoth()
    this.koth.zone = zone
  }

  private onZone(player: Player, raw: unknown): void {
    if (player.info.id !== this.host) return
    const zone = cleanZone(raw)
    if (!zone) return
    const old = this.koth.zone
    if (old && Object.keys(zone).every((k) => Math.abs(zone[k as keyof HillZone] - old[k as keyof HillZone]) < 0.01)) return
    this.koth.zone = zone
    this.broadcastGame(undefined)
  }

  /**
   * A client says its vehicle is stuck in the lava. It sits out of the hill count for the
   * return delay (by then it has crawled out or been lifted back to its pad), and whoever
   * touched it last, within the window, is credited with a dunk.
   */
  private onStuck(player: Player): void {
    if (this.mode !== MODE_KOTH) return
    const id = player.info.id
    const now = this.now()
    if (this.koth.out[id] && this.koth.out[id] * 1000 > now) return
    this.koth.out[id] = (now + this.paramNumber(kothRespawnDelay.def) * 1000) / 1000
    const contact = this.lastContact.get(id)
    this.lastContact.delete(id)
    const by = contact && now - contact.at <= KNOCK_WINDOW * 1000 ? this.byId(contact.by) : undefined
    if (by && !by.info.bot && by.info.id !== id) {
      this.addScore(by.info.id, this.paramNumber(kothKnockBonus.def))
      this.broadcastGame('dunk', by.info.id, id)
      this.checkWin(by.info.id, now)
    } else {
      this.broadcastGame('stuck', id)
    }
  }

  private addScore(id: number, points: number): void {
    this.scores[id] = (this.scores[id] ?? 0) + points
    const p = this.byId(id)
    if (p) p.info.score = this.scores[id]
  }

  private checkWin(id: number, now: number): boolean {
    if (this.koth.resetAt || (this.scores[id] ?? 0) < this.paramNumber(kothTargetScore.def)) return false
    this.koth.winner = id
    this.koth.resetAt = now / 1000 + WIN_PAUSE
    this.koth.holder = 0
    this.koth.contested = false
    this.broadcastGame('win', id)
    return true
  }

  private tickKoth(now: number): void {
    const dt = Math.min(1, Math.max(0, (now - (this.lastTick || now)) / 1000))
    this.lastTick = now
    if (this.mode !== MODE_KOTH) return
    const k = this.koth
    for (const id in k.out) if (k.out[id] * 1000 <= now) delete k.out[id]
    if (k.resetAt) {
      if (now / 1000 < k.resetAt) return
      const winner = k.winner
      this.resetRound()
      this.broadcastGame('reset', winner)
      return
    }
    if (!k.zone) return
    const zone = k.zone
    const inside: Player[] = []
    for (const p of [...this.players.values(), ...this.bots.values()]) {
      const st = p.lastState
      const fresh = now - p.lastStateAt <= (p.info.bot ? BOT_EXPIRY_MS : RESPONDING_MS)
      const counts = !p.info.bot || (st !== null && Math.hypot(...st.v) > BOT_CONTEST_SPEED)
      if (st && fresh && !st.paused && !k.out[p.info.id] && inZone(zone, st.p, this.wrapSize()) && counts) inside.push(p)
    }
    const holder = inside.length === 1 && !inside[0].info.bot ? inside[0].info.id : 0
    const contested = inside.length >= 2
    let event: TagEvent | undefined
    if (holder !== k.holder) event = holder ? 'capture' : contested ? 'contest' : 'free'
    else if (contested !== k.contested) event = contested ? 'contest' : 'free'
    k.holder = holder
    k.contested = contested
    let scored = false
    if (holder) {
      let frac = (this.holdFrac.get(holder) ?? 0) + dt
      while (frac >= 1) {
        frac -= 1
        this.addScore(holder, 1)
        scored = true
      }
      this.holdFrac.set(holder, frac)
      if (scored && this.checkWin(holder, now)) return
    }
    if (event || scored) this.broadcastGame(event, holder || undefined)
  }

  private onFire(peer: Peer, player: Player, shot: unknown): void {
    if (!isShot(shot)) return
    // A live id identifies one launch across all gear; reusing it would overwrite its target.
    if (player.shots.has(shot.id) || player.pesters.has(shot.id)) return
    if (shot.k === 'pester') { this.onPester(peer, player, shot); return }
    // Big Red (shot.k 'red') has its own switch and its own, slower rate; any other kind is refused.
    const red = shot.k === 'red'
    if (shot.k !== undefined && !red) return
    if (!this.paramBool(red ? bigRedAllowed.def : lasersAllowed.def)) return
    delete shot.to
    const now = this.now()
    // A little slack for jitter between the client's timer and arrival here.
    const interval = this.paramNumber(red ? bigRedCooldown.def : laserInterval.def) * 1000 * 0.8
    if (now - (red ? player.lastRedAt : player.lastFireAt) < interval) return
    const st = player.lastState
    if (!st || st.paused || now - player.lastStateAt > RESPONDING_MS) return
    const speed = leewaySpeed(st.v)
    if (this.dist(shot.o, st.p) > 8 + speed * 0.5) return
    if (shot.boost < 0 || shot.boost > Math.max(5, speed * 1.5)) return
    // Never let a client claim a firing time far from now: projectiles are replayed from it.
    shot.t = Math.min(now / 1000, Math.max(now / 1000 - 1, shot.t))
    const len = Math.hypot(...shot.d)
    shot.d = [shot.d[0] / len, shot.d[1] / len, shot.d[2] / len]
    if (red) player.lastRedAt = now
    else player.lastFireAt = now
    player.shots.set(shot.id, now)
    if (player.shots.size > 64) player.shots.delete(player.shots.keys().next().value as number)
    this.broadcast({ type: 'fire', from: player.info.id, shot }, peer)
  }

  /**
   * A Pester launch (Weapons lane): a shot of kind 'pester' chasing vehicle `to`. Its own
   * switch, its own rate, at most pester.max out per player, and a target that is in the room,
   * not the sender, and within range round the wrap. A catch is reported by the caught
   * player's own client as a hit, checked in onHit against the Pester's own lifetime.
   */
  private onPester(peer: Peer, player: Player, shot: ShotInfo): void {
    if (!this.paramBool(pesterAllowed.def)) return
    const now = this.now()
    if (now - player.lastPesterAt < this.paramNumber(pesterCooldown.def) * 1000 * 0.8) return
    const life = (this.paramNumber(pesterLife.def) + 1) * 1000
    for (const [id, at] of player.pesters) if (now - at > life) { player.pesters.delete(id); player.pesterTargets.delete(id) }
    if (player.pesters.size >= this.paramNumber(pesterMax.def)) return
    const st = player.lastState
    if (!st || st.paused || now - player.lastStateAt > RESPONDING_MS) return
    if (this.dist(shot.o, st.p) > 8 + leewaySpeed(st.v) * 0.5) return
    const target = typeof shot.to === 'number' ? this.byId(shot.to) : undefined
    if (!target || target === player || !target.lastState) return
    if (this.dist(target.lastState.p, st.p) > this.paramNumber(pesterRange.def) * 1.2 + 20) return
    shot.t = Math.min(now / 1000, Math.max(now / 1000 - 1, shot.t))
    const len = Math.hypot(...shot.d)
    shot.d = [shot.d[0] / len, shot.d[1] / len, shot.d[2] / len]
    shot.boost = 0
    player.lastPesterAt = now
    player.pesters.set(shot.id, now)
    player.pesterTargets.set(shot.id, target.info.id)
    player.shots.set(shot.id, now)
    if (player.shots.size > 64) player.shots.delete(player.shots.keys().next().value as number)
    this.broadcast({ type: 'fire', from: player.info.id, shot: { id: shot.id, o: shot.o, d: shot.d, boost: 0, t: shot.t, k: 'pester', to: target.info.id } }, peer)
  }

  /**
   * A player's Bungee cord (Weapons lane). Checked and relayed; the room keeps no cord state,
   * since owners resend every two seconds while attached. A hook must leave from near the
   * sender, an anchor must be within the cord's reach, and a cord can tie only to a vehicle
   * that is in the room.
   */
  private onCord(peer: Peer, player: Player, raw: unknown): void {
    if (!this.paramBool(bungeeAllowed.def)) return
    const cord = cleanCord(raw)
    if (!cord) return
    const st = player.lastState
    const reach = this.paramNumber(bungeeLength.def) * this.paramNumber(bungeeSnap.def) + 10
    if (cord.s === 'hook') {
      if (!st || this.dist(cord.o, st.p) > 8 + leewaySpeed(st.v) * 0.5) return
      cord.t = Math.min(this.now() / 1000, Math.max(this.now() / 1000 - 1, cord.t))
    } else if (cord.s === 'on') {
      if (cord.r < 0 || cord.r > this.paramNumber(bungeeLength.def) + 1) return
      // Where the cord is tied: a vehicle in the room, or a point on the ground. Either must
      // be within the cord's reach of the sender, measured round the wrap. A tie to a vehicle
      // matters most: that vehicle's own client is what pulls it, so an unchecked tie would
      // let anyone drag anyone from across the world.
      const other = cord.to !== undefined ? this.byId(cord.to) : undefined
      if (cord.to !== undefined && (!this.paramBool(bungeeVehicles.def) || cord.to === player.info.id)) return
      // A vehicle that left, or whose place is held, has no anchor: its copy is a frozen ghost.
      const anchor = cord.to === undefined ? cord.at : other && !other.heldUntil ? other.lastState?.p : undefined
      if (!st || !anchor || this.dist(anchor, st.p) > reach) {
        // Out of reach (or not yet placed). If this was the refresh of a cord the room has
        // already relayed, the others must not keep pulling on it: tell them it is off.
        if (player.cordOn) this.dropCord(player, player.info.bot ? undefined : peer)
        return
      }
    }
    player.cordOn = cord.s === 'on'
    player.cordTo = cord.s === 'on' ? cord.to ?? null : null
    this.broadcast({ type: 'cord', from: player.info.id, cord, t: this.now() / 1000 }, peer)
  }

  /**
   * Yoink (Weapons lane): grab a vehicle and carry it, fling it, or shove it with a gust.
   *
   * The vehicle acted on is moved by its own client, on the word of the message relayed
   * here, so these checks are all that stand between a modified client and everyone else:
   *  - the two must be in the room, placed, playing (not parked or silent) and within reach,
   *    round the wrap;
   *  - a carry is the room's to end. The game's own carry time limit runs on the holder's
   *    client, which a modified one ignores; the room remembers who carries whom and drops
   *    the carry itself when the time is up, the two drift out of reach, or the holder goes
   *    quiet or leaves (tickYoink, endCarry);
   *  - one vehicle is carried by one player at a time, and a player carries one;
   *  - flings and gusts are rationed per sender and target by the recharge time, so they
   *    cannot be stacked into one enormous shove;
   *  - a fling is no faster than the room's sliders allow plus the sender's own speed, and
   *    that speed is the sender's word, so only a sensible amount of it counts.
   */
  private onYoink(peer: Peer, player: Player, raw: unknown): void {
    if (!this.paramBool(yoinkAllowed.def)) return
    const y = cleanYoink(raw)
    if (!y) return
    const now = this.now()
    const other = this.byId(y.to)
    const mine = player.lastState
    const theirs = other?.lastState
    if (!other || other === player || !theirs || !mine) return
    if (mine.paused || theirs.paused || now - player.lastStateAt > RESPONDING_MS) return
    if (other.heldUntil || now - other.lastStateAt > (other.info.bot ? BOT_EXPIRY_MS : RESPONDING_MS)) return
    if (this.dist(theirs.p, mine.p) > this.yoinkReach()) return
    const carrying = player.carry?.to === y.to
    // The recharge between uses, with a little slack for timing; never less than a quarter second.
    const recharge = Math.max(250, this.paramNumber(yoinkCooldown.def) * 1000 * 0.8)

    if (y.s === 'drop') {
      if (carrying) this.endCarry(player, peer)
      return
    }
    if (y.s === 'grab') {
      if (carrying || now - player.yoinkAt < recharge) return
      for (const p of [...this.players.values(), ...this.bots.values()]) if (p !== player && p.carry?.to === y.to) return
      if (player.carry) this.endCarry(player)
      player.carry = { to: y.to, at: now }
      player.yoinkAt = now
      this.broadcast({ type: 'yoink', from: player.info.id, y }, peer)
      return
    }
    // A fling: the end of a carry, or a gust on a vehicle in reach.
    const own = Math.min(YOINK_OWN_SPEED, Math.hypot(...mine.v))
    const most = Math.max(this.paramNumber(yoinkFling.def), this.paramNumber(yoinkPunt.def) * 1.3) * 1.25 + own + 5
    if (Math.hypot(...y.v) > most) return
    if (carrying) {
      player.carry = null
    } else {
      if (now - (player.gusted.get(y.to) ?? -Infinity) < recharge) return
      player.gusted.set(y.to, now)
    }
    player.yoinkAt = now
    this.broadcast({ type: 'yoink', from: player.info.id, y }, peer)
  }

  /** How far apart a Yoink's two vehicles may be, metres: the game's reaches with slack. */
  private yoinkReach(): number {
    return Math.max(this.paramNumber(yoinkRange.def), this.paramNumber(yoinkPuntRange.def), this.paramNumber(yoinkHoldDistance.def) * 2) * 1.5 + 10
  }

  /** The room ends a carry: everyone, the carried vehicle's client above all, is told "drop". */
  private endCarry(holder: Player, except?: Peer): void {
    const carry = holder.carry
    if (!carry) return
    holder.carry = null
    this.broadcast({ type: 'yoink', from: holder.info.id, y: { s: 'drop', to: carry.to } }, except)
  }

  /** Carries that have run their time, lost their holder or stretched out of reach are ended. */
  private tickYoink(now: number): void {
    const limit = this.paramNumber(yoinkHoldTime.def)
    // "No limit" on the slider still ends: nobody is carried for more than YOINK_MAX_CARRY_MS.
    const most = Math.min(YOINK_MAX_CARRY_MS, limit > 0 ? limit * 1000 + YOINK_CARRY_SLACK_MS : YOINK_MAX_CARRY_MS)
    const on = this.paramBool(yoinkAllowed.def)
    for (const holder of [...this.players.values(), ...this.bots.values()]) {
      const carry = holder.carry
      if (!carry) continue
      const other = this.byId(carry.to)
      const gone = !other || !other.lastState || !holder.lastState || holder.lastState.paused || now - holder.lastStateAt > RESPONDING_MS
      if (!on || gone || now - carry.at > most || this.dist(other.lastState!.p, holder.lastState!.p) > this.yoinkReach()) this.endCarry(holder)
    }
  }

  /** Tell everyone a player's cord is gone: it stretched out of reach, or its owner dropped out. */
  private dropCord(player: Player, except?: Peer): void {
    if (!player.cordOn) return
    player.cordOn = false
    player.cordTo = null
    this.broadcast({ type: 'cord', from: player.info.id, cord: { s: 'off' }, t: this.now() / 1000 }, except)
  }

  /**
   * A vehicle left, was held for a rejoin or was removed: end every cord tied to it and every
   * carry of it, telling everyone, owners included, so nobody keeps pulling on its last copy.
   */
  private releaseTiesTo(id: number): void {
    for (const p of [...this.players.values(), ...this.bots.values()]) {
      if (p.cordTo === id) this.dropCord(p)
      if (p.carry?.to === id) this.endCarry(p)
    }
  }

  /** The victim reports a hit on itself. The room checks the shot really happened. */
  private onHit(reporter: Player, shooterId: unknown, shotId: unknown, victimId?: unknown): void {
    if (typeof shooterId !== 'number' || typeof shotId !== 'number') return
    let victim = reporter
    if (typeof victimId === 'number' && victimId !== reporter.info.id) {
      // Only the host judges hits on bots, as it is the one simulating them.
      const bot = this.bots.get(victimId)
      if (!bot || reporter.info.id !== this.host) return
      victim = bot
    }
    const shooter = this.byId(shooterId)
    if (!shooter || shooter === victim) return
    const firedAt = shooter.shots.get(shotId)
    if (firedAt === undefined) return
    const now = this.now()
    const pester = shooter.pesters.has(shotId)
    const lifetime = pester ? this.paramNumber(pesterLife.def) : laserLifetime(this.paramNumber(laserSpeed.def))
    if (now - firedAt > (lifetime + 1) * 1000) return
    // A Pester catches only the vehicle it was sent after.
    if (pester && shooter.pesterTargets.get(shotId) !== victim.info.id) return
    shooter.shots.delete(shotId)
    shooter.pesters.delete(shotId)
    shooter.pesterTargets.delete(shotId)
    this.broadcast({ type: 'hit', shooter: shooter.info.id, victim: victim.info.id, shot: shotId })
    if (this.mode !== MODE_TAG) {
      // On the hill a tag beam is a shove, and counts as contact for dunks.
      this.lastContact.set(victim.info.id, { by: shooter.info.id, at: now })
      return
    }

    // Tag rules from Rocket.js 91-96.
    const cooldown = this.paramNumber(tagCooldown.def) * 1000
    if (this.it === shooter.info.id && now - victim.lastTag >= cooldown) {
      // "it" tagged someone: a point for "it".
      victim.lastTag = now
      this.scores[shooter.info.id] = (this.scores[shooter.info.id] ?? 0) + 1
      shooter.info.score = this.scores[shooter.info.id]
      this.broadcast({ type: 'game', game: this.gameState(), event: 'score', actor: shooter.info.id, target: victim.info.id })
      this.persist()
    } else if (this.it === victim.info.id && now - victim.lastTag >= cooldown && now - shooter.lastTag >= cooldown) {
      // Shooting "it" takes the role.
      shooter.lastTag = victim.lastTag = now
      this.setIt(shooter.info.id, 'laser', victim.info.id)
    }
  }

  /** A client says its vehicle touched another. Contact between "it" and anyone passes it on. */
  private onRam(reporter: Player, otherId: unknown, push?: unknown): void {
    if (typeof otherId !== 'number') return
    const other = this.byId(otherId)
    if (!other || other === reporter) return
    const now = this.now()
    const a = reporter.lastState
    const b = other.lastState
    if (!a || !b || a.paused || b.paused || now - reporter.lastStateAt > RESPONDING_MS || now - other.lastStateAt > RESPONDING_MS) return
    // Both states are slightly old, so allow for how far fast vehicles travel meanwhile.
    const reach = this.paramNumber(tagRamReach.def) + (leewaySpeed(a.v) + leewaySpeed(b.v)) * 0.3
    if (this.dist(a.p, b.p) > reach) return
    // Pass the rammer's push on to the rammed player, whose client applies it if its own
    // physics missed the hit. Bots are simulated by the host, where the rammer's copy already
    // pushes them, so they get none.
    const to = other.info.bot ? undefined : this.peerOf(other)
    const shove = to ? this.boundedShove(reporter, other, push, now) : null
    if (shove && to) this.sendTo(to, { type: 'shove', from: reporter.info.id, push: shove })
    // Remember the contact both ways: whoever falls in next may have been pushed.
    this.lastContact.set(other.info.id, { by: reporter.info.id, at: now })
    this.lastContact.set(reporter.info.id, { by: other.info.id, at: now })
    if (this.mode !== MODE_TAG) return
    if (this.it !== reporter.info.id && this.it !== other.info.id) return
    const cooldown = this.paramNumber(tagCooldown.def) * 1000
    if (now - reporter.lastTag < cooldown || now - other.lastTag < cooldown) return
    reporter.lastTag = other.lastTag = now
    const wasIt = this.it
    const newIt = wasIt === reporter.info.id ? other.info.id : reporter.info.id
    this.setIt(newIt, 'ram', wasIt)
  }

  /**
   * Side of the world's tile in metres. Every world wraps; there is no switch. Positions arrive
   * canonical, inside one tile, so two vehicles a few metres apart across the seam are a
   * whole tile apart in plain coordinates: every range check here measures around the wrap.
   * The room does not register the terrain's parameters; it reads the stored values.
   */
  private wrapSize(): number {
    const tier = Number(this.values.get('terrain.planetSize') ?? 1)
    return WRAP_SIZES[tier <= 0 ? 0 : tier >= 2 ? 2 : 1]
  }

  /** Distance between two positions, the short way round on a wrapping world. */
  private dist(a: readonly number[], b: readonly number[]): number {
    const size = this.wrapSize()
    if (!(size > 0)) return dist(a, b)
    return Math.hypot(wrapDistance(a[0], a[2], b[0], b[2], size), a[1] - b[1])
  }

  /**
   * The rammer's push, made safe for a room of strangers: well formed, no stronger than the
   * two vehicles' speeds allow (so a client cannot fling someone from a standstill), and at
   * most one per pair every SHOVE_REPEAT_MS. Null if nothing should be relayed.
   */
  private boundedShove(reporter: Player, other: Player, push: unknown, now: number): [number, number, number] | null {
    const clean = cleanShove(push)
    if (!clean || !other.lastState) return null
    if (now - (reporter.shoved.get(other.info.id) ?? -Infinity) < SHOVE_REPEAT_MS) return null
    // The most they can have been closing at: the rammer's recent best plus the other's speed.
    const closing = reporter.fast + leewaySpeed(other.lastState.v)
    const limit = closing * SHOVE_SHARE
    if (limit < MIN_CLOSING * SHOVE_SHARE) return null
    const len = Math.hypot(...clean)
    const k = len > limit ? limit / len : 1
    reporter.shoved.set(other.info.id, now)
    return [clean[0] * k, clean[1] * k, clean[2] * k]
  }

  private onLock(player: Player, locked: unknown): void {
    if (typeof locked !== 'boolean' || player.info.id !== this.host || locked === this.locked) return
    this.locked = locked
    this.broadcastGame('lock', player.info.id)
  }

  // -------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------

  private setIt(id: number, event: TagEvent, target?: number): void {
    this.it = id
    this.broadcastGame(event, id, target)
  }

  private broadcastGame(event: TagEvent | undefined, actor?: number, target?: number): void {
    this.broadcast({ type: 'game', game: this.gameState(), event, actor, target })
    this.persist()
  }

  private peerOf(player: Player): Peer | undefined {
    for (const [peer, p] of this.players) if (p === player) return peer
    return undefined
  }

  /** Validate and store a parameter. Returns the stored value, or null if rejected. */
  private storeParam(id: string, raw: unknown): ParamWireValue | null {
    const v = this.validateParam(id, raw)
    if (v === null) return null
    if (!this.values.has(id)) {
      if (this.unknownCount >= MAX_UNKNOWN_PARAMS) return null
      this.unknownCount++
    }
    this.values.set(id, v)
    return v
  }

  private validateParam(id: string, raw: unknown): ParamWireValue | null {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
    const known = registry.get(id)
    if (known) {
      if (known.def.scope !== 'world') return null
      return sanitize(known.def, raw)
    }
    // Defined only in client code the server cannot import: accept plain values.
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) < 1e9) return raw
    return null
  }

  private paramNumber(def: ParamDef): number {
    const v = this.values.get(def.id)
    return typeof v === 'number' ? v : (def.default as number)
  }

  private paramBool(def: ParamDef): boolean {
    const v = this.values.get(def.id)
    return typeof v === 'boolean' ? v : Boolean(def.default)
  }

  private newPlayer(info: PlayerInfo): Player {
    // Joining counts as a tag so a newcomer cannot be tagged in their first seconds.
    const now = this.now()
    return {
      info, lastState: null, lastStateAt: 0, lastHeardAt: now, fast: 0, fastAt: 0, shoved: new Map(), cordOn: false, cordTo: null, carry: null, yoinkAt: -Infinity, gusted: new Map(), token: null, heldUntil: 0, lastFireAt: -Infinity, lastRedAt: -Infinity, pesters: new Map(), pesterTargets: new Map(), lastPesterAt: -Infinity, shots: new Map(), lastTag: now,
      windowStart: now, stateCount: 0, jsonCount: 0, joinedAt: now, raceDriving: false,
    }
  }

  // -------------------------------------------------------------------------------------
  // Idle rooms
  // -------------------------------------------------------------------------------------

  private isActive(p: Player, now: number): boolean {
    if (now - p.joinedAt < JOIN_GRACE_MS) return true
    return Boolean(p.lastState && !p.lastState.paused && now - p.lastStateAt < ACTIVE_STATE_MS)
  }

  private anyActive(now: number): boolean {
    for (const p of this.players.values()) if (this.isActive(p, now)) return true
    return false
  }

  /** Two players may pick the same name; the later one gets a number so lists and events can
   * tell them apart: "Sam", "Sam 2", "Sam 3". */
  private uniqueName(name: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.info.name.toLowerCase()))
    if (!taken.has(name.toLowerCase())) return name
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`
      const candidate = name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  /** Close connections that have gone completely quiet; see SILENT_MS. */
  private tickSilent(now: number): void {
    for (const [peer, p] of [...this.players]) {
      // A held place has no connection to close; it expires on its own clock.
      if (p.heldUntil || now - p.lastHeardAt <= SILENT_MS) continue
      peer.close(4002, 'silent')
      this.disconnect(peer)
    }
  }

  /** Server ms since which the player who is "it" has been away, or 0 while present. */
  private itAwaySince = 0

  /** In tag, pass "it" on from a holder who has been away too long; see IT_ABSENT_MS. */
  private tickTag(now: number): void {
    const holder = this.mode === MODE_TAG && this.it ? this.byId(this.it) : undefined
    if (!holder || holder.info.bot || this.isActive(holder, now)) {
      this.itAwaySince = 0
      return
    }
    if (!this.itAwaySince) this.itAwaySince = now
    if (now - this.itAwaySince < IT_ABSENT_MS) return
    // Players are kept in join order: the longest present active player takes over.
    for (const p of this.players.values()) {
      if (p === holder || !this.isActive(p, now)) continue
      this.itAwaySince = 0
      p.lastTag = now
      this.setIt(p.info.id, 'leave')
      return
    }
  }

  private tickIdle(now: number): void {
    if (this.anyActive(now)) {
      this.activeAt = now
      this.activeLeft = false
      this.vacant = false
      // Keep the Durable Object's copy roughly current, without writing on every message.
      if (now - this.activePersistedAt > ACTIVE_PERSIST_MS) this.persist()
      return
    }
    if (this.vacant) return
    const limit = this.activeLeft ? LEFT_RESET_MS : IDLE_RESET_MS
    if (now - this.activeAt >= limit) this.resetWorld('idle', 0)
  }

  /** World parameters to their defaults: those the server knows; others are forgotten. */
  private setDefaults(): void {
    this.values.clear()
    this.unknownCount = 0
    for (const p of registry.all()) if (p.def.scope === 'world') this.values.set(p.def.id, p.def.default)
    this.mode = this.paramNumber(gameMode.def)
  }

  /**
   * Return the room to a fresh one's world and game, keeping who is here. `idle`: nobody is
   * playing, and the next player to join brings their world. `host`: someone allowed to edit
   * the world asked for defaults. Everyone connected is told to reset their world sliders.
   */
  private resetWorld(reason: 'idle' | 'host', from: number): void {
    this.cancelRace('World reset')
    this.setDefaults()
    this.resetRound()
    this.koth.zone = null
    this.locked = false
    this.activeLeft = false
    this.vacant = reason === 'idle'
    if (reason === 'idle') this.activeAt = this.now()
    this.broadcast({ type: 'reset', reason, from, params: Object.fromEntries(this.values), game: this.gameState() })
    this.persist()
  }

  private raceActive(): boolean {
    return this.race?.phase === 'countdown' || this.race?.phase === 'running'
  }

  private raceView(): RaceState | null {
    return this.race ? { ...this.race, remainingMs: Math.max(0, this.raceDeadline - this.now()), updatedAt: this.now() / 1000 } : null
  }

  private publishRace(): void {
    this.broadcast({ type: 'race', race: this.raceView() })
    this.persist()
  }

  private eligibleRacer(p: Player): boolean {
    return !p.heldUntil && p.info.kind !== 'jet' && p.info.kind !== 'hovercraft' && Boolean(p.lastState && !p.lastState.paused)
      && this.now() - p.lastStateAt <= RESPONDING_MS && (Boolean(p.info.bot) || p.raceDriving)
  }

  private cancelRace(reason: string): void {
    if (!this.raceActive() || !this.race) return
    this.race = { ...this.race, revision: this.race.revision + 1, phase: 'cancelled', winnerId: null, winnerName: null, reason }
    this.raceDeadline = this.now() + RACE_RESULT_MS
    this.raceCooldownUntil = this.now() + RACE_COOLDOWN_MS
    this.publishRace()
  }

  private withdrawRace(id: number): void {
    if (!this.raceActive() || !this.race) return
    const p = this.race.participants.find((p) => p.id === id)
    if (!p || p.status !== 'racing') return
    this.race = { ...this.race, revision: this.race.revision + 1, participants: this.race.participants.map((p) => p.id === id ? { ...p, status: 'withdrawn' } : p) }
    if (this.race.participants.filter((p) => p.status !== 'withdrawn').length < 2) this.cancelRace('Too few racers')
    else this.publishRace()
  }

  private tickRace(): void {
    if (!this.race) return
    if (this.raceActive()) {
      for (const participant of this.race.participants) {
        const player = this.byId(participant.id)
        if (!player || !this.eligibleRacer(player)) this.withdrawRace(participant.id)
      }
      if (this.raceActive() && this.now() >= this.raceDeadline + (this.race.phase === 'countdown' ? RACE_RUNNING_MS : 0)) {
        this.race = { ...this.race, revision: this.race.revision + 1, phase: 'finished', winnerId: null, winnerName: null, reason: 'Time expired' }
        this.raceDeadline = this.now() + RACE_RESULT_MS
        this.raceCooldownUntil = this.now() + RACE_COOLDOWN_MS
        this.publishRace()
      }
    } else if (this.now() >= this.raceDeadline) {
      this.race = null
      this.publishRace()
    }
  }

  private onRace(sender: Player, raw: unknown): void {
    if (!this.paramBool(raceAuto.def) || sender.info.id !== this.host || sender.heldUntil) return
    const update = cleanRaceUpdate(raw)
    if (!update) return
    const now = this.now()
    const current = this.race
    if (!current) {
      if (now < this.raceCooldownUntil || update.id === this.lastRaceId || update.phase !== 'countdown'
        || update.winnerId !== null || update.participants.length < 2 || update.participants.some((p) => p.status !== 'racing')) return
      const players = update.participants.map((p) => this.byId(p.id))
      // Initial release enrolls only the host human plus nearby bots. Guests observe.
      if (!players.some((p) => p === sender) || players.some((p) => !p || !this.eligibleRacer(p) || (!p.info.bot && p !== sender))) return
      if (players.some((p) => this.dist(p!.lastState!.p, sender.lastState!.p) > 250)) return
      const d = update.destination
      const distance = this.dist([sender.lastState!.p[0], 0, sender.lastState!.p[2]], [d.x, 0, d.z])
      if (distance < 80 || distance > 250) return
      this.race = { ...update, participants: update.participants.map((p, i) => ({ ...p, name: players[i]!.info.name })), winnerName: null, updatedAt: now / 1000 }
      this.raceDeadline = now + RACE_COUNTDOWN_MS
      this.lastRaceId = update.id
      this.publishRace()
      return
    }
    if (!this.raceActive() || update.id !== current.id || update.revision <= current.revision) return
    const a = update.destination, b = current.destination
    if (a.label !== b.label || a.x !== b.x || a.y !== b.y || a.z !== b.z || a.radius !== b.radius) return
    if (update.participants.length !== current.participants.length) return
    const participants = [] as RaceState['participants']
    for (const prior of current.participants) {
      const next = update.participants.find((p) => p.id === prior.id)
      if (!next || (prior.status !== 'racing' && next.status !== prior.status)) return
      if (next.status === 'finished' && update.phase !== 'finished') return
      participants.push({ ...next, name: prior.name })
    }
    if (update.phase === 'cancelled') { this.cancelRace(update.reason ?? 'Host cancelled'); return }
    if (participants.filter((p) => p.status !== 'withdrawn').length < 2) { this.cancelRace('Too few racers'); return }
    let deadline = this.raceDeadline
    let winnerName: string | null = null
    if (update.phase === 'running') {
      if (current.phase === 'countdown') {
        if (now < deadline) return
        deadline += RACE_RUNNING_MS
      }
      if (update.winnerId !== null || now >= deadline) return
    } else if (update.phase === 'finished') {
      if (current.phase !== 'running' || now >= deadline) return
      const winner = participants.find((p) => p.id === update.winnerId && p.status === 'finished')
      const player = winner ? this.byId(winner.id) : undefined
      // The host judges swept finish crossings; a later state can be past the circle.
      if (!winner || !player || !this.eligibleRacer(player)) return
      winnerName = winner.name
      deadline = now + RACE_RESULT_MS
      this.raceCooldownUntil = now + RACE_COOLDOWN_MS
    } else if (update.phase !== 'countdown' || current.phase !== 'countdown' || update.winnerId !== null) return
    // remainingMs is advisory input. Revisions cannot extend a phase's server deadline.
    this.raceDeadline = deadline
    this.race = { ...update, participants, winnerName, updatedAt: now / 1000 }
    this.publishRace()
  }

  private budget(player: Player, kind: 'state' | 'json', stateLimit = MAX_STATES_PER_SECOND): boolean {
    const now = this.now()
    if (now - player.windowStart >= 1000) {
      player.windowStart = now
      player.stateCount = 0
      player.jsonCount = 0
    }
    if (kind === 'state') return ++player.stateCount <= stateLimit
    return ++player.jsonCount <= MAX_JSON_PER_SECOND
  }

  private byId(id: number): Player | undefined {
    const bot = this.bots.get(id)
    if (bot) return bot
    for (const p of this.players.values()) if (p.info.id === id) return p
    return undefined
  }

  private playerList(): PlayerInfo[] {
    return [...this.players.values(), ...this.bots.values()].map((p) => ({ ...p.info, score: this.scores[p.info.id] ?? 0 }))
  }

  private gameState(): GameState {
    return {
      // "It" exists only in tag. The room keeps track of a player for the role all the time,
      // so choosing Tag has somebody to start with, but tells nobody outside a game of tag.
      it: this.mode === MODE_TAG ? this.it : 0, scores: { ...this.scores }, host: this.host, locked: this.locked,
      mode: this.mode, koth: { ...this.koth, out: { ...this.koth.out } },
    }
  }

  private sendTo(peer: Peer, msg: ServerMessage): void {
    peer.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMessage, except?: Peer): void {
    const text = JSON.stringify(msg)
    for (const peer of this.players.keys()) if (peer !== except) peer.send(text)
  }

  private persist(): void {
    this.activePersistedAt = this.now()
    this.onPersist?.(this.snapshot())
  }
}

function emptyKoth(): KothState {
  return { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {} }
}

function encodeStored(p: Player): Uint8Array {
  return encodeState(p.lastState!)
}

/** A rejoin secret: long enough not to be guessed, plain characters only. */
function isToken(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(raw)
}

function cleanName(raw: unknown, id: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH) : ''
  return s || `Player ${id}`
}

function cleanColors(raw: unknown): [string, string] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const a = cleanColor(raw[0])
  const b = cleanColor(raw[1])
  return a && b ? [a, b] : null
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** A well formed cord message, rebuilt from only the fields it should have; null otherwise. */
function cleanCord(c: unknown): CordWire | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const vec = (v: unknown): v is [number, number, number] => isVec3(v)
  if (o.s === 'off') return { s: 'off' }
  if (o.s === 'hook') {
    if (!vec(o.o) || !vec(o.d) || !num(o.t) || Math.hypot(...o.d) > 2000) return null
    return { s: 'hook', o: o.o, d: o.d, t: o.t }
  }
  if (o.s === 'on' && num(o.r)) {
    if (num(o.to) && Number.isInteger(o.to)) return { s: 'on', to: o.to, r: o.r }
    // The surface normal is a direction: anything that is not about unit length is replaced.
    const unit = vec(o.n) && Math.abs(Math.hypot(...o.n) - 1) < 0.05
    if (vec(o.at)) return { s: 'on', at: o.at, n: unit ? (o.n as [number, number, number]) : [0, 1, 0], r: o.r }
  }
  return null
}

/** A well formed Yoink message, rebuilt from only the fields it should have; null otherwise. */
function cleanYoink(y: unknown): YoinkWire | null {
  if (!y || typeof y !== 'object') return null
  const o = y as Record<string, unknown>
  if (typeof o.to !== 'number' || !Number.isInteger(o.to)) return null
  if (o.s === 'grab' || o.s === 'drop') return { s: o.s, to: o.to }
  if (o.s === 'fling' && isVec3(o.v)) return { s: 'fling', to: o.to, v: o.v }
  return null
}

/** Rebuild a bounded race proposal; participant names are replaced from the room roster. */
function cleanRaceUpdate(raw: unknown): RaceUpdate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RaceUpdate
  if (typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.id)
    || !Number.isSafeInteger(r.revision) || r.revision < 0 || r.revision >= Number.MAX_SAFE_INTEGER - 1000
    || !['countdown', 'running', 'finished', 'cancelled'].includes(r.phase)
    || !Number.isFinite(r.remainingMs) || r.remainingMs < 0 || r.remainingMs > RACE_RUNNING_MS
    || (r.winnerId !== null && (!Number.isSafeInteger(r.winnerId) || r.winnerId <= 0))) return null
  const d = r.destination
  if (!d || typeof d.label !== 'string' || d.label.length < 1 || d.label.length > 80
    || ![d.x, d.y, d.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 100000)
    || !Number.isFinite(d.radius) || d.radius < 1 || d.radius > 50) return null
  if (!Array.isArray(r.participants) || r.participants.length < 1 || r.participants.length > 16 + MAX_BOTS) return null
  const ids = new Set<number>()
  const participants: RaceUpdate['participants'] = []
  for (const p of r.participants) {
    if (!p || !Number.isSafeInteger(p.id) || p.id <= 0 || ids.has(p.id) || !['racing', 'finished', 'withdrawn'].includes(p.status)) return null
    ids.add(p.id)
    participants.push({ id: p.id, name: '', status: p.status })
  }
  if (r.reason !== undefined && (typeof r.reason !== 'string' || r.reason.length > 120)) return null
  return { id: r.id, revision: r.revision, phase: r.phase, remainingMs: r.remainingMs,
    destination: { label: d.label, x: d.x, y: d.y, z: d.z, radius: d.radius }, participants,
    winnerId: r.winnerId, ...(r.reason === undefined ? {} : { reason: r.reason }) }
}

function isShot(s: unknown): s is ShotInfo {
  if (!s || typeof s !== 'object') return false
  const o = s as ShotInfo
  return (
    typeof o.id === 'number' && Number.isInteger(o.id) &&
    isVec3(o.o) && isVec3(o.d) && Math.hypot(...o.d) > 0.5 && Math.hypot(...o.d) < 1.5 &&
    typeof o.boost === 'number' && Number.isFinite(o.boost) &&
    typeof o.t === 'number' && Number.isFinite(o.t)
  )
}
