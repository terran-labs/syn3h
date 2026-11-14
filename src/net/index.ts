/**
 * Seam: multiplayer. Called once after the local player exists.
 *
 * Mars Explorer's model, rebuilt: this client simulates only its own vehicle (and, on the
 * host, the bots) and sends their states 20 times a second; the room server relays them;
 * remote vehicles are played back from snapshot buffers and stay physical near us so ramming
 * works. Lasers, identity and the tag game ride on rare JSON messages.
 * See docs/architecture/mars-explorer.md, Networking.
 */
import * as THREE from 'three/webgpu'
import { type ParamValue, params } from '../../shared/params'
import {
  BOT_ID_BASE,
  type ClientMessage,
  DEFAULT_COLORS,
  type GameState,
  type HillZone,
  MAX_BOTS,
  MODE_KOTH,
  MODE_TAG,
  type PlayerInfo,
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireState,
  type WireVehicleKind,
  cleanColor,
  cleanKind,
  decodeState,
  encodeState,
  isBotId,
  parseJson,
} from '../../shared/protocol'
import type { Game, System } from '../core/Game'
import { createVehicle, type VehicleKind } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { Lasers } from '../weapons/Lasers'
import { laserInterval, lasersAllowed } from '../weapons/params'
import { BoundsGuard, TagMarker } from '../modes/Tag'
import { gameMode, kothKnockBonus, kothLaserPush, kothTargetScore, kothZoneRadius } from '../modes/params'
import { type HillTerrain, computeHillZone } from '../modes/hill'
import { HillMarker } from '../modes/HillMarker'
import { LocalLife } from '../modes/Koth'
import { ServerClock } from './Clock'
import { Connection, serverUrl } from './Connection'
import { NameTags } from './NameTags'
import { netExtrapolate, netInterpDelay, netProxyBlend, netProxyRadius, netSendRate } from './params'
import { RemotePlayer } from './RemotePlayer'

/** The slice of GameAudio (src/audio) networking uses. */
export interface NetAudio {
  play(sound: 'laserShot' | 'laserHit' | 'materialize', position?: { x: number; y: number; z: number }): void
  impact(strength: number, position?: { x: number; y: number; z: number }): void
}

/**
 * The slice of the bot manager (src/bots) networking uses. Every client may have one, since
 * `bots.count` is a shared parameter; only the host's simulates. Networking sets `remote`:
 * when true the manager must not drive its vehicles (no AI input, no teleports), because
 * networking steers them from the host's states.
 */
export interface NetBots {
  readonly vehicles: readonly Vehicle[]
  remote?: boolean
}

export interface PlayerColors {
  body: string
  accent: string
}

export interface NetContext {
  game: Game
  terrain: Terrain
  /** The local player's vehicle. */
  player: Vehicle
  /** Player name from the start screen. Falls back to ?name= or a generated one. */
  name?: string
  /** Room name from the URL (?room=name), or 'lobby'. */
  room: string
  /** Vehicle kind chosen on the start screen. Falls back to `player.kind`, then 'buggy'. */
  kind?: VehicleKind
  /** Colours chosen on the start screen, as '#rrggbb'. */
  colors?: PlayerColors
  /** Sound effects; optional so networking runs without audio. */
  audio?: NetAudio
  /** Bot manager; optional, may also be attached later with `net.attachBots`. */
  bots?: NetBots
  /** Text lines for the HUD (player list, scores, connection state). */
  setStatus(lines: string[]): void
}

/** Something that happened, for the HUD and for automated checks. */
export interface NetEvent {
  at: number
  text: string
}

/** Contact closer than this counts as touching. */
const CONTACT_DIST = 0.05
/** Do not repeat a ram report for the same pair more often than this, in seconds. */
const RAM_REPEAT = 0.5
/** Heartbeat interval for a hidden tab, ms. Browsers allow about one timer a second there. */
const HEARTBEAT_MS = 1000

// Every vehicle kind the game can build must be one the server accepts.
type KindsCovered = VehicleKind extends WireVehicleKind ? true : false
const kindsCovered: KindsCovered = true
void kindsCovered

/** Optional vehicle features another module is adding; called only if present. */
interface VehicleExtras {
  kind?: string
  setColors?(body: string, accent: string): void
}

