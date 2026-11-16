/**
 * Seam: multiplayer. Called once after the local player exists.
 *
 * Mars Explorer's model, rebuilt: this client simulates only its own vehicle (and, on the
 * host, the bots) and sends their states 20 times a second; the room server relays them;
 * remote vehicles are played back from snapshot buffers and stay physical near us so ramming
 * works. Lasers, identity and the tag game ride on rare JSON messages.
 */
import * as THREE from 'three/webgpu'
import { type ParamValue, params, worldSeed } from '../../shared/params'
import {
  BOT_ID_BASE,
  type ClientMessage,
  DEFAULT_COLORS,
  type GameState,
  type HillZone,
  MAX_BOTS,
  MODE_EXPLORE,
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
import type { BotGearHooks as BotDecisionHooks } from '../bots/gear'
import { BotGear, botGearOptions } from '../weapons/BotGear'
import { Lasers } from '../weapons/Lasers'
import { Blast } from '../weapons/blast'
import { beamAimDirection } from '../weapons/aim'
import { laserInterval, lasersAllowed } from '../weapons/params'
import { GearRack } from '../weapons/Gear'
import { Bungee } from '../weapons/bungee/Bungee'
import { Yoink } from '../weapons/yoink/Yoink'
import { BigRed } from '../weapons/BigRed'
import { Pesters } from '../weapons/pester/Pesters'
import { pesterAllowed, pesterBump, pesterCooldown, pesterMax } from '../weapons/pester/params'
import { bigRedAllowed, bigRedPush } from '../weapons/bigRedParams'
import { BoundsGuard } from '../modes/Tag'
// The "it" marker: one draw, and shown over the local player's own vehicle too.
import { ItMarker as TagMarker } from './ItMarker'
import { raceAuto, gameMode, kothKnockBonus, kothLaserPush, kothRespawnDelay, kothTargetScore, kothZoneRadius } from '../modes/params'
import { type HillTerrain, computeHillZone } from '../modes/hill'
import { HillMarker } from '../modes/HillMarker'
import { LocalRescue, StuckTimer, inStickyLiquid } from '../modes/Koth'
import { attachVehicleEffects } from '../vehicles/effects'
import { ServerClock } from './Clock'
import { Connection, serverUrl } from './Connection'
import { NameTags, type TagInfo } from './NameTags'
import { applyRoomWorld, netExtrapolate, netInterpDelay, netMaxDelay, netProxyBlend, netProxyRadius, netSendRate } from './params'
import { RemotePlayer } from './RemotePlayer'
import { pressHoldsFire } from './pointerFire'
import { LocalSeat } from './LocalSeat'
import { PausedHeartbeat } from './PausedHeartbeat'
import { announcedKind, needsRebuild } from './kinds'
import { type BotMatchInfo, audibleVehicles, bodyAlive, hillHold, liveBots } from './bots'
import { ShoveQueue, cleanShove, shoveFor } from './shove'
import { nearestImage, wrapCoord, wrapDistance } from '../../shared/wrap'
import { setWaterClock, waterTime } from '../world/water/seaWaves'
import { RaceBridge, type RaceBots, type RacePresentation } from './races'

/** The slice of GameAudio (src/audio) networking uses. */
export interface NetAudio {
  play(sound: 'laserShot' | 'laserHit' | 'materialize', position?: { x: number; y: number; z: number }): void
  impact(strength: number, position?: { x: number; y: number; z: number }): void
  /** Short synthesised cues (src/audio/Cues.ts); optional so older audio builds still fit. */
  // Method syntax on purpose: the audio's own cue list is checked bivariantly, so this fits
  // before and after the Bungee cue names land there.
  cue?(name: string, position?: { x: number; y: number; z: number }): void
}

/**
 * The slice of the bot manager (src/bots) networking uses. Every client may have one, since
 * `bots.count` is a shared parameter; only the host's simulates and is replicated.
 * Networking sets `remote`. While it is true this client is not host: the manager should hold
 * no vehicles (its local quality cap must not decide the bot set); networking spawns its own
 * replicas from the host's roster and never touches the manager's vehicles.
 */
export interface NetBots extends RaceBots {
  readonly vehicles: readonly Vehicle[]
  remote?: boolean
  /** Tell the bots what game is on (the host's manager acts on it). Null is free play. */
  setMatch?(match: BotMatchInfo<Vehicle> | null): void
  setGear?(hooks: BotDecisionHooks | null): void
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
  /** Visible notice when a full room falls back to local play. */
  onJoinStatus?(message: string): void
  /** Vehicle kind chosen on the start screen. Falls back to `player.kind`, then 'buggy'. */
  kind?: VehicleKind
  /** Colours chosen on the start screen, as '#rrggbb'. */
  colors?: PlayerColors
  /** Sound effects; optional so networking runs without audio. */
  audio?: NetAudio
  /** Cosmetic arrival effect after a remote kind change; never holds replica physics. */
  onRemoteVehicleChanged?(vehicle: Vehicle): void
  /** Bot manager; optional, may also be attached later with `net.attachBots`. */
  bots?: NetBots
  /** The match display (shell.setMatchState): called on every game state change; null clears. */
  setMatchState?(state: MatchState | null): void
  /** Seeded name generator (src/ui/data/names.ts), injected so networking imports no UI. */
  names?(seed: string, kind: 'bot' | 'player' | 'world'): string
  /** Minimap markers for remote players, bots and the hill, a few times a second. */
  setMapEntities?(entities: MapMarker[]): void
  /** Text lines for the HUD (player list, scores, connection state). */
  setStatus(lines: string[]): void
}

/** The shell's match display contract. Scores and target are points (seconds held on the hill). */
export interface MatchState {
  mode: 'tag' | 'koth'
  holderName: string | null
  holderIsYou: boolean
  contested: boolean
  scores: { name: string; score: number; you?: boolean }[]
  target: number
  winner: string | null
  /** The winner's body colour, '#rrggbb', while there is a winner. */
  winnerColor?: string
  /** Whole seconds until the next round, while there is a winner. */
  nextRoundIn?: number
}

/** Same shape as the shell minimap's MapEntity. Heading is radians about +Y, 0 facing -Z. */
export interface MapMarker {
  x: number
  z: number
  heading: number
  color: string
  self?: boolean
}

/** Something that happened, for the HUD and for automated checks. */
export interface NetEvent {
  at: number
  text: string
}

/** Contact closer than this counts as touching. */
const CONTACT_DIST = 0.05
/** Physics steps of our own velocity kept: 0.6 s, the window a relayed push looks back over. */
const VEL_HISTORY = 30

/** A relayed push is believed only from a vehicle within this distance on our screen, m. A
 * rammer's copy trails it by its speed times the playback delay, a few metres at most. */
const SHOVE_REACH = 15

/** Do not repeat a ram report for the same pair more often than this, in seconds. */
const RAM_REPEAT = 0.5
/** Heartbeat interval for a hidden tab, ms. Browsers allow about one timer a second there. */
const HEARTBEAT_MS = 1000
/** A gap this long since our last frame means our main thread, not the network, was slow. */
const LOCAL_STALL_MS = 250

/** Seconds between rebuilds of the status lines, match state and name tag text. */
const UI_INTERVAL = 0.2

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
  private readonly raceBridge: RaceBridge
  readonly conn: Connection
  private localAfterFull = false
  private joinStatus = ''
  readonly lasers: Lasers
  /** Impacts push nearby vehicles this client simulates (Weapons lane). */
  readonly blast: Blast
  /** Gear in hand (Weapons lane, src/weapons). With only the tag beam allowed, nothing changes. */
  private readonly botGear = new Map<number, BotGear>()
  readonly gear: GearRack
  readonly bungee: Bungee
  readonly yoink: Yoink
  readonly bigRed: BigRed
  readonly pesters: Pesters
  /** Remote players and remote bots, by id. */
  readonly remotes = new Map<number, RemotePlayer>()
  readonly players = new Map<number, PlayerInfo>()
  readonly events: NetEvent[] = []
  id = 0
  slot = 0
  game: GameState = {
    it: 0, scores: {}, host: 0, locked: false, mode: MODE_EXPLORE,
    koth: { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {} },
  }
  /** Counts for automated checks. */
  stats = { stuck: 0, shoves: 0, statesSent: 0, statesReceived: 0, rams: 0, hitsTaken: 0, hitsJudged: 0, shotsFired: 0, heartbeats: 0, botStatesSent: 0 }

  private kind: WireVehicleKind
  private colors: [string, string]
  private bots: NetBots | null
  private wasHost = false
  /** The shell's play state last frame: leaving play (Exit world) drops the gear. */
  private wasDriving = false
  private welcomed = false
  private everWelcomed = false
  private sendTimer = 0
  private pingTimer = 0
  private pingsSent = 0
  private lastFire = -Infinity
  private lastPester = -Infinity
  /** performance.now() at the start of the latest frame, to spot local main thread stalls. */
  private frameAt = 0
  /** Until this performance.now(), states are still the backlog of a stall the frame loop saw. */
  private stallUntil = 0
  /** Speaks for us while the game is paused or the page hidden; see PausedHeartbeat.ts. */
  private readonly heartbeat = new PausedHeartbeat({
    interval: HEARTBEAT_MS,
    send: () => this.sendHeartbeat(),
    // Whatever we measured while paused (or before) says nothing about now: start over.
    resumed: () => { for (const r of this.remotes.values()) r.buffer.restartEstimate() },
  })
  private readonly marker: TagMarker
  /** The guard and lava rescue built around the vehicle we drive; see LocalSeat.ts. */
  private readonly seat: LocalSeat<Vehicle, BoundsGuard, LocalRescue>
  private get bounds(): BoundsGuard { return this.seat.bounds }
  private get rescue(): LocalRescue { return this.seat.rescue }
  private readonly tags: NameTags
  private readonly hill: HillMarker
  /** Pushes relayed from players who rammed us, waiting to see if our physics felt them. */
  private readonly shoves = new ShoveQueue()
  /**
   * Our velocity a tenth of a second ago: what we had before a contact began. The step in
   * which a contact is first seen may already have spent most of our speed on it.
   */
  private preVel: [number, number, number] = [0, 0, 0]
  private readonly velHistory: [number, number, number][] = []
  private zoneTimer = 0
  private mapTimer = 0
  /** Seconds until the status lines, match state and name tag text are next rebuilt. */
  private uiTimer = 0
  /** Something those show has changed (a room message, an event): rebuild on the next frame. */
  private uiDirty = true
  /** The name tags' list, reused between frames; its text is rebuilt with the status. */
  private readonly tagList: TagInfo[] = []
  private localZone: HillZone | null = null
  private localZoneKey = ''

  constructor(private readonly ctx: NetContext) {
    const { game, player } = ctx
    this.kind = cleanKind(announcedKind(ctx.kind)) ?? cleanKind((player as VehicleExtras).kind) ?? 'buggy'
    this.colors = [cleanColor(ctx.colors?.body) ?? DEFAULT_COLORS[0], cleanColor(ctx.colors?.accent) ?? DEFAULT_COLORS[1]]
    this.bots = ctx.bots ?? null
    if (this.bots) this.bots.remote = true
    this.conn = new Connection(serverUrl(ctx.room))
    this.raceBridge = new RaceBridge({
      now: this.roomNow,
      role: () => ({ id: this.id, host: this.isHost, connected: this.connected }),
      synced: () => this.clock.synced,
      bots: () => this.bots,
      candidates: () => !raceAuto.value ? [] : [
        { id: this.id, vehicle: this.ctx.player, active: this.raceBridge.driving && !document.hidden, human: true },
        ...liveBots(this.bots?.vehicles ?? [], this.ctx.game.world).map(([id, vehicle]) => ({ id, vehicle, active: !document.hidden, human: false })),
      ],
      send: message => this.send(message),
    })
    this.blast = new Blast(game, {
      vehicleIds: () => this.vehicleIds(),
      bodyOf: (id) => this.vehicleOf(id)?.body,
      owns: (id) => this.ownsVehicle(id) && !materializing(this.vehicleOf(id)),
      wrapSize: () => this.wrapSize,
    })
    this.lasers = new Lasers(game, {
      onImpact: (at, red) => this.blast.at(red ? 'thunder' : 'tag', at),
      bodyOf: (id) => this.vehicleOf(id)?.body,
      judgedId: (h) => this.judgedId(h),
      isVehicleBody: (h) => [...this.remotes.values()].some((r) => r.vehicle.body.handle === h),
      onHit: (shooter, shot, victim, at, dir, red) => {
        if (materializing(this.vehicleOf(shooter)) || materializing(this.vehicleOf(victim))) return
        if (victim === this.id) this.stats.hitsTaken++
        // Big Red shoves in every mode, with some lift. The judging client owns the victim.
        if (red && bigRedPush.value > 0) {
          const body = this.vehicleOf(victim)?.body
          if (body) {
            const m = body.mass() * bigRedPush.value
            body.applyImpulse({ x: dir.x * m, y: dir.y * m + m * 0.25, z: dir.z * m }, true)
          }
        } else if (this.mode !== MODE_TAG && kothLaserPush.value > 0) {
          // On the hill, and in Explore where the beam is a toy, a beam shoves; in tag it
          // tags instead. The judging client owns the victim, so it applies it.
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
    // Gear (Weapons lane). The Bungee pulls only vehicles this client simulates.
    this.gear = new GearRack(game)
    this.bungee = new Bungee(game, {
      surface: this.grappleSurface,
      self: () => this.id,
      vehicleOf: (id) => this.vehicleOf(id),
      idOfBody: (h) => this.vehicleIdOfBody(h),
      owns: (id) => this.ownsVehicle(id),
      lagOf: (id) => this.remotes.get(id)?.delay ?? 0,
      wrapSize: () => this.wrapSize,
      now: () => this.clock.now(),
      inHand: () => this.gear.current === 'bungee',
      // Sound is cosmetic: an audio build without these cue names must never stop the Bungee.
      cue: (name, at) => { try { this.ctx.audio?.cue?.(name, at) } catch { /* no such cue yet */ } },
      // Positions go on the wire inside the tile, like every other position.
      send: (cord) => {
        if (!this.connected) return
        if (cord.s === 'hook') this.send({ type: 'cord', cord: { ...cord, o: this.canonical(cord.o) } })
        else if (cord.s === 'on' && cord.at) this.send({ type: 'cord', cord: { ...cord, at: this.canonical(cord.at) } })
        else this.send({ type: 'cord', cord })
      },
    })
    this.yoink = new Yoink(game, {
      self: () => this.id,
      vehicleOf: (id) => this.vehicleOf(id),
      vehicleIds: () => this.vehicleIds(),
      owns: (id) => this.ownsVehicle(id),
      lagOf: (id) => this.remotes.get(id)?.delay ?? 0,
      wrapSize: () => this.wrapSize,
      inHand: () => this.gear.current === 'yoink',
      responding: (id) => this.remotes.get(id)?.responding ?? true,
      heldElsewhere: (id) => [...this.botGear.values()].some(g => g.yoink.holderOf(id) !== null),
      cue: (name, at) => this.gearCue(name, at),
      send: (y) => { if (this.connected) this.send({ type: 'yoink', y }) },
    })
    this.bigRed = new BigRed(game, {
      body: () => this.ctx.player.body,
      object: () => this.ctx.player.object,
      inHand: () => this.gear.current === 'red',
      cue: (name, at) => this.gearCue(name, at),
      fire: (d) => this.fire(d, undefined, 'red'),
    })
    this.pesters = new Pesters(game, {
      self: () => this.id,
      bodyOf: (id) => this.vehicleOf(id)?.body,
      vehicleIds: () => this.vehicleIds(),
      judges: (id) => this.ownsVehicle(id),
      onBurst: (at) => this.blast.at('chaser', at),
      heightAt: (x, z) => this.ctx.terrain.heightAt(x, z),
      wrapSize: () => this.wrapSize,
      inHand: () => this.gear.current === 'pester',
      launch: (target) => this.launchPester(target),
      onCatch: (shooter, shot, victim, at, dir) => {
        if (materializing(this.vehicleOf(shooter)) || materializing(this.vehicleOf(victim))) return
        if (victim === this.id) this.stats.hitsTaken++
        // The caught player's own client bumps it, capped by the room's slider: a sender
        // cannot make this bigger.
        const body = this.vehicleOf(victim)?.body
        const bump = Math.min(pesterBump.def.max ?? 15, pesterBump.value)
        if (body && bump > 0) {
          const m = body.mass() * bump
          body.applyImpulse({ x: dir.x * m, y: m * 0.5, z: dir.z * m }, true)
        }
        this.stats.hitsJudged++
        this.gearCue('pesterCatch', at)
        if (!this.connected) return
        this.send(victim === this.id ? { type: 'hit', shooter, shot } : { type: 'hit', shooter, shot, victim })
      },
    })
    this.gear.bind({ bungee: this.bungee, yoink: this.yoink, bigRed: this.bigRed, pesters: this.pesters, nameOf: (id) => this.displayName(id) })
    this.bots?.setGear?.(this.botDecisionHooks)
    this.marker = new TagMarker(game)
    this.marker.local = player
    this.tags = new NameTags(game.camera)
    this.hill = new HillMarker(game, ctx.terrain)
    this.seat = new LocalSeat(player, {
      makeBounds: (vehicle) => {
        const bounds = new BoundsGuard(vehicle, ctx.terrain)
        bounds.onReset = () => this.event('Returned to your pad')
        return bounds
      },
      makeRescue: (vehicle) => {
        const rescue = new LocalRescue(game, ctx.terrain, vehicle)
        rescue.onStuck = () => {
          this.stats.stuck++
          this.event('You are stuck in the lava')
          if (this.connected) this.send({ type: 'stuck' })
        }
        rescue.onFreed = (by) => {
          this.event(by === 'crawled' ? 'You crawled free of the lava' : 'Returned to your pad')
          if (by === 'returned') {
            this.resetGear('own')
            this.ctx.audio?.play('materialize', this.ctx.player.body.translation())
          }
        }
        rescue.onReturned = () => {
          this.resetGear('own')
          this.event('Returned to your pad')
          this.ctx.audio?.play('materialize', this.ctx.player.body.translation())
        }
        return rescue
      },
      add: (bounds) => game.add(bounds),
      remove: (bounds) => game.remove(bounds),
    })

    this.conn.onOpen = () => {
      this.send({
        type: 'hello', v: PROTOCOL_VERSION, modes: 2, name: playerName(), params: params.snapshot('world'),
        kind: this.kind, colors: this.colors, resume: rejoinSecret(this.ctx.room),
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
    canvas.addEventListener('pointerdown', (e) => { if (pressHoldsFire(e)) game.input.mouseFire = true })
    window.addEventListener('pointerup', () => { game.input.mouseFire = false })
    window.addEventListener('blur', () => { game.input.mouseFire = false })
  }

  start(): void {
    const g = this.ctx.game
    g.add(this)
    g.add(this.lasers)
    g.add(this.gear)
    g.add(this.bungee)
    g.add(this.yoink)
    g.add(this.bigRed)
    g.add(this.pesters)
    g.add(this.marker)
    this.seat.start()
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

  /**
   * "Reset world to defaults" for the menu: every shared (world) parameter back to its default,
   * for everyone in the room, and a fresh round. Allowed when `canEditWorld` is (host, or
   * anyone while sliders are unlocked). Offline it resets this client's own world.
   * Returns false when not allowed.
   */
  resetWorld(): boolean {
    if (!this.canEditWorld) return false
    if (this.connected) {
      this.send({ type: 'reset' })
    } else {
      for (const p of params.all()) if (p.def.scope === 'world') params.set(p.def.id, p.def.default, 'local')
    }
    return true
  }

  /**
   * Drop live gear state: cords, carries, charges, Pesters and shots in flight. The one place
   * gear is reset, so no path that moves the player to another world forgets a system.
   *
   * 'all' is for a new world or leaving one (world change, Exit world, room leave): every
   * system and every bot's gear is cleared, other players' cords included, since a ground
   * anchor or a shot belongs to the old world. The player's own cord and carry are reported
   * off on the existing wires, and so are the bots' when we host them.
   *
   * 'own' is for the player alone being moved or replaced (back to the pad, a new vehicle):
   * only what the player has out is let go, and everyone else's gear is left alone.
   */
  resetGear(scope: 'all' | 'own' = 'all'): void {
    if (scope === 'own') {
      this.bungee.letGo('released')
      this.yoink.drop()
      this.bigRed.reset()
      return
    }
    this.lasers.reset()
    this.blast.reset()
    this.bungee.reset()
    this.yoink.reset()
    this.bigRed.reset()
    this.pesters.reset()
    for (const controller of this.botGear.values()) controller.reset()
  }

  /**
   * The player switched vehicle in play: `vehicle` replaces the one networking was started
   * with. Call it after the new vehicle is in the game and the old one is about to be (or has
   * been) removed, in the same frame. It:
   *  - lets go of our own cord and anything we are carrying, telling the room, since those
   *    were holding on from the old vehicle;
   *  - points everything that reads the local vehicle at the new one (states sent, rams,
   *    tools, the "it" marker), and rebuilds the pad guard and lava rescue around it;
   *  - forgets the old vehicle's contact and velocity history, so the swap is not felt as a
   *    ram or a shove;
   *  - announces the new kind to the room (and colours, if given), as `setProfile` does, so
   *    everyone else rebuilds their copy of us.
   * No reload, no reconnect, and no new protocol: the room sees a profile change. Calling it
   * with the vehicle already in use only announces the profile.
   */
  setPlayer(vehicle: Vehicle, profile: { colors?: PlayerColors } = {}): void {
    if (vehicle !== this.ctx.player) {
      // Tools first, while "our vehicle" still means the old one they are attached to. The
      // one path for the player's own gear (resetGear): setProfile below runs it again when
      // the kind changed and finds nothing left to let go.
      try {
        this.resetGear('own')
      } catch (err) {
        // Letting go is a courtesy to the room; it must never stop the swap.
        console.warn('gear not released on vehicle swap', err)
      }
      this.ctx.player = vehicle
      this.seat.swap(vehicle)
      this.marker.local = vehicle
      vehicle.isLocal = true
      this.velHistory.length = 0
      this.preVel = [0, 0, 0]
      for (const r of this.remotes.values()) {
        r.touching = false
        r.lastContactAt = -Infinity
      }
      this.uiDirty = true
    }
    this.setProfile({ kind: vehicle.kind, colors: profile.colors })
  }

  /** Announce a new vehicle kind or colours (the local vehicle itself is main.ts's to swap; see setPlayer). */
  setProfile(p: { kind?: VehicleKind; colors?: PlayerColors }): void {
    const kind = p.kind ? cleanKind(announcedKind(p.kind)) : null
    if (kind && kind !== this.kind) this.resetGear('own')
    if (kind) this.kind = kind
    if (p.colors) {
      this.colors = [cleanColor(p.colors.body) ?? this.colors[0], cleanColor(p.colors.accent) ?? this.colors[1]]
    }
    if (this.connected) this.send({ type: 'profile', kind: this.kind, colors: this.colors })
  }

  /** The shell supplies actual play state; connected lobby spectators cannot be drafted. */
  configureRaces(presentation: RacePresentation): void { this.raceBridge.configure(presentation) }
  get race() { return this.raceBridge.snapshot as Readonly<import('../../shared/protocol').RaceState> | null }
  leaveRace(): void { this.raceBridge.leave() }
  cancelRace(): void { this.raceBridge.cancel() }

  /** Attach the bot manager once it exists. */
  attachBots(bots: NetBots): void {
    this.bots?.setGear?.(null)
    this.bots = bots
    bots.setGear?.(this.botDecisionHooks)
    bots.remote = !this.isHost
    this.wasHost = !this.isHost // force the role switch to run on the next frame
  }

  // -------------------------------------------------------------------------------------
  // Fixed step
  // -------------------------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    this.syncBotGear()
    for (const controller of this.botGear.values()) controller.fixedUpdate(dt)
    const player = this.ctx.player
    const now = this.clock.now()
    const lp = player.body.translation()
    const radius = netProxyRadius.value
    const blend = netProxyBlend.value
    const maxEx = netExtrapolate.value
    for (const [id, r] of this.remotes) {
      // Defensive: a replica whose body left the world (it should not happen: we own them).
      if (!bodyAlive(this.ctx.game.world, r.vehicle)) {
        this.remotes.delete(id)
        this.uiDirty = true
        continue
      }
      r.delay = r.buffer.delay(dt, netInterpDelay.value, netMaxDelay.value)
      r.wrapSize = this.wrapSize
      r.groundAt = this.groundAt
      r.steer(now - r.delay, maxEx, lp, radius, blend)
    }
    this.applyShoves()
    const pv = this.ctx.player.body.linvel()
    this.velHistory.push([pv.x, pv.y, pv.z])
    if (this.velHistory.length > VEL_HISTORY) this.velHistory.shift()
    this.preVel = this.velHistory[Math.max(0, this.velHistory.length - 6)]

    // Firing, rate limited (VehicleMe.js 45-66). Works offline too.
    const t = this.ctx.game.time
    if (this.ctx.game.input.state.fire && this.gear.current === 'beam' && lasersAllowed.value && t - this.lastFire >= laserInterval.value) {
      this.lastFire = t
      this.fire(beamAimDirection(this.ctx.game, player.body))
    }
  }

  /**
   * Fire one laser from the local vehicle: straight ahead, along `direction`, or from the
   * muzzle toward the world point `target` (for aim assist and automated checks).
   */
  /**
   * Launch a Pester from the local vehicle at vehicle `target` (Weapons lane). Rate and the
   * number out at once are the room's to enforce; this checks them too so the button does
   * nothing visible when the room would refuse.
   */
  launchPester(target: number | null): boolean {
    if (materializing(this.ctx.player) || !pesterAllowed.value || target === null) return false
    const t = this.ctx.game.time
    if (t - this.lastPester < pesterCooldown.value || this.pesters.mine >= pesterMax.value) return false
    this.lastPester = t
    const shot = this.lasers.aim(this.ctx.player.body, this.clock.now())
    shot.k = 'pester'
    shot.to = target
    shot.d = this.pesters.launchDirection(this.ctx.player.body)
    shot.boost = 0
    this.pesters.spawn(this.id, shot)
    this.gearCue('pesterLaunch', { x: shot.o[0], y: shot.o[1], z: shot.o[2] })
    if (this.connected) this.send({ type: 'fire', shot: { ...shot, o: this.canonical(shot.o) } })
    return true
  }

  fire(direction?: [number, number, number], target?: { x: number; y: number; z: number }, kind?: 'red'): void {
    if (materializing(this.ctx.player) || (kind === 'red' && !bigRedAllowed.value)) return
    const shot = this.lasers.aim(this.ctx.player.body, this.clock.now())
    if (kind) shot.k = kind
    if (target) direction = [target.x - shot.o[0], target.y - shot.o[1], target.z - shot.o[2]]
    if (direction) {
      const len = Math.hypot(...direction) || 1
      shot.d = [direction[0] / len, direction[1] / len, direction[2] / len]
    }
    this.lasers.spawn(this.id, shot)
    if (kind === 'red') this.gearCue('thunderFire', { x: shot.o[0], y: shot.o[1], z: shot.o[2] })
    else this.ctx.audio?.play('laserShot', { x: shot.o[0], y: shot.o[1], z: shot.o[2] })
    this.stats.shotsFired++
    if (this.connected) this.send({ type: 'fire', shot: { ...shot, o: this.canonical(shot.o) } })
  }

  private gearCue(name: string, at: { x: number; y: number; z: number }): void {
    // Cosmetic audio must not interrupt a gear action if an older audio implementation is used.
    try { this.ctx.audio?.cue?.(name, at) } catch { /* unavailable cue */ }
  }

  postPhysics(dt: number): void {
    this.rescue.slot = this.slot
    if (this.mode === MODE_KOTH) this.rescue.check()
    else this.rescue.release()
    if (!this.connected) return
    if (this.isHost && this.mode === MODE_KOTH) this.checkBotsStuck()
    this.detectRams()
    this.sendTimer += dt
    // While paused or hidden the heartbeat timer speaks for us (rendering may still tick in some cases).
    if (this.sendTimer >= 1 / netSendRate.value && !this.heartbeat.paused && !document.hidden) {
      this.sendTimer = 0
      this.sendState()
      if (this.isHost) this.sendBots()
    }
  }

  update(dt: number): void {
    this.raceBridge.update()
    // Exit world opens the lobby over a still running game: let go of everything on the way out.
    const driving = this.raceBridge.driving
    if (this.wasDriving && !driving) this.resetGear()
    this.wasDriving = driving
    for (const controller of this.botGear.values()) controller.update(dt)
    const frameAt = performance.now()
    // After a long task the browser often renders before it delivers the queued messages, so
    // the gap check in onState alone misses them: also distrust the next moment after a gap.
    if (frameAt - this.frameAt > LOCAL_STALL_MS) this.stallUntil = frameAt + LOCAL_STALL_MS
    this.frameAt = frameAt
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
    const stuck = koth && this.connected ? this.game.koth.out : {}
    const holder = koth ? this.game.koth.holder : 0
    // A stuck vehicle stays in the world, visible and solid: nothing here is ever removed.
    // Our own vehicle may just have been shifted a tile across the seam: bring everyone along
    // before this frame is drawn.
    const here = this.ctx.player.body.translation()
    for (const r of this.remotes.values()) r.reimage(here)
    this.placeHill()
    this.syncBotMatch()
    this.shareClock()
    // Text changes a few times a second at most, or when the room says something: building
    // every status line, the match state and each tag's words on every frame, and making the
    // shell compare them, was steady work and garbage for nothing anyone could read that fast.
    this.uiTimer -= dt
    const refresh = this.uiDirty || this.uiTimer <= 0
    if (refresh) {
      this.uiTimer = UI_INTERVAL
      this.uiDirty = false
      this.refreshTags(it, holder, stuck)
    }
    // Tags still follow their vehicles every frame; only their words wait.
    this.tags.update(this.tagList)
    this.mapTimer -= dt
    if (this.ctx.setMapEntities && this.mapTimer <= 0) {
      this.mapTimer = 0.2
      this.ctx.setMapEntities(this.mapMarkers())
    }
    if (refresh) {
      this.ctx.setStatus(this.status())
      this.pushMatch()
    }
  }

  /** Rebuild the name tag list in place: one entry per remote vehicle, with its words. */
  private refreshTags(it: number, holder: number, stuck: Record<number, unknown>): void {
    const list = this.tagList
    let n = 0
    for (const [id, r] of this.remotes) {
      const tag = list[n] ?? (list[n] = { vehicle: r.vehicle, name: '', note: '', it: false })
      n++
      tag.vehicle = r.vehicle
      tag.name = this.displayName(id)
      tag.it = id === it || id === holder
      let note = id === it ? 'IT' : ''
      if (id === holder) note += note ? ' KING' : 'KING'
      if (stuck[id]) note += note ? ' stuck' : 'stuck'
      const state = r.paused ? 'paused' : !r.responding ? 'not responding' : ''
      if (state) note += note ? ` ${state}` : state
      tag.note = note
    }
    list.length = n
  }

  private mapMarkers(): MapMarker[] {
    const list: MapMarker[] = []
    for (const [id, r] of this.remotes) {
      const p = r.vehicle.object.position
      const q = r.vehicle.object.quaternion
      // Heading from the forward (-Z) axis: atan2(-fx, -fz).
      const fx = -2 * (q.x * q.z + q.w * q.y)
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      const color = isBotId(id) ? botColors(id - BOT_ID_BASE)[0] : r.info.colors[0]
      list.push({ x: p.x, z: p.z, heading: Math.atan2(-fx, -fz), color })
    }
    const zone = this.mode === MODE_KOTH ? this.zone : null
    if (zone) {
      const k = this.game.koth
      const color = k.contested ? '#bf26ff' : k.holder === this.id ? '#1aff40' : k.holder ? '#ff1f0d' : '#ffb814'
      list.push({ x: zone.x, z: zone.z, heading: 0, color })
    }
    return list
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
    this.resetGear()
    this.raceBridge.disconnect()
    this.bots?.setGear?.(null)
    for (const controller of this.botGear.values()) controller.dispose()
    this.botGear.clear()
    this.conn.close()
    this.heartbeat.stop()
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
    this.tags.dispose()
  }

  // -------------------------------------------------------------------------------------
  // Vehicles and roles
  // -------------------------------------------------------------------------------------

  /** Bot decisions use the same gear implementation and limits as a human driver. */
  private readonly botDecisionHooks: BotDecisionHooks = {
    available: vehicle => {
      if (!this.isHost) return []
      // Two simultaneous users leave room for human messages in the shared connection budget.
      const controllers = [...this.botGear.values()]
      const mine = controllers.find(c => c.vehicle === vehicle)
      return mine?.active || controllers.filter(c => c.active).length < 2 ? botGearOptions() : []
    },
    threats: vehicle => {
      const id = this.vehicleIdOfBody(vehicle.body.handle)
      const p = vehicle.body.translation()
      return this.pesters.list().filter(o => o.to === id).map(o => ({
        id: `${o.shooter}:${o.id}`,
        position: { x: this.wrapSize > 0 ? nearestImage(o.pos[0], p.x, this.wrapSize) : o.pos[0], y: o.pos[1], z: this.wrapSize > 0 ? nearestImage(o.pos[2], p.z, this.wrapSize) : o.pos[2] },
        velocity: { x: o.velocity[0], y: o.velocity[1], z: o.velocity[2] },
      }))
    },
    act: (vehicle, action) => {
      if (!this.isHost) return
      const id = this.vehicleIdOfBody(vehicle.body.handle)
      if (id === null || !isBotId(id) || this.vehicleOf(id) !== vehicle) return
      let controller = this.botGear.get(id)
      if (!controller) {
        if (action.phase === 'cancel' || !botGearOptions().some(o => o.id === action.gear)) return
        // Announce the bot and its fresh state before its first gear message.
        this.sendBot(id, vehicle)
        controller = this.makeBotGear(id, vehicle)
        this.botGear.set(id, controller)
      }
      controller.act(action)
    },
  }

  private makeBotGear(id: number, vehicle: Vehicle): BotGear {
    return new BotGear(this.ctx.game, id, vehicle, {
      surface: this.grappleSurface,
      vehicleOf: id => this.vehicleOf(id), vehicleIds: () => this.vehicleIds(),
      idOfBody: h => this.vehicleIdOfBody(h), owns: id => this.ownsVehicle(id),
      lagOf: id => this.remotes.get(id)?.delay ?? 0, wrapSize: () => this.wrapSize,
      now: () => this.clock.now(), responding: id => this.remotes.get(id)?.responding ?? true,
      heldElsewhere: target => this.yoink.holderOf(target) !== null || [...this.botGear].some(([actor, g]) => actor !== id && g.yoink.holderOf(target) !== null),
      sendCord: (bot, cord) => { if (this.isHost) this.send({ type: 'cord', bot, cord }) },
      sendYoink: (bot, y) => { if (this.isHost) this.send({ type: 'yoink', bot, y }) },
      fireRed: (bot, direction) => this.fireBot(bot, direction),
      launchPester: (bot, target, direction) => this.fireBot(bot, direction, target),
    })
  }

  private fireBot(bot: number, direction: [number, number, number], target?: Vehicle): boolean {
    if (!this.isHost) return false
    const vehicle = this.vehicleOf(bot)
    if (!vehicle || materializing(vehicle)) return false
    const shot = this.lasers.aim(vehicle.body, this.clock.now())
    shot.d = direction
    if (target) {
      if (!pesterAllowed.value || this.pesters.list().filter(o => o.shooter === bot).length >= pesterMax.value) return false
      const to = this.vehicleIdOfBody(target.body.handle)
      if (to === null || to === bot) return false
      shot.k = 'pester'; shot.to = to; shot.boost = 0
      this.pesters.spawn(bot, shot)
    } else {
      if (!bigRedAllowed.value) return false
      shot.k = 'red'
      this.lasers.spawn(bot, shot)
    }
    this.ctx.audio?.play('laserShot', { x: shot.o[0], y: shot.o[1], z: shot.o[2] })
    this.send({ type: 'fire', bot, shot: { ...shot, o: this.canonical(shot.o) } })
    return true
  }

  private syncBotGear(): void {
    for (const [id, controller] of this.botGear) {
      if (this.isHost && this.vehicleOf(id) === controller.vehicle) continue
      controller.dispose()
      this.botGear.delete(id)
      this.pesters.forget(id)
    }
  }

  private audible: Vehicle[] = []

  /**
   * Other vehicles that should make sound: remote players and bots (replicas or our own).
   * For `audio.setVehicles(() => net.audibleVehicles())`.
   * The returned array is reused between calls.
   */
  audibleVehicles(): readonly Vehicle[] {
    const own = this.bots && !this.bots.remote ? this.bots.vehicles : []
    const remotes = [...this.remotes].map(([id, r]): [number, Vehicle] => [id, r.vehicle])
    return audibleVehicles(remotes, own, this.ctx.game.world, this.audible)
  }

  /** The vehicle that stands for an id on this client, if any. */
  vehicleOf(id: number): Vehicle | undefined {
    if (id === this.id) return this.ctx.player
    const r = this.remotes.get(id)
    if (r) return r.vehicle
    if (isBotId(id) && this.isHost) {
      const bot = this.bots?.vehicles[id - BOT_ID_BASE]
      return bot && bodyAlive(this.ctx.game.world, bot) ? bot : undefined
    }
    return undefined
  }

  /** True if this client simulates the vehicle (ours, or a bot while we run the bots), so gear may push it. */
  private ownsVehicle(id: number): boolean {
    return id === this.id || (isBotId(id) && Boolean(this.bots && !this.bots.remote) && !this.remotes.has(id))
  }

  /** Ids of every vehicle here: ours, remote players and bots, and the bots we simulate. */
  private vehicleIds(): number[] {
    const ids = [this.id, ...this.remotes.keys()]
    if (this.bots && !this.bots.remote) for (const [id] of liveBots(this.bots.vehicles, this.ctx.game.world)) if (!ids.includes(id)) ids.push(id)
    return ids
  }

  /** Id of any vehicle here with this body handle: ours, a remote's, or a bot we simulate. */
  private vehicleIdOfBody(handle: number): number | null {
    if (handle === this.ctx.player.body.handle) return this.id
    for (const [id, r] of this.remotes) if (r.vehicle.body.handle === handle) return id
    if (this.bots && !this.bots.remote) {
      for (const [id, bot] of liveBots(this.bots.vehicles, this.ctx.game.world)) if (bot.body.handle === handle) return id
    }
    return null
  }

  private judgedId(handle: number): number | null {
    if (handle === this.ctx.player.body.handle) return materializing(this.ctx.player) ? null : this.id
    if (this.isHost && this.bots) {
      for (const [id, bot] of liveBots(this.bots.vehicles, this.ctx.game.world)) if (bot.body.handle === handle && !materializing(bot)) return id
    }
    return null
  }

  /** Become or stop being the bot simulator when hosting changes hands. */
  private updateBotRole(): void {
    const host = this.isHost || this.localAfterFull
    if (host === this.wasHost) return
    this.wasHost = host
    if (!host) {
      for (const controller of this.botGear.values()) controller.dispose()
      this.botGear.clear()
    }
    if (this.bots) this.bots.remote = !host
    // A new host, or a new connection, must announce its bots' kinds afresh.
    this.botKinds.clear()
    if (!host) return
    // Take over: drop our replicas of the old host's bots; our own manager simulates them now.
    for (const [id] of [...this.remotes]) if (isBotId(id)) this.removeRemote(id)
    if (this.bots?.vehicles.length) this.event('You are host: simulating bots')
  }

  private clockShared = false
  private readonly clockUsers: ((now: () => number) => void)[] = [(now) => setWaterClock(now)]

  /**
   * Ask for the room's clock: seconds that every player in the room agrees on. `use` is
   * called once, with a function that reads it, as soon as our estimate is good (the first
   * ping has come back), or at once if it already is. For anything that must look the same
   * on every screen at the same moment: the sea's waves, the wind.
   *
   * Until then, and in single player, such things run on their own time, so each steps once
   * to the shared time at that moment. Handing the clock out before it has synced would be
   * worse: it reads as seconds since the page loaded, then leaps by decades. The clock keeps
   * running through a dropout, so nothing steps again on reconnecting.
   */
  onRoomClock(use: (now: () => number) => void): void {
    if (this.clockShared) use(this.roomNow)
    else this.clockUsers.push(use)
  }

  readonly roomNow = (): number => this.clock.now()

  /** For checks: the time the sea is running on right now, as this page's sea sees it. */
  get seaTime(): number {
    return waterTime()
  }

  private shareClock(): void {
    if (this.clockShared || !this.clock.synced) return
    this.clockShared = true
    for (const use of this.clockUsers.splice(0)) use(this.roomNow)
  }

  private botMatchKey = 'unset'
  private botMatchIt: Vehicle | null = null

  /**
   * Keep the host's bots told what game is on: the mode, the vehicle that is "it", the hill.
   * Networking owns the rules; this only lets the bots play along. Told again whenever any
   * of it changes, including when the vehicle behind "it" is replaced (a remote that changed
   * kind). Off line, or when another client hosts, the bots are in free play.
   */
  private syncBotMatch(): void {
    const bots = this.bots
    if (!bots?.setMatch) return
    // In Explore there is no game to tell them about: free play, as when off line.
    const on = this.connected && this.isHost && this.mode !== MODE_EXPLORE
    const koth = this.mode === MODE_KOTH
    const zone = on && koth ? this.game.koth.zone : null
    const it = on && !koth && this.game.it ? (this.vehicleOf(this.game.it) ?? null) : null
    const key = !on ? '' : koth ? `hill:${JSON.stringify(zone)}` : `tag:${this.game.it}`
    if (key === this.botMatchKey && it === this.botMatchIt) return
    this.botMatchKey = key
    this.botMatchIt = it
    if (!on) bots.setMatch(null)
    else if (koth) bots.setMatch({ mode: 'hill', zone: zone ? hillHold(zone, this.ctx.player.body.translation()) : null })
    else bots.setMatch({ mode: 'tag', it })
  }

  /** The vehicle kind last announced to the room for each of our bots, by bot id. */
  private readonly botKinds = new Map<number, string>()

  private sendState(): void {
    const s = this.ctx.player.getState()
    this.conn.send(encodeState({ id: 0, t: this.clock.now(), ...s, p: this.canonical(s.p) }) as Uint8Array<ArrayBuffer>)
    this.stats.statesSent++
  }

  private sendBots(): void {
    for (const [id, bot] of liveBots(this.bots?.vehicles ?? [], this.ctx.game.world)) {
      this.sendBot(id, bot)
    }
  }

  private sendBot(id: number, bot: Vehicle): void {
    const t = this.clock.now()
    // Say which vehicle it is before its first state, and again if the slot changes kind
    // (a mixed fleet), so guests build the same one.
    if (this.botKinds.get(id) !== bot.kind) {
      this.botKinds.set(id, bot.kind)
      this.send({ type: 'bot', id, kind: bot.kind })
    }
    const s = bot.getState()
    this.conn.send(encodeState({ id, t, ...s, p: this.canonical(s.p), bot: true }) as Uint8Array<ArrayBuffer>)
    this.stats.botStatesSent++
  }

  /**
   * The host's bots follow the players' lava rule: reported stuck once, so whoever pushed
   * them in gets the dunk, then left to crawl out or lifted back to a pad. Never removed.
   */
  private readonly botTimers = new WeakMap<Vehicle, StuckTimer>()
  private checkBotsStuck(): void {
    const time = this.ctx.game.time
    for (const [id, bot] of liveBots(this.bots?.vehicles ?? [], this.ctx.game.world)) {
      let timer = this.botTimers.get(bot)
      if (!timer) this.botTimers.set(bot, (timer = new StuckTimer()))
      const what = timer.step(time, inStickyLiquid(this.ctx.terrain, bot.body.translation()), kothRespawnDelay.value)
      if (what === 'stuck') this.send({ type: 'stuck', bot: id })
      else if (what === 'returned') {
        // The pads the bot manager itself uses (BotBrain): one past the bot's index.
        const s = this.ctx.terrain.spawnPoint(id - BOT_ID_BASE + 1)
        bot.teleport(s.position, s.heading)
      }
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
      if (touching) r.lastContactAt = now
      if (touching && !r.touching && now - r.lastRamSent > RAM_REPEAT) {
        r.lastRamSent = now
        this.onContact(id, r.vehicle, r)
      }
      r.touching = touching
    }
    // On the host, our own player against our own bots: both are simulated here.
    if (this.isHost && this.bots) {
      liveBots(this.bots.vehicles, this.ctx.game.world).forEach(([id, bot]) => {
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
    if (materializing(a) || materializing(b)) return false
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

  /** On a wrapping world the hill is drawn at the image nearest us, like everything else. */
  private placeHill(): void {
    const zone = this.zone
    const size = this.wrapSize
    if (!zone || !(size > 0)) {
      this.hill.setImage(0, 0)
      return
    }
    const me = this.ctx.player.body.translation()
    this.hill.setImage(nearestImage(zone.x, me.x, size) - zone.x, nearestImage(zone.z, me.z, size) - zone.z)
  }

  /** A beam sent from across the seam starts at the image of its origin nearest us. */
  private nearShot<T extends { o: [number, number, number] }>(shot: T): T {
    const size = this.wrapSize
    if (!(size > 0)) return shot
    const me = this.ctx.player.body.translation()
    return { ...shot, o: [nearestImage(shot.o[0], me.x, size), shot.o[1], nearestImage(shot.o[2], me.z, size)] }
  }

  /** Drape cosmetics over the actual land LOD and liquid skin, without changing physics. */
  private readonly grappleSurface = {
    heightAt: (x: number, z: number): number => Math.max(
      this.ctx.terrain.renderHeightAt?.(x, z) ?? this.ctx.terrain.heightAt(x, z),
      this.ctx.terrain.liquidHeightAt?.(x, z) ?? -Infinity,
    ),
    cellSize: (): number => this.ctx.terrain.renderCellSize ?? 1,
    origin: (): number => -this.ctx.terrain.size / 2,
  }

  /** The terrain's height, as remote vehicles use it to stay out of the hills. */
  private readonly groundAt = (x: number, z: number): number => this.ctx.terrain.heightAt(x, z)

  /** Side of the wrapping world in metres, or 0 when the world does not wrap. */
  private get wrapSize(): number {
    return this.ctx.terrain.wrapSize ?? 0
  }

  /** A position as it goes on the wire: inside the one tile everyone agrees on. */
  private canonical(p: readonly [number, number, number] | number[]): [number, number, number] {
    const size = this.wrapSize
    return size > 0 ? [wrapCoord(p[0], size), p[1], wrapCoord(p[2], size)] : [p[0], p[1], p[2]]
  }

  /** Apply relayed pushes whose ram our own physics did not feel; see shove.ts. */
  private applyShoves(): void {
    const now = this.ctx.player.body.linvel()
    const due = this.shoves.take(this.ctx.game.time, (from) => this.remotes.get(from)?.lastContactAt ?? -Infinity, [now.x, now.y, now.z])
    for (const { from, push } of due) {
      if (materializing(this.ctx.player) || materializing(this.vehicleOf(from))) continue
      const body = this.ctx.player.body
      // Believe it only from a vehicle that is beside us on our own screen as well.
      const remote = this.remotes.get(from)
      if (!remote || !remote.responding) continue
      const me = body.translation()
      const it = remote.vehicle.body.translation()
      const flat = this.wrapSize > 0 ? wrapDistance(me.x, me.z, it.x, it.z, this.wrapSize) : Math.hypot(it.x - me.x, it.z - me.z)
      if (Math.hypot(flat, it.y - me.y) > SHOVE_REACH) continue
      const v = body.linvel()
      body.setLinvel({ x: v.x + push[0], y: v.y + push[1], z: v.z + push[2] }, true)
      this.stats.shoves++
      this.ctx.audio?.impact(Math.hypot(...push), body.translation())
      this.event(`Ram: ${this.nameOf(from)} and you`)
    }
  }

  private onContact(id: number, other: Vehicle, remote?: RemotePlayer): void {
    if (materializing(this.ctx.player) || materializing(other)) return
    this.stats.rams++
    const a = this.ctx.player.body.linvel()
    const b = other.body.linvel()
    const p = this.ctx.player.body.translation()
    this.ctx.audio?.impact(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), p)
    this.event(`Ram: you and ${this.nameOf(id)}`)
    // In tag only contact involving "it" means anything; on the hill every touch may be the
    // push that dunks someone. The server checks again anyway.
    // A player's copy also gets the push we would have given it, in case its own screen
    // never sees the contact. Bots are pushed where they are simulated.
    const o = other.body.translation()
    const push = remote && !isBotId(id) ? shoveFor([p.x, p.y, p.z], [o.x, o.y, o.z], this.preVel, remote.sample.v as [number, number, number]) : null
    if (push) this.send({ type: 'ram', other: id, push })
    else if (this.game.mode === MODE_KOTH || this.game.it === this.id || this.game.it === id) this.send({ type: 'ram', other: id })
  }

  private spawnRemote(info: PlayerInfo, s: WireState): RemotePlayer {
    // Bots too get a replica of our own, so the set follows the host's roster exactly and is
    // never touched by our bot manager or its local quality cap.
    const vehicle = createVehicle(this.ctx.game, this.ctx.terrain, info.kind as VehicleKind, new THREE.Vector3(...s.p), 0)
    vehicle.isLocal = false
    vehicle.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true)
    this.ctx.game.add(vehicle)
    const [body, accent] = isBotId(info.id) ? botColors(info.id - BOT_ID_BASE) : info.colors
    ;(vehicle as VehicleExtras).setColors?.(body, accent)
    const r = new RemotePlayer(info, vehicle)
    r.groundAt = this.groundAt
    r.disposeEffects = this.attachEffects(vehicle)
    this.remotes.set(info.id, r)
    this.uiDirty = true
    this.ctx.audio?.play('materialize', { x: s.p[0], y: s.p[1], z: s.p[2] })
    return r
  }

  private removeRemote(id: number): void {
    const r = this.remotes.get(id)
    if (!r) return
    this.remotes.delete(id)
    this.uiDirty = true
    this.bungee.forget(id)
    this.yoink.forget(id)
    this.pesters.forget(id)
    r.disposeEffects()
    if (r.owned) this.ctx.game.remove(r.vehicle)
  }

  /** Dust, tracks, lamps and trails for a remote vehicle. Returns its disposer. */
  private attachEffects(vehicle: Vehicle): () => void {
    try {
      return attachVehicleEffects(this.ctx.game, this.ctx.terrain, vehicle, { local: false })
    } catch (err) {
      // Effects are cosmetic: never let them stop a player from appearing.
      console.warn('vehicle effects not attached', err)
      return () => {}
    }
  }

  /** Kind or colours changed: recolour, or rebuild the vehicle if the kind changed. */
  private applyProfile(info: PlayerInfo): void {
    const r = this.remotes.get(info.id)
    if (!r) return
    r.info = info
    const extras = r.vehicle as VehicleExtras
    if (r.owned && needsRebuild(extras.kind, info.kind)) {
      const t = r.vehicle.body.translation()
      const q = r.vehicle.body.rotation()
      r.disposeEffects()
      this.ctx.game.remove(r.vehicle)
      const v = createVehicle(this.ctx.game, this.ctx.terrain, info.kind as VehicleKind, new THREE.Vector3(t.x, t.y, t.z), 0)
      v.body.setRotation(q, true)
      this.ctx.game.add(v)
      const next = new RemotePlayer(info, v)
      next.groundAt = this.groundAt
      next.clearance = r.clearance
      next.disposeEffects = this.attachEffects(v)
      for (const s of [...r.buffer.states].reverse()) next.buffer.push(s, s.t, netSendRate.value)
      this.remotes.set(info.id, next)
      const [body, accent] = isBotId(info.id) ? botColors(info.id - BOT_ID_BASE) : info.colors
      ;(v as VehicleExtras).setColors?.(body, accent)
      try {
        this.ctx.onRemoteVehicleChanged?.(v)
      } catch (err) {
        // A cosmetic effect must not interrupt profile or subsequent snapshot handling.
        console.warn('remote arrival effect failed', err)
      }
      return
    }
    if (!isBotId(info.id)) extras.setColors?.(info.colors[0], info.colors[1])
  }

  private onTerrainRegenerated(): void {
    // A new world (another planet, a new seed, the room's world on joining) is built in place,
    // under the same gear systems: a cord anchored in the old ground would hang in the new
    // sky, and a carry or shot would continue in a world it never belonged to.
    this.resetGear()
    // The summit moved with the world: recompute the hill now, and the host resends it.
    this.zoneTimer = 0
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

  /**
   * The game paused or resumed, for either reason (the player's own pause, or a hidden
   * page). Call from the one pause subscription (src/core/pause.ts). While paused a
   * once-a-second heartbeat tells the room we are parked, not lost; on resuming the latency
   * estimates start afresh. Once this has been called, the page's visibility alone no
   * longer starts or stops the heartbeat.
   */
  setPaused(paused: boolean): void {
    this.heartbeat.setPaused(paused)
  }

  /** Fallback for a page that never calls setPaused: a hidden page counts as paused. */
  private onVisibility(): void {
    this.heartbeat.visibility(document.hidden)
  }

  private sendHeartbeat(): void {
    if (!this.connected) return
    const s = this.ctx.player.getState()
    this.conn.send(encodeState({ id: 0, t: this.clock.now(), ...s, p: this.canonical(s.p), v: [0, 0, 0], w: [0, 0, 0], paused: true }) as Uint8Array<ArrayBuffer>)
    this.stats.heartbeats++
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
    // A state handled long after our last frame waited behind a local stall (terrain rebuild,
    // shader compile, a hidden tab): its age says nothing about the network.
    const at = performance.now()
    const measure = at - this.frameAt < LOCAL_STALL_MS && at > this.stallUntil
    r.push(s, this.clock.now(), netSendRate.value, measure)
    this.stats.statesReceived++
  }

  private onMessage(msg: ServerMessage): void {
    // Anything the room says may change what the status, scores or tags show.
    this.uiDirty = true
    switch (msg.type) {
      case 'race':
        this.raceBridge.receive(msg.race)
        break
      case 'welcome': {
        this.localAfterFull = false
        this.joinStatus = ''
        this.id = msg.id
        this.slot = msg.slot
        // The vehicle's own fall and underground rescue puts it back at this slot.
        this.ctx.player.spawnSlot = msg.slot
        this.clock.seed(msg.serverTime)
        this.players.clear()
        for (const p of msg.players) this.players.set(p.id, p)
        this.game = normalizeGame(msg.game)
        // The room's world (seed included) first: the terrain regenerates before anything
        // spawns, and onTerrainRegenerated seats us on the new ground.
        // The room's world replaces ours entirely, gaps included; see applyRoomWorld.
        applyRoomWorld(msg.params)
        this.welcomed = true
        this.raceBridge.receive(msg.race ?? null)
        this.raceBridge.update()
        this.botKinds.clear()
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
          if (msg.shot.k === 'pester') this.pesters.spawn(msg.from, this.nearShot(msg.shot), this.clock.now() - msg.shot.t)
          else this.lasers.spawn(msg.from, this.nearShot(msg.shot), this.clock.now() - msg.shot.t)
          const [x, y, z] = msg.shot.o
          this.ctx.audio?.play('laserShot', { x, y, z })
        }
        break
      case 'cord':
        if (this.players.has(msg.from)) (this.botGear.get(msg.from)?.bungee ?? this.bungee).applyRemote(msg.from, msg.cord, this.clock.now() - msg.t)
        break
      case 'yoink':
        if (this.players.has(msg.from)) (this.botGear.get(msg.from)?.yoink ?? this.yoink).applyRemote(msg.from, msg.y)
        break
      case 'shove': {
        if (materializing(this.ctx.player) || materializing(this.vehicleOf(msg.from))) break
        const push = cleanShove(msg.push)
        if (push) {
          const v = this.ctx.player.body.linvel()
          this.shoves.add(msg.from, push, this.ctx.game.time, this.remotes.get(msg.from)?.delay ?? 0.1, [v.x, v.y, v.z], this.velHistory[0] ?? [v.x, v.y, v.z])
        }
        break
      }
      case 'hit': {
        const victim = this.vehicleOf(msg.victim)
        this.lasers.confirmHit(msg.shooter, msg.shot, victim?.object.position)
        this.pesters.confirmHit(msg.shooter, msg.shot)
        // The judging client already played it.
        if (victim && victim !== this.ctx.player && !(isBotId(msg.victim) && this.isHost)) {
          this.ctx.audio?.play('laserHit', victim.object.position)
        }
        break
      }
      case 'game':
        this.onGame(msg)
        break
      case 'reset': {
        // Defaults for whatever the server does not know, then the room's values.
        applyRoomWorld(msg.params)
        this.zoneTimer = 0
        this.onGame({ type: 'game', game: msg.game })
        this.event(msg.reason === 'host' ? `${this.nameOf(msg.from)} reset the world to defaults`
          : msg.reason === 'join' ? 'A new player brought their world' : 'The room was idle: world reset to defaults')
        break
      }
      case 'error':
        if (msg.message === 'room is full') { this.onRoomFull(); break }
        this.event(`Server: ${msg.message}`)
        if (msg.message.includes('protocol')) reloadForNewProtocol()
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
      case 'laser': this.event(`${a} tagged ${b} with a beam and ${is(a)} it`); break
      case 'score': this.event(`${a} tagged ${b}`); break
      case 'default': if (msg.actor !== this.id) this.event(`${a} is it`); break
      case 'leave': if (msg.game.it && msg.game.it !== this.id) this.event(`${this.nameOf(msg.game.it)} is it`); break
      case 'lock': this.event(msg.game.locked ? 'Host locked shared sliders' : 'Host unlocked shared sliders'); break
      case 'host': this.event(msg.actor === this.id ? 'You are now host' : `${a} is now host`); break
      case 'mode': this.event(msg.game.mode === MODE_KOTH ? 'King of the Hill: get to the rim and hold it' : msg.game.mode === MODE_TAG ? 'Tag game: ram or beam whoever is it' : 'Explore: no game running'); break
      case 'capture': this.event(`${a} ${msg.actor === this.id ? 'hold' : 'holds'} the hill`); break
      case 'contest': this.event('The hill is contested'); break
      case 'stuck': this.event(`${a} ${is(a)} stuck in the lava`); break
      case 'dunk': this.event(`${a} dunked ${b}: +${kothKnockBonus.value}`); break
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

  private onDisconnect(retrying = true): void {
    // The room drops our cord and carry when it loses us; drop everything here too, since a
    // reconnect may land in a world that has changed meanwhile.
    this.resetGear()
    this.welcomed = false
    this.raceBridge.disconnect()
    this.clock.reset()
    this.pingsSent = 0
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
    if (retrying) this.event('Disconnected, reconnecting')
  }

  /** A full room is a refusal, not a transient transport failure. */
  private onRoomFull(): void {
    this.conn.close()
    this.onDisconnect(false)
    this.players.clear()
    this.localAfterFull = true
    this.joinStatus = 'No room available. Playing locally with bots.'
    this.updateBotRole()
    this.uiDirty = true
    this.ctx.onJoinStatus?.(this.joinStatus)
  }

  private nameOf(id: number): string {
    return id === this.id ? 'You' : this.displayName(id)
  }

  /** A player's chosen name; bots get a seeded name every client agrees on. */
  displayName(id: number): string {
    if (isBotId(id) && this.ctx.names) {
      // Seeded, so it only changes with the world's seed: generate each once.
      // The cache is only as good as what made it: a new seed or a replaced namer starts over.
      if (this.botNamesSeed !== worldSeed.value || this.botNamer !== this.ctx.names) {
        this.botNamesSeed = worldSeed.value
        this.botNamer = this.ctx.names
        this.botNames.clear()
      }
      const known = this.botNames.get(id)
      if (known !== undefined) return known
      try {
        const name = this.ctx.names(`${worldSeed.value}:${id}`, 'bot')
        this.botNames.set(id, name)
        return name
      } catch {
        // Fall back to the server's name.
      }
    }
    return this.players.get(id)?.name ?? `Player ${id}`
  }

  private readonly botNames = new Map<number, string>()
  private botNamesSeed: unknown = undefined
  private botNamer: unknown = undefined

  private lastMatchKey = ''

  /** Tell the shell's match display, only when something it shows changed. */
  private pushMatch(): void {
    const set = this.ctx.setMatchState
    if (!set) return
    // In Explore there is no match to show: the shell hides its match display on null.
    const state = this.connected && this.game.mode !== MODE_EXPLORE ? this.matchState() : null
    const key = JSON.stringify(state)
    if (key === this.lastMatchKey) return
    this.lastMatchKey = key
    set(state)
  }

  private matchState(): MatchState {
    const g = this.game
    const koth = g.mode === MODE_KOTH
    const lead = koth ? g.koth.holder : g.it
    const scores = [...this.players.values()]
      .map((p) => ({ name: this.displayName(p.id), score: g.scores[p.id] ?? 0, ...(p.id === this.id ? { you: true } : {}) }))
      .sort((a, b) => b.score - a.score)
    const winner = koth && g.koth.resetAt && g.koth.winner ? g.koth.winner : 0
    const extra: Partial<MatchState> = winner
      ? {
          winnerColor: this.players.get(winner)?.colors[0] ?? DEFAULT_COLORS[0],
          // Whole seconds, so the change-only push updates it once a second.
          nextRoundIn: Math.max(0, Math.ceil(g.koth.resetAt - this.clock.now())),
        }
      : {}
    return {
      ...extra,
      mode: koth ? 'koth' : 'tag',
      holderName: lead ? this.displayName(lead) : null,
      holderIsYou: lead !== 0 && lead === this.id,
      contested: koth && g.koth.contested,
      scores,
      target: koth ? kothTargetScore.value : 0,
      winner: koth && g.koth.resetAt && g.koth.winner ? this.displayName(g.koth.winner) : null,
    }
  }

  private event(text: string): void {
    this.uiDirty = true
    this.events.push({ at: performance.now(), text })
    if (this.events.length > 20) this.events.shift()
  }

  private modeLines(): string[] {
    const g = this.game
    if (g.mode === MODE_EXPLORE) return ['mode: Explore']
    if (g.mode !== MODE_KOTH) return ['mode: Tag   ram or beam whoever is it']
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
    if (this.rescue.stuck) lines.push(`stuck in the lava: crawl free, or back to your pad in ${this.rescue.secondsLeft} s`)
    return lines
  }

  private status(): string[] {
    const lines: string[] = []
    if (this.joinStatus) lines.push(this.joinStatus)
    if (!this.connected) {
      const wait = Math.max(0, Math.ceil((this.conn.retryAt - performance.now()) / 1000))
      if (!this.localAfterFull) lines.push(this.conn.state === 'connecting' ? `net: connecting to room ${this.ctx.room}` : `net: offline, retry in ${wait}s (room ${this.ctx.room})`)
    } else {
      // A parked (hidden tab) player is held still, so its delay is not one anybody sees.
      const delays = [...this.remotes.values()].filter((r) => !r.paused).map((r) => r.delay)
      const delay = delays.length ? `${Math.round(Math.max(...delays) * 1000)} ms` : 'none'
      lines.push(`net: room ${this.ctx.room}   ping ${Math.round(this.clock.rtt * 1000)} ms   delay ${delay}`)
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
          this.game.mode === MODE_KOTH && this.game.koth.out[p.id] ? '(stuck)' : '',
          this.game.mode === MODE_KOTH && this.game.koth.holder === p.id ? '[KING]' : '',
          r?.paused ? '(paused)' : r && !r.responding ? '(not responding)' : '',
        ].filter(Boolean).join(' ')
        const lead = this.game.mode === MODE_KOTH ? this.game.koth.holder === p.id : p.id === this.game.it
        lines.push(`${lead ? '>' : ' '} ${this.displayName(p.id).padEnd(14)} ${String(this.game.scores[p.id] ?? 0).padStart(3)}  ${flags}`)
      }
    }
    const now = performance.now()
    for (const e of this.events.slice(-3)) if (now - e.at < 5000) lines.push(e.text)
    return lines
  }
}

/** The bot manager's colours (BotManager.spawn), so a replica looks like the host's bot. */
function botColors(index: number): [string, string] {
  return [`hsl(${(index * 137.508 + 15) % 360}, 85%, 55%)`, '#ffffff']
}

/**
 * The server speaks another protocol version. Usually this tab holds a stale bundle and the
 * server was updated: reload once to fetch the new client. A session flag stops a loop when
 * the server is the stale one.
 */
function reloadForNewProtocol(): void {
  const key = 'syn3h.protocolReload'
  try {
    if (sessionStorage.getItem(key) === String(PROTOCOL_VERSION)) return
    sessionStorage.setItem(key, String(PROTOCOL_VERSION))
  } catch {
    return
  }
  location.reload()
}

/** Fill fields an older room server does not send, so a mismatch degrades instead of throwing. */
function normalizeGame(g: Partial<GameState>): GameState {
  return {
    it: g.it ?? 0, scores: g.scores ?? {}, host: g.host ?? 0, locked: Boolean(g.locked), mode: g.mode ?? MODE_EXPLORE,
    koth: { zone: null, holder: 0, contested: false, winner: 0, resetAt: 0, out: {}, ...g.koth },
  }
}

/** Name chosen on the start screen, when there is one. */
let preferredName = ''

/**
 * This tab's secret for one room: in a room with `game.rejoin` on, saying hello again with it
 * after a dropout carries on as the same player. Kept for the tab's lifetime (so a reload
 * rejoins too) and never shown or sent to other players. Each tab has its own.
 */
function rejoinSecret(room: string): string | undefined {
  const key = `syn3h.rejoin.${room}`
  try {
    let secret = sessionStorage.getItem(key)
    if (!secret) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      secret = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      sessionStorage.setItem(key, secret)
    }
    return secret
  } catch {
    // No session storage (private mode, an embedded frame): this tab simply cannot rejoin.
    return undefined
  }
}

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

/** Local-only hold signal. It is not on the wire, so the server cannot veto a remote ram. */
function materializing(vehicle: Vehicle | undefined): boolean {
  return vehicle?.object.userData.materializing === true
}
