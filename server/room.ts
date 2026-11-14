/**
 * A multiplayer room, independent of any transport. The Node dev server and the Cloudflare
 * Durable Object both wrap this class; tests drive it with fake peers.
 *
 * What the room owns: who is here, the shared parameter values, who is "it" and the scores.
 * What it trusts a client for: only that client's own vehicle state. Everything else a
 * client says (parameter changes, shots, hits, rams) is validated against what the room
 * already knows before it changes shared state.
 */
import { type ParamDef, params as registry, sanitize } from '../shared/params'
import {
  type ClientMessage,
  type GameState,
  type ParamWireValue,
  type PlayerInfo,
  type ServerMessage,
  type ShotInfo,
  type TagEvent,
  BOT_ID_BASE,
  DEFAULT_COLORS,
  type HillZone,
  type KothState,
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
} from '../shared/protocol'
// Imported for their side effect of defining world parameters, so the server knows their
// ranges. Modules that define parameters next to Three.js code cannot be imported here; their
// ids pass through with a basic type check instead.
import { laserInterval, laserLifetime, laserSpeed, lasersAllowed } from '../src/weapons/params'
import {
  KNOCK_WINDOW, WIN_PAUSE, gameMode, kothKnockBonus, kothRespawnDelay, kothTargetScore, tagCooldown, tagRamReach,
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
}