export class NetClient implements System {
  readonly clock = new ServerClock()
  readonly conn: Connection
  readonly lasers: Lasers
  /** Remote players and remote bots, by id. */
  readonly remotes = new Map<number, RemotePlayer>()
  readonly players = new Map<number, PlayerInfo>()
  readonly events: NetEvent[] = []
  id = 0
  slot = 0
  game: GameState = {
    it: 0, scores: {}, host: 0, locked: false, mode: MODE_TAG,
    koth: { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {} },
  }
  /** Counts for automated checks. */
  stats = { deaths: 0, statesSent: 0, statesReceived: 0, rams: 0, hitsTaken: 0, hitsJudged: 0, shotsFired: 0, heartbeats: 0, botStatesSent: 0 }

  private kind: WireVehicleKind
  private colors: [string, string]
  private bots: NetBots | null
  private wasHost = false
  private welcomed = false
  private everWelcomed = false
  private sendTimer = 0
  private pingTimer = 0
  private pingsSent = 0
  private lastFire = -Infinity
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly marker: TagMarker
  private readonly bounds: BoundsGuard
  private readonly tags: NameTags
  private readonly hill: HillMarker
  private readonly life: LocalLife
  private zoneTimer = 0
  private localZone: HillZone | null = null
  private localZoneKey = ''