interface Player {
  info: PlayerInfo
  lastState: WireState | null
  /** Server ms when lastState arrived. */
  lastStateAt: number
  lastFireAt: number
  /** Shots fired recently, by shot id, with server ms of firing. */
  shots: Map<number, number>
  /** Server ms of this player's last tag change. */
  lastTag: number
  /** Simple per second budgets against floods. */
  windowStart: number
  stateCount: number
  jsonCount: number
}

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_UNKNOWN_PARAMS = 256
const MAX_STATES_PER_SECOND = 70
const MAX_JSON_PER_SECOND = 40
/** A player whose state is older than this cannot ram or be rammed (the original's isResponding). */
const RESPONDING_MS = 1500
/** A bot the host has not updated for this long is gone (bot count lowered, or no host). */
const BOT_EXPIRY_MS = 5000

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
  private locked = false
  private mode = MODE_TAG
  private koth: KothState = emptyKoth()
  /** Fractions of a point earned on the hill, per player. */
  private readonly holdFrac = new Map<number, number>()
  /** Who last touched each vehicle, and when (server ms), for knock-in credit. */
  private readonly lastContact = new Map<number, { by: number; at: number }>()
  private lastTick = 0
  private scores: Record<number, number> = {}
  private nextId = 1

  constructor(name: string, opts: RoomOptions = {}) {
    this.name = name
    this.now = opts.now ?? Date.now
    this.maxPlayers = opts.maxPlayers ?? 16
    this.onPersist = opts.onPersist
    for (const p of registry.all()) if (p.def.scope === 'world') this.values.set(p.def.id, p.def.default)
    this.mode = this.paramNumber(gameMode.def)
  }

  /** Advance time based rules. Called on every message; transports may also call it on a timer. */
  tick(): void {
    this.tickKoth(this.now())
  }

  get playerCount(): number {
    return this.players.size
  }

  /** Players plus connections that have not said hello yet. */
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
    this.expireBots()
    this.tickKoth(this.now())
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
      case 'param':
        this.onParam(player, msg.id, msg.value)
        break
      case 'fire':
        this.onFire(peer, player, msg.shot)
        break
      case 'hit':
        this.onHit(player, msg.shooter, msg.shot, msg.victim)
        break
      case 'profile':
        this.onProfile(player, msg.kind, msg.colors)
        break
      case 'ram':
        this.onRam(player, msg.other)
        break
      case 'lock':
        this.onLock(player, msg.locked)
        break
      case 'zone':
        this.onZone(player, msg.zone)
        break
      case 'died':
        this.onDied(player)
        break
    }
  }

  disconnect(peer: Peer): void {
    this.pending.delete(peer)
    const player = this.players.get(peer)
    if (!player) return
    this.players.delete(peer)
    const id = player.info.id
    delete this.scores[id]
    this.broadcast({ type: 'leave', id })
    // Players are kept in join order, so the first remaining one has been here longest.
    const next = this.players.values().next().value as Player | undefined
    const nextId = next ? next.info.id : 0
    const hostLeft = this.host === id
    if (hostLeft) {
      this.host = nextId
      if (!next) this.locked = false
    }
    if (this.it === id) this.setIt(nextId, 'leave')
    else if (hostLeft && next) this.broadcastGame('host', nextId)
    else this.persist()
  }

  // -------------------------------------------------------------------------------------
  // Persistence (Durable Object hibernation)
  // -------------------------------------------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      params: Object.fromEntries(this.values), it: this.it, scores: { ...this.scores }, nextId: this.nextId,
      host: this.host, locked: this.locked, zone: this.koth.zone,
    }
  }

  restore(s: RoomSnapshot): void {
    for (const id in s.params) {
      const v = this.validateParam(id, s.params[id])
      if (v !== null) this.values.set(id, v)
    }
    this.it = s.it
    this.scores = { ...s.scores }
    this.nextId = Math.max(this.nextId, s.nextId)
    this.host = s.host ?? 0
    this.locked = Boolean(s.locked)
    this.mode = this.paramNumber(gameMode.def)
    this.koth.zone = s.zone ? cleanZone(s.zone) : null
  }

  /** Re-attach a peer that was already joined before the process hibernated. No broadcast. */
  adopt(peer: Peer, info: PlayerInfo): void {
    const full: PlayerInfo = {
      ...info, score: this.scores[info.id] ?? info.score ?? 0,
      kind: cleanKind(info.kind) ?? 'buggy', colors: cleanColors(info.colors) ?? [...DEFAULT_COLORS],
    }
    this.players.set(peer, this.newPlayer(full))
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
    if (this.players.size >= this.maxPlayers) {
      this.sendTo(peer, { type: 'error', message: 'room is full' })
      peer.close(4001, 'full')
      return
    }
    this.pending.delete(peer)

    // The first player into an empty room brings the world, as the host did in the original.
    if (this.players.size === 0 && msg.params && typeof msg.params === 'object') {
      for (const id in msg.params) this.storeParam(id, msg.params[id])
      const mode = this.paramNumber(gameMode.def)
      if (mode !== this.mode) {
        this.mode = mode
        this.resetRound()
      }
    }

    const used = new Set([...this.players.values()].map((p) => p.info.slot))
    let slot = 0
    while (used.has(slot)) slot++
    const id = this.nextId++
    if (this.nextId > MAX_PLAYER_ID) this.nextId = 1
    const info: PlayerInfo = {
      id, name: cleanName(msg.name, id), slot, score: 0,
      kind: cleanKind(msg.kind) ?? 'buggy',
      colors: cleanColors(msg.colors) ?? [...DEFAULT_COLORS],
    }
    const player = this.newPlayer(info)
    this.players.set(peer, player)
    this.scores[info.id] = 0

    if (!this.it || !this.byId(this.it)) this.it = info.id
    if (!this.host || !this.byId(this.host)) this.host = info.id

    this.sendTo(peer, {
      type: 'welcome',
      v: PROTOCOL_VERSION,
      id: info.id,
      slot,
      room: this.name,
      players: this.playerList(),
      params: Object.fromEntries(this.values),
      game: this.gameState(),
      serverTime: this.now() / 1000,
    })
    // Show the newcomer where everyone already is, even players who are standing still.
    for (const other of this.players.values()) {
      if (other !== player && other.lastState) peer.send(encodeStored(other))
    }
    this.broadcast({ type: 'join', player: info }, peer)
    this.broadcast({ type: 'game', game: this.gameState(), event: this.it === info.id ? 'default' : undefined, actor: this.it })
    this.persist()
  }

  private onState(player: Player, bytes: Uint8Array): void {
    if (bytes.byteLength !== STATE_BYTES || !this.budget(player, 'state')) return
    const state = decodeState(bytes)
    if (!state) return
    if (state.bot) {
      this.onBotState(player, state, bytes)
      return
    }
    state.id = player.info.id
    player.lastState = state
    player.lastStateAt = this.now()
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
      bot = this.newPlayer({ id: state.id, name: `Bot ${n + 1}`, slot: -1, score: 0, kind: 'buggy', colors: ['#3a3f47', '#ffb000'], bot: true })
      // Bots appear and vanish with a slider; they do not get a newcomer's grace period.
      bot.lastTag = -Infinity
      this.bots.set(state.id, bot)
      this.scores[state.id] ??= 0
      this.broadcast({ type: 'join', player: bot.info })
    }
    bot.lastState = state
    bot.lastStateAt = this.now()
    const out = bytes.slice()
    for (const [peer, other] of this.players) if (other !== sender) peer.send(out)
  }

  private expireBots(): void {
    const now = this.now()
    for (const [id, bot] of this.bots) {
      if (now - bot.lastStateAt < BOT_EXPIRY_MS) continue
      this.bots.delete(id)
      delete this.scores[id]
      this.broadcast({ type: 'leave', id })
      if (this.it === id) {
        const next = this.players.values().next().value as Player | undefined
        this.setIt(next ? next.info.id : 0, 'leave')
      }
    }
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
    const value = this.storeParam(id, raw)
    if (value === null) return
    // Everyone, including the sender, gets the stored value: if the server clamped it, the
    // sender's slider snaps to what the room actually uses.
    this.broadcast({ type: 'param', id, value, from: player.info.id })
    this.persist()
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

  /** A client says its vehicle fell in. Credit whoever touched it last, within the window. */
  private onDied(player: Player): void {
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
      this.broadcastGame('knock', by.info.id, id)
      this.checkWin(by.info.id, now)
    } else {
      this.broadcastGame('died', id)
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
      if (st && fresh && !st.paused && !k.out[p.info.id] && inZone(zone, st.p)) inside.push(p)
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
    if (!this.paramBool(lasersAllowed.def)) return
    if (!isShot(shot)) return
    const now = this.now()
    // A little slack for jitter between the client's timer and arrival here.
    const interval = this.paramNumber(laserInterval.def) * 1000 * 0.8
    if (now - player.lastFireAt < interval) return
    const st = player.lastState
    if (!st || st.paused || now - player.lastStateAt > RESPONDING_MS) return
    const speed = Math.hypot(...st.v)
    if (dist(shot.o, st.p) > 8 + speed * 0.5) return
    if (shot.boost < 0 || shot.boost > Math.max(5, speed * 1.5)) return
    // Never let a client claim a firing time far from now: projectiles are replayed from it.
    shot.t = Math.min(now / 1000, Math.max(now / 1000 - 1, shot.t))
    const len = Math.hypot(...shot.d)
    shot.d = [shot.d[0] / len, shot.d[1] / len, shot.d[2] / len]
    player.lastFireAt = now
    player.shots.set(shot.id, now)
    if (player.shots.size > 64) player.shots.delete(player.shots.keys().next().value as number)
    this.broadcast({ type: 'fire', from: player.info.id, shot }, peer)
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
    if (now - firedAt > (laserLifetime(this.paramNumber(laserSpeed.def)) + 1) * 1000) return
    shooter.shots.delete(shotId)
    this.broadcast({ type: 'hit', shooter: shooter.info.id, victim: victim.info.id, shot: shotId })
    if (this.mode !== MODE_TAG) {
      // On the hill a laser is a shove, and counts as contact for knock-ins.
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
  private onRam(reporter: Player, otherId: unknown): void {
    if (typeof otherId !== 'number') return
    const other = this.byId(otherId)
    if (!other || other === reporter) return
    const now = this.now()
    const a = reporter.lastState
    const b = other.lastState
    if (!a || !b || a.paused || b.paused || now - reporter.lastStateAt > RESPONDING_MS || now - other.lastStateAt > RESPONDING_MS) return
    // Both states are slightly old, so allow for how far fast vehicles travel meanwhile.
    const reach = this.paramNumber(tagRamReach.def) + (Math.hypot(...a.v) + Math.hypot(...b.v)) * 0.3
    if (dist(a.p, b.p) > reach) return
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
      info, lastState: null, lastStateAt: 0, lastFireAt: -Infinity, shots: new Map(), lastTag: now,
      windowStart: now, stateCount: 0, jsonCount: 0,
    }
  }

  private budget(player: Player, kind: 'state' | 'json'): boolean {
    const now = this.now()
    if (now - player.windowStart >= 1000) {
      player.windowStart = now
      player.stateCount = 0
      player.jsonCount = 0
    }
    if (kind === 'state') return ++player.stateCount <= MAX_STATES_PER_SECOND
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
      it: this.it, scores: { ...this.scores }, host: this.host, locked: this.locked,
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
    this.onPersist?.(this.snapshot())
  }
}

function emptyKoth(): KothState {
  return { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {} }
}

function encodeStored(p: Player): Uint8Array {
  return encodeState(p.lastState!)
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