  constructor(private readonly ctx: NetContext) {
    const { game, player } = ctx
    this.kind = cleanKind(ctx.kind) ?? cleanKind((player as VehicleExtras).kind) ?? 'buggy'
    this.colors = [cleanColor(ctx.colors?.body) ?? DEFAULT_COLORS[0], cleanColor(ctx.colors?.accent) ?? DEFAULT_COLORS[1]]
    this.bots = ctx.bots ?? null
    if (this.bots) this.bots.remote = true
    this.conn = new Connection(serverUrl(ctx.room))
    this.lasers = new Lasers(game, {
      bodyOf: (id) => this.vehicleOf(id)?.body,
      judgedId: (h) => this.judgedId(h),
      isVehicleBody: (h) => [...this.remotes.values()].some((r) => r.vehicle.body.handle === h),
      onHit: (shooter, shot, victim, at, dir) => {
        if (victim === this.id) this.stats.hitsTaken++
        // On the hill a laser shoves. The judging client owns the victim, so it applies it.
        if (this.mode === MODE_KOTH && kothLaserPush.value > 0) {
          const body = this.vehicleOf(victim)?.body
          if (body) {
            const m = body.mass() * kothLaserPush.value
            body.applyImpulse({ x: dir.x * m, y: dir.y * m + m * 0.2, z: dir.z * m }, true)
          }
        }
        this.stats.hitsJudged++
        this.ctx.audio?.play('laserHit', at)
        if (!this.connected) return
        this.send(victim === this.id ? { type: 'hit', shooter, shot } : { type: 'hit', shooter, shot, victim })
      },
    })
    this.marker = new TagMarker(game)
    this.marker.local = player
    this.bounds = new BoundsGuard(player, ctx.terrain)
    this.bounds.onReset = () => this.event('You fell off the planet')
    this.tags = new NameTags(game.camera)
    this.hill = new HillMarker(game)
    this.life = new LocalLife(game, ctx.terrain, player)
    this.life.onDied = (cause) => {
      this.stats.deaths++
      this.event(cause === 'lava' ? 'You fell in the lava' : 'You fell off the world')
      if (this.connected) this.send({ type: 'died', cause })
    }
    this.life.onRespawn = () => {
      const p = this.ctx.player.body.translation()
      this.ctx.audio?.play('materialize', p)
    }

    this.conn.onOpen = () => {
      this.send({
        type: 'hello', v: PROTOCOL_VERSION, name: playerName(), params: params.snapshot('world'),
        kind: this.kind, colors: this.colors,
      })
    }
    this.conn.onText = (text) => {
      const msg = parseJson<ServerMessage>(text)
      if (msg) this.onMessage(msg)
    }
    this.conn.onBinary = (data) => this.onState(data)
    this.conn.onClose = () => this.onDisconnect()

    params.onChange((id, value, source) => this.onParamChange(id, value, source))
    // Registered after main.ts's listener, so this runs last and wins: our own slot, not 0.
    ctx.terrain.onRegenerate?.(() => this.onTerrainRegenerated())
    document.addEventListener('visibilitychange', () => this.onVisibility())

    // The original fired with the mouse; nothing else uses a canvas click yet.
    const canvas = game.renderer.domElement
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) game.input.mouseFire = true })
    window.addEventListener('pointerup', () => { game.input.mouseFire = false })
    window.addEventListener('blur', () => { game.input.mouseFire = false })
  }

  start(): void {
    const g = this.ctx.game
    g.add(this)
    g.add(this.lasers)
    g.add(this.marker)
    g.add(this.bounds)
    g.add(this.hill)
    this.conn.open()
  }

  get connected(): boolean {
    return this.conn.state === 'open' && this.welcomed
  }

  get isHost(): boolean {
    return this.connected && this.game.host === this.id
  }

  get locked(): boolean {
    return this.game.locked
  }

  /** Host only: lock shared sliders for everyone else. Returns false if not allowed. */
  setLocked(locked: boolean): boolean {
    if (!this.isHost) return false
    this.send({ type: 'lock', locked })
    return true
  }

  /** The rule set in force: the room's when connected, the local slider otherwise. */
  get mode(): number {
    return this.connected ? this.game.mode : gameMode.value
  }

  /** The hill zone in force: the room's (from the host) when known, else our own. */
  get zone(): HillZone | null {
    return (this.connected && this.game.koth.zone) || this.localZone
  }

  /** True if this client may change 'world' parameters right now. */
  get canEditWorld(): boolean {
    return !this.connected || !this.game.locked || this.isHost
  }

  /** Announce a new vehicle kind or colours (the local vehicle itself is main.ts's to swap). */
  setProfile(p: { kind?: VehicleKind; colors?: PlayerColors }): void {
    if (p.kind) this.kind = cleanKind(p.kind) ?? this.kind
    if (p.colors) {
      this.colors = [cleanColor(p.colors.body) ?? this.colors[0], cleanColor(p.colors.accent) ?? this.colors[1]]
    }
    if (this.connected) this.send({ type: 'profile', kind: this.kind, colors: this.colors })
  }

  /** Attach the bot manager once it exists. */
  attachBots(bots: NetBots): void {
    this.bots = bots
    bots.remote = !this.isHost
    this.wasHost = !this.isHost // force the role switch to run on the next frame
  }

  // -------------------------------------------------------------------------------------
  // Fixed step
  // -------------------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    const player = this.ctx.player
    const now = this.clock.now()
    const lp = player.body.translation()
    const radius = netProxyRadius.value
    const blend = netProxyBlend.value
    const maxEx = netExtrapolate.value
    for (const [id, r] of this.remotes) {
      // The bot manager may have removed a vehicle we were steering (bot count lowered).
      if (!r.owned && !this.bots?.vehicles.includes(r.vehicle)) {
        this.remotes.delete(id)
        continue
      }
      r.delay = r.buffer.delay(dt, netInterpDelay.value)
      r.steer(now - r.delay, maxEx, lp, radius, blend)
    }

    // Firing, rate limited (VehicleMe.js 45-66). Works offline too.
    const t = this.ctx.game.time
    if (this.ctx.game.input.state.fire && lasersAllowed.value && t - this.lastFire >= laserInterval.value) {
      this.lastFire = t
      this.fire()
    }
  }

  /**
   * Fire one laser from the local vehicle: straight ahead, along `direction`, or from the
   * muzzle toward the world point `target` (for aim assist and automated checks).
   */
  fire(direction?: [number, number, number], target?: { x: number; y: number; z: number }): void {
    const shot = this.lasers.aim(this.ctx.player.body, this.clock.now())
    if (target) direction = [target.x - shot.o[0], target.y - shot.o[1], target.z - shot.o[2]]
    if (direction) {
      const len = Math.hypot(...direction) || 1
      shot.d = [direction[0] / len, direction[1] / len, direction[2] / len]
    }
    this.lasers.spawn(this.id, shot)
    this.ctx.audio?.play('laserShot', { x: shot.o[0], y: shot.o[1], z: shot.o[2] })
    this.stats.shotsFired++
    if (this.connected) this.send({ type: 'fire', shot })
  }

  postPhysics(dt: number): void {
    if (this.mode === MODE_KOTH) this.life.check()
    else this.life.revive()
    this.life.slot = this.slot
    if (!this.connected) return
    this.detectRams()
    this.sendTimer += dt
    // While hidden the heartbeat timer speaks for us (rendering may still tick in some cases).
    if (this.sendTimer >= 1 / netSendRate.value && !document.hidden) {
      this.sendTimer = 0
      this.sendState()
      if (this.isHost) this.sendBots()
    }
  }

  update(dt: number): void {
    this.pingTimer -= dt
    if (this.conn.state === 'open' && this.pingTimer <= 0) {
      // Quick pings at first to sync the clock, then a slow heartbeat.
      this.pingTimer = this.pingsSent < 5 ? 0.25 : 2
      this.pingsSent++
      this.send({ type: 'ping', t: performance.now() })
    }
    this.updateBotRole()
    const koth = this.mode === MODE_KOTH
    this.updateHill(dt, koth)
    const it = koth ? 0 : this.game.it
    this.marker.target = it ? (this.vehicleOf(it) ?? null) : null
    const out = koth && this.connected ? this.game.koth.out : {}
    const holder = koth ? this.game.koth.holder : 0
    for (const [id, r] of this.remotes) r.vehicle.object.visible = !out[id]
    this.tags.update([...this.remotes.entries()].filter(([id]) => !out[id]).map(([id, r]) => ({
      vehicle: r.vehicle,
      name: r.info.name,
      it: id === it || id === holder,
      note: [id === it ? 'IT' : '', id === holder ? 'KING' : '', r.paused ? 'paused' : !r.responding ? 'not responding' : ''].filter(Boolean).join(' '),
    })))
    this.ctx.setStatus(this.status())
  }

  /** Compute the zone from the terrain; the host tells the room; everyone draws it. */
  private updateHill(dt: number, koth: boolean): void {
    this.zoneTimer -= dt
    if (koth && this.zoneTimer <= 0) {
      this.zoneTimer = 1
      this.localZone = computeHillZone(this.ctx.terrain as unknown as HillTerrain, kothZoneRadius.value)
      const key = JSON.stringify(this.localZone)
      const roomKey = JSON.stringify(this.game.koth.zone)
      if (this.isHost && key !== roomKey && key !== this.localZoneKey) {
        this.localZoneKey = key
        this.send({ type: 'zone', zone: this.localZone })
      }
      if (key === roomKey) this.localZoneKey = ''
    }
    this.hill.setZone(koth ? this.zone : null)
    const k = this.game.koth
    this.hill.tint = !this.connected ? 'free' : k.contested ? 'contested' : k.holder === this.id ? 'mine' : k.holder ? 'theirs' : 'free'
  }

  dispose(): void {
    this.conn.close()
    this.stopHeartbeat()
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
    this.tags.dispose()
  }

  // -------------------------------------------------------------------------------------
  // Vehicles and roles
  // -------------------------------------------------------------------------------------

  /** The vehicle that stands for an id on this client, if any. */
  vehicleOf(id: number): Vehicle | undefined {
    if (id === this.id) return this.ctx.player
    const r = this.remotes.get(id)
    if (r) return r.vehicle
    if (isBotId(id) && this.isHost) return this.bots?.vehicles[id - BOT_ID_BASE]
    return undefined
  }

  private judgedId(handle: number): number | null {
    if (handle === this.ctx.player.body.handle) return this.id
    if (this.isHost && this.bots) {
      const i = this.bots.vehicles.findIndex((v) => v.body.handle === handle)
      if (i >= 0 && i < MAX_BOTS) return BOT_ID_BASE + i
    }
    return null
  }

  /** Become or stop being the bot simulator when hosting changes hands. */
  private updateBotRole(): void {
    const host = this.isHost
    if (host === this.wasHost) return
    this.wasHost = host
    if (this.bots) this.bots.remote = !host
    if (!host) return
    // Take over: our copies of the bots stop following the old host and simulate from here.
    for (const [id, r] of [...this.remotes]) {
      if (!isBotId(id)) continue
      this.remotes.delete(id)
      if (r.owned) this.ctx.game.remove(r.vehicle)
      else r.setPhysical(true)
    }
    if (this.bots?.vehicles.length) this.event('You are host: simulating bots')
  }

  private sendState(): void {
    const s = this.ctx.player.getState()
    this.conn.send(encodeState({ id: 0, t: this.clock.now(), ...s }) as Uint8Array<ArrayBuffer>)
    this.stats.statesSent++
  }

  private sendBots(): void {
    const list = this.bots?.vehicles ?? []
    const t = this.clock.now()
    for (let i = 0; i < list.length && i < MAX_BOTS; i++) {
      const s = list[i].getState()
      this.conn.send(encodeState({ id: BOT_ID_BASE + i, t, ...s, bot: true }) as Uint8Array<ArrayBuffer>)
      this.stats.botStatesSent++
    }
  }

  /** Local vehicles (ours, and the bots on the host) against each physical proxy. */
  private detectRams(): void {
    const now = this.ctx.game.time
    for (const [id, r] of this.remotes) {
      if (!r.physical) {
        r.touching = false
        continue
      }
      const touching = this.touching(this.ctx.player, r.vehicle)
      if (touching && !r.touching && now - r.lastRamSent > RAM_REPEAT) {
        r.lastRamSent = now
        this.onContact(id, r.vehicle)
      }
      r.touching = touching
    }
    // On the host, our own player against our own bots: both are simulated here.
    if (this.isHost && this.bots) {
      this.bots.vehicles.forEach((bot, i) => {
        if (i >= MAX_BOTS) return
        const id = BOT_ID_BASE + i
        const touching = this.touching(this.ctx.player, bot)
        const key = bot as Vehicle & { __netTouching?: boolean; __netRamAt?: number }
        if (touching && !key.__netTouching && now - (key.__netRamAt ?? -Infinity) > RAM_REPEAT) {
          key.__netRamAt = now
          this.onContact(id, bot)
        }
        key.__netTouching = touching
      })
    }
  }

  private touching(a: Vehicle, b: Vehicle): boolean {
    const world = this.ctx.game.world
    let touching = false
    for (let i = 0; i < a.body.numColliders() && !touching; i++) {
      for (let j = 0; j < b.body.numColliders() && !touching; j++) {
        world.contactPair(a.body.collider(i), b.body.collider(j), (m) => {
          for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) < CONTACT_DIST) touching = true
        })
      }
    }
    return touching
  }

  private onContact(id: number, other: Vehicle): void {
    this.stats.rams++
    const a = this.ctx.player.body.linvel()
    const b = other.body.linvel()
    const p = this.ctx.player.body.translation()
    this.ctx.audio?.impact(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), p)
    this.event(`Ram: you and ${this.nameOf(id)}`)
    // In tag only contact involving "it" means anything; on the hill every touch may be the
    // push that knocks someone in. The server checks again anyway.
    if (this.game.mode === MODE_KOTH || this.game.it === this.id || this.game.it === id) this.send({ type: 'ram', other: id })
  }

  private spawnRemote(info: PlayerInfo, s: WireState): RemotePlayer {
    // A remote bot reuses our own bot manager's vehicle when there is one: same count everywhere.
    const managed = isBotId(info.id) ? this.bots?.vehicles[info.id - BOT_ID_BASE] : undefined
    let vehicle: Vehicle
    if (managed) {
      vehicle = managed
    } else {
      vehicle = createVehicle(this.ctx.game, this.ctx.terrain, info.kind as VehicleKind, new THREE.Vector3(...s.p), 0)
      vehicle.isLocal = false
      vehicle.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true)
      this.ctx.game.add(vehicle)
      ;(vehicle as VehicleExtras).setColors?.(info.colors[0], info.colors[1])
    }
    const r = new RemotePlayer(info, vehicle, !managed)
    this.remotes.set(info.id, r)
    this.ctx.audio?.play('materialize', { x: s.p[0], y: s.p[1], z: s.p[2] })
    return r
  }

  private removeRemote(id: number): void {
    const r = this.remotes.get(id)
    if (!r) return
    this.remotes.delete(id)
    if (r.owned) this.ctx.game.remove(r.vehicle)
  }

  /** Kind or colours changed: recolour, or rebuild the vehicle if the kind changed. */
  private applyProfile(info: PlayerInfo): void {
    const r = this.remotes.get(info.id)
    if (!r) return
    r.info = info
    const extras = r.vehicle as VehicleExtras
    if (r.owned && extras.kind !== undefined && extras.kind !== info.kind) {
      const t = r.vehicle.body.translation()
      const q = r.vehicle.body.rotation()
      this.ctx.game.remove(r.vehicle)
      const v = createVehicle(this.ctx.game, this.ctx.terrain, info.kind as VehicleKind, new THREE.Vector3(t.x, t.y, t.z), 0)
      v.body.setRotation(q, true)
      this.ctx.game.add(v)
      const next = new RemotePlayer(info, v)
      for (const s of [...r.buffer.states].reverse()) next.buffer.push(s, s.t, netSendRate.value)
      this.remotes.set(info.id, next)
      ;(v as VehicleExtras).setColors?.(info.colors[0], info.colors[1])
      return
    }
    extras.setColors?.(info.colors[0], info.colors[1])
  }

  private onTerrainRegenerated(): void {
    if (this.everWelcomed) {
      const s = this.ctx.terrain.spawnPoint(this.slot)
      this.ctx.player.teleport(s.position, s.heading)
    }
    const h = (x: number, z: number) => this.ctx.terrain.heightAt(x, z)
    for (const r of this.remotes.values()) r.reseat(h)
  }

  // -------------------------------------------------------------------------------------
  // Hidden tabs
  // -------------------------------------------------------------------------------------

  private onVisibility(): void {
    if (document.hidden) {
      if (this.heartbeat) return
      // The render loop stops in a hidden tab; a timer still runs about once a second.
      this.heartbeat = setInterval(() => this.sendHeartbeat(), HEARTBEAT_MS)
      this.sendHeartbeat()
    } else {
      this.stopHeartbeat()
    }
  }

  private sendHeartbeat(): void {
    if (!this.connected) return
    const s = this.ctx.player.getState()
    this.conn.send(encodeState({ id: 0, t: this.clock.now(), ...s, v: [0, 0, 0], w: [0, 0, 0], paused: true }) as Uint8Array<ArrayBuffer>)
    this.stats.heartbeats++
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  // -------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------

  private send(msg: ClientMessage): void {
    this.conn.send(JSON.stringify(msg))
  }

  private onState(data: ArrayBuffer): void {
    const s = decodeState(data)
    if (!s || s.id === this.id) return
    // The host already simulates the bots; ignore any stragglers from a previous host.
    if (s.bot && this.isHost) return
    const info = this.players.get(s.id)
    if (!info) return
    const r = this.remotes.get(s.id) ?? this.spawnRemote(info, s)
    r.push(s, this.clock.now(), netSendRate.value)
    this.stats.statesReceived++
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.id = msg.id
        this.slot = msg.slot
        this.clock.seed(msg.serverTime)
        this.players.clear()
        for (const p of msg.players) this.players.set(p.id, p)
        this.game = normalizeGame(msg.game)
        // The room's world (seed included) first: the terrain regenerates before anything
        // spawns, and onTerrainRegenerated seats us on the new ground.
        params.applySnapshot(msg.params, 'remote')
        this.welcomed = true
        this.bounds.slot = msg.slot
        if (!this.everWelcomed) {
          // Spread players out; on a reconnect, stay where we are.
          const s = this.ctx.terrain.spawnPoint(msg.slot)
          this.ctx.player.teleport(s.position, s.heading)
          this.ctx.audio?.play('materialize', s.position)
        }
        this.everWelcomed = true
        this.event(`Joined room ${msg.room} as ${this.players.get(msg.id)?.name}`)
        break
      }
      case 'pong':
        this.clock.pong(msg.t, msg.serverTime)
        break
      case 'join':
        this.players.set(msg.player.id, msg.player)
        if (!msg.player.bot) this.event(`${msg.player.name} joined`)
        break
      case 'profile':
        this.players.set(msg.player.id, msg.player)
        this.applyProfile(msg.player)
        break
      case 'leave':
        if (!isBotId(msg.id)) this.event(`${this.nameOf(msg.id)} left`)
        this.players.delete(msg.id)
        this.removeRemote(msg.id)
        break
      case 'param':
        params.set(msg.id, msg.value, 'remote')
        if (msg.from === 0) this.event(`Shared sliders are locked by the host`)
        break
      case 'fire':
        if (this.players.has(msg.from)) {
          this.lasers.spawn(msg.from, msg.shot, this.clock.now() - msg.shot.t)
          const [x, y, z] = msg.shot.o
          this.ctx.audio?.play('laserShot', { x, y, z })
        }
        break
      case 'hit': {
        const victim = this.vehicleOf(msg.victim)
        this.lasers.confirmHit(msg.shooter, msg.shot, victim?.object.position)
        // The judging client already played it.
        if (victim && victim !== this.ctx.player && !(isBotId(msg.victim) && this.isHost)) {
          this.ctx.audio?.play('laserHit', victim.object.position)
        }
        break
      }
      case 'game':
        this.onGame(msg)
        break
      case 'error':
        this.event(`Server: ${msg.message}`)
        break
    }
  }

  private onGame(msg: Extract<ServerMessage, { type: 'game' }>): void {
    const before = this.game
    this.game = normalizeGame(msg.game)
    msg.game = this.game
    for (const [id, score] of Object.entries(msg.game.scores)) {
      const p = this.players.get(Number(id))
      if (p) p.score = score
    }
    const a = msg.actor ? this.nameOf(msg.actor) : ''
    const b = msg.target ? this.nameOf(msg.target) : ''
    const is = (name: string) => (name === 'You' ? 'are' : 'is')
    switch (msg.event) {
      case 'ram': this.event(`${a} rammed ${b} and ${is(a)} it`); break
      case 'laser': this.event(`${a} shot ${b} and ${is(a)} it`); break
      case 'score': this.event(`${a} tagged ${b}`); break
      case 'default': if (msg.actor !== this.id) this.event(`${a} is it`); break
      case 'leave': if (msg.game.it && msg.game.it !== this.id) this.event(`${this.nameOf(msg.game.it)} is it`); break
      case 'lock': this.event(msg.game.locked ? 'Host locked shared sliders' : 'Host unlocked shared sliders'); break
      case 'host': this.event(msg.actor === this.id ? 'You are now host' : `${a} is now host`); break
      case 'mode': this.event(msg.game.mode === MODE_KOTH ? 'King of the Hill: get to the rim and hold it' : 'Tag: ram or shoot whoever is it'); break
      case 'capture': this.event(`${a} ${msg.actor === this.id ? 'hold' : 'holds'} the hill`); break
      case 'contest': this.event('The hill is contested'); break
      case 'died': this.event(`${a} fell in`); break
      case 'knock': this.event(`${a} knocked ${b} in: +${kothKnockBonus.value}`); break
      case 'win':
        this.event(`${a} ${msg.actor === this.id ? 'win' : 'wins'} the hill!`)
        this.ctx.audio?.play('materialize', this.vehicleOf(msg.actor ?? 0)?.object.position)
        break
      case 'reset': this.event('New round'); break
    }
    if (before.it !== msg.game.it && msg.game.it === this.id) this.event('You are it')
  }

  private onParamChange(id: string, value: ParamValue, source: string): void {
    if (source === 'remote' || !this.connected) return
    const p = params.get(id)
    if (!p || p.def.scope !== 'world') return
    // Presets are local actions too, so they sync like slider moves.
    this.send({ type: 'param', id, value })
  }

  private onDisconnect(): void {
    this.welcomed = false
    this.clock.reset()
    this.pingsSent = 0
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
    this.event('Disconnected, reconnecting')
  }

  private nameOf(id: number): string {
    return id === this.id ? 'You' : (this.players.get(id)?.name ?? `Player ${id}`)
  }

  private event(text: string): void {
    this.events.push({ at: performance.now(), text })
    if (this.events.length > 20) this.events.shift()
  }

  private modeLines(): string[] {
    const g = this.game
    if (g.mode !== MODE_KOTH) return ['mode: Tag   ram or shoot whoever is it']
    const k = g.koth
    const target = kothTargetScore.value
    const lines = [`mode: King of the Hill   first to ${target}`]
    const now = this.clock.now()
    if (k.resetAt) {
      lines.push(`${this.nameOf(k.winner).toUpperCase()} ${k.winner === this.id ? 'WIN' : 'WINS'}!   next round in ${Math.max(0, Math.ceil(k.resetAt - now))} s`)
    } else if (!k.zone) {
      lines.push('hill: waiting for the host to place it')
    } else if (k.contested) {
      lines.push('hill: CONTESTED')
    } else if (k.holder) {
      const left = Math.max(0, target - (g.scores[k.holder] ?? 0))
      lines.push(`hill: held by ${k.holder === this.id ? 'you' : this.nameOf(k.holder)}   ${left} s to win`)
    } else {
      lines.push('hill: free')
    }
    const out = k.out[this.id]
    if (out) lines.push(`you are out: respawn in ${Math.max(0, Math.ceil(out - now))} s`)
    return lines
  }

  private status(): string[] {
    const lines: string[] = []
    if (!this.connected) {
      const wait = Math.max(0, Math.ceil((this.conn.retryAt - performance.now()) / 1000))
      lines.push(this.conn.state === 'connecting' ? `net: connecting to room ${this.ctx.room}` : `net: offline, retry in ${wait}s (room ${this.ctx.room})`)
    } else {
      const delays = [...this.remotes.values()].map((r) => r.delay)
      const delay = delays.length ? Math.max(...delays) : 0
      lines.push(`net: room ${this.ctx.room}   ping ${Math.round(this.clock.rtt * 1000)} ms   delay ${Math.round(delay * 1000)} ms`)
      const host = this.game.host === this.id ? 'you' : this.nameOf(this.game.host)
      lines.push(`host: ${host}   shared sliders ${this.game.locked ? 'LOCKED (host only)' : 'open to all'}`)
      lines.push(...this.modeLines())
      const list = [...this.players.values()].sort((a, b) => Number(Boolean(a.bot)) - Number(Boolean(b.bot)) || a.slot - b.slot || a.id - b.id)
      for (const p of list) {
        const r = this.remotes.get(p.id)
        const flags = [
          this.game.mode === MODE_TAG && p.id === this.game.it ? '[IT]' : '',
          p.id === this.id ? '(you)' : '',
          p.id === this.game.host ? '(host)' : '',
          this.game.mode === MODE_KOTH && this.game.koth.out[p.id] ? '(out)' : '',
          this.game.mode === MODE_KOTH && this.game.koth.holder === p.id ? '[KING]' : '',
          r?.paused ? '(paused)' : r && !r.responding ? '(not responding)' : '',
        ].filter(Boolean).join(' ')
        const lead = this.game.mode === MODE_KOTH ? this.game.koth.holder === p.id : p.id === this.game.it
        lines.push(`${lead ? '>' : ' '} ${p.name.padEnd(14)} ${String(this.game.scores[p.id] ?? 0).padStart(3)}  ${flags}`)
      }
    }
    const now = performance.now()
    for (const e of this.events.slice(-3)) if (now - e.at < 5000) lines.push(e.text)
    return lines
  }
}

/** Fill fields an older room server does not send, so a mismatch degrades instead of throwing. */
function normalizeGame(g: Partial<GameState>): GameState {
  return {
    it: g.it ?? 0, scores: g.scores ?? {}, host: g.host ?? 0, locked: Boolean(g.locked), mode: g.mode ?? MODE_TAG,
    koth: { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {}, ...g.koth },
  }
}

/** Name chosen on the start screen, when there is one. */
let preferredName = ''

function playerName(): string {
  // An explicit ?name= wins, so links and automated checks can name players.
  const q = new URLSearchParams(location.search).get('name')
  if (q) return q.slice(0, 24)
  if (preferredName) return preferredName.slice(0, 24)
  const key = 'syn3h.name'
  let name = ''
  try {
    name = sessionStorage.getItem(key) ?? ''
    if (!name) {
      name = `Martian ${Math.floor(100 + Math.random() * 900)}`
      sessionStorage.setItem(key, name)
    }
  } catch {
    name = `Martian ${Math.floor(100 + Math.random() * 900)}`
  }
  return name
}

/** The running client, for UI code (a lock button, a colour picker) and automated checks. */
export let net: NetClient | null = null

export function startNetworking(ctx: NetContext): NetClient {
  preferredName = ctx.name?.trim() ?? ''
  net = new NetClient(ctx)
  net.start()
  const w = window as unknown as { syn3hNet?: NetClient }
  w.syn3hNet = net
  return net
}
