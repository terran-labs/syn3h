/**
 * Seam: multiplayer. Called once after the local player exists.
 *
 * Mars Explorer's model, rebuilt: this client simulates only its own vehicle and sends its
 * state 20 times a second; the room server relays it; remote vehicles are played back from
 * snapshot buffers and stay physical near us so ramming works. Lasers and the tag game ride
 * on rare JSON messages. See docs/architecture/mars-explorer.md, Networking.
 */
import * as THREE from 'three/webgpu'
import { type ParamValue, params } from '../../shared/params'
import {
  type GameState,
  type PlayerInfo,
  PROTOCOL_VERSION,
  type ServerMessage,
  type ClientMessage,
  decodeState,
  encodeState,
  parseJson,
} from '../../shared/protocol'
import type { Game, System } from '../core/Game'
import { createVehicle } from '../vehicles'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { Lasers } from '../weapons/Lasers'
import { laserInterval, lasersAllowed } from '../weapons/params'
import { BoundsGuard, TagMarker } from '../modes/Tag'
import '../modes/params'
import { ServerClock } from './Clock'
import { Connection, serverUrl } from './Connection'
import { netExtrapolate, netInterpDelay, netProxyBlend, netProxyRadius, netSendRate } from './params'
import { RemotePlayer } from './RemotePlayer'

export interface NetContext {
  game: Game
  terrain: Terrain
  /** The local player's vehicle. */
  player: Vehicle
  /** Player name from the start screen. Falls back to ?name= or a generated one. */
  name?: string
  /** Room name from the URL (?room=name), or 'lobby'. */
  room: string
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

export class NetClient implements System {
  readonly clock = new ServerClock()
  readonly conn: Connection
  readonly lasers: Lasers
  readonly remotes = new Map<number, RemotePlayer>()
  readonly players = new Map<number, PlayerInfo>()
  readonly events: NetEvent[] = []
  id = 0
  slot = 0
  game: GameState = { it: 0, scores: {}, host: 0, locked: false }
  /** Counts for automated checks. */
  stats = { statesSent: 0, statesReceived: 0, rams: 0, hitsTaken: 0, shotsFired: 0 }

  private welcomed = false
  private everWelcomed = false
  private sendTimer = 0
  private pingTimer = 0
  private pingsSent = 0
  private lastFire = -Infinity
  private readonly marker: TagMarker
  private readonly bounds: BoundsGuard

  constructor(private readonly ctx: NetContext) {
    const { game, player } = ctx
    this.conn = new Connection(serverUrl(ctx.room))
    this.lasers = new Lasers(game, {
      localBody: () => player.body,
      localId: () => this.id,
      bodyOf: (id) => (id === this.id ? player.body : this.remotes.get(id)?.vehicle.body),
      isVehicleBody: (h) => h === player.body.handle || [...this.remotes.values()].some((r) => r.vehicle.body.handle === h),
      onLocalHit: (shooter, shot) => {
        this.stats.hitsTaken++
        this.send({ type: 'hit', shooter, shot })
      },
    })
    this.marker = new TagMarker(game)
    this.marker.local = player
    this.bounds = new BoundsGuard(player, ctx.terrain)
    this.bounds.onReset = () => this.event('You fell off the planet')

    this.conn.onOpen = () => {
      this.send({ type: 'hello', v: PROTOCOL_VERSION, name: playerName(), params: params.snapshot('world') })
    }
    this.conn.onText = (text) => {
      const msg = parseJson<ServerMessage>(text)
      if (msg) this.onMessage(msg)
    }
    this.conn.onBinary = (data) => this.onState(data)
    this.conn.onClose = () => this.onDisconnect()

    params.onChange((id, value, source) => this.onParamChange(id, value, source))
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

  /** True if this client may change 'world' parameters right now. */
  get canEditWorld(): boolean {
    return !this.connected || !this.game.locked || this.isHost
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
    for (const r of this.remotes.values()) {
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

  /** Fire one laser from the local vehicle, straight ahead or along `direction`. */
  fire(direction?: [number, number, number]): void {
    const shot = this.lasers.aim(this.ctx.player.body, this.clock.now())
    if (direction) {
      const len = Math.hypot(...direction) || 1
      shot.d = [direction[0] / len, direction[1] / len, direction[2] / len]
    }
    this.lasers.spawn(this.id, shot)
    this.stats.shotsFired++
    if (this.connected) this.send({ type: 'fire', shot })
  }

  postPhysics(dt: number): void {
    if (!this.connected) return
    this.detectRams()
    this.sendTimer += dt
    if (this.sendTimer >= 1 / netSendRate.value) {
      this.sendTimer = 0
      const s = this.ctx.player.getState()
      this.conn.send(encodeState({ id: 0, t: this.clock.now(), ...s }) as Uint8Array<ArrayBuffer>)
      this.stats.statesSent++
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
    const it = this.game.it
    this.marker.target = !it ? null : it === this.id ? this.ctx.player : (this.remotes.get(it)?.vehicle ?? null)
    this.ctx.setStatus(this.status())
  }

  dispose(): void {
    this.conn.close()
    for (const id of [...this.remotes.keys()]) this.removeRemote(id)
  }

  /** Local vehicle against each physical proxy: report new contacts as rams. */
  private detectRams(): void {
    const world = this.ctx.game.world
    const mine = this.ctx.player.body
    const now = this.ctx.game.time
    for (const [id, r] of this.remotes) {
      if (!r.physical) {
        r.touching = false
        continue
      }
      let touching = false
      const theirs = r.vehicle.body
      for (let i = 0; i < mine.numColliders() && !touching; i++) {
        for (let j = 0; j < theirs.numColliders() && !touching; j++) {
          world.contactPair(mine.collider(i), theirs.collider(j), (m) => {
            for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) < CONTACT_DIST) touching = true
          })
        }
      }
      if (touching && !r.touching && now - r.lastRamSent > RAM_REPEAT) {
        r.lastRamSent = now
        this.stats.rams++
        this.event(`Ram: you and ${r.info.name}`)
        // Only contact involving "it" means anything; the server checks again anyway.
        if (this.game.it === this.id || this.game.it === id) this.send({ type: 'ram', other: id })
      }
      r.touching = touching
    }
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
    const info = this.players.get(s.id)
    if (!info) return
    let r = this.remotes.get(s.id)
    if (!r) {
      const pos = new THREE.Vector3(...s.p)
      const vehicle = createVehicle(this.ctx.game, this.ctx.terrain, 'buggy', pos, 0)
      vehicle.isLocal = false
      vehicle.body.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true)
      this.ctx.game.add(vehicle)
      r = new RemotePlayer(info, vehicle)
      this.remotes.set(s.id, r)
    }
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
        this.game = msg.game
        params.applySnapshot(msg.params, 'remote')
        this.welcomed = true
        this.bounds.slot = msg.slot
        if (!this.everWelcomed) {
          // Spread players out; on a reconnect, stay where we are.
          const s = this.ctx.terrain.spawnPoint(msg.slot)
          this.ctx.player.teleport(s.position, s.heading)
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
        this.event(`${msg.player.name} joined`)
        break
      case 'leave':
        this.event(`${this.nameOf(msg.id)} left`)
        this.players.delete(msg.id)
        this.removeRemote(msg.id)
        break
      case 'param':
        params.set(msg.id, msg.value, 'remote')
        if (msg.from === 0) this.event(`Shared sliders are locked by the host`)
        break
      case 'fire':
        if (this.remotes.has(msg.from) || this.players.has(msg.from)) {
          this.lasers.spawn(msg.from, msg.shot, this.clock.now() - msg.shot.t)
        }
        break
      case 'hit': {
        const victim = msg.victim === this.id ? this.ctx.player : this.remotes.get(msg.victim)?.vehicle
        this.lasers.confirmHit(msg.shooter, msg.shot, victim?.object.position)
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
    this.game = msg.game
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

  private removeRemote(id: number): void {
    const r = this.remotes.get(id)
    if (!r) return
    this.remotes.delete(id)
    this.ctx.game.remove(r.vehicle)
  }

  private nameOf(id: number): string {
    return id === this.id ? 'You' : (this.players.get(id)?.name ?? `Player ${id}`)
  }

  private event(text: string): void {
    this.events.push({ at: performance.now(), text })
    if (this.events.length > 20) this.events.shift()
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
      const list = [...this.players.values()].sort((a, b) => a.slot - b.slot)
      for (const p of list) {
        const r = this.remotes.get(p.id)
        const flags = [
          p.id === this.game.it ? '[IT]' : '',
          p.id === this.id ? '(you)' : '',
          p.id === this.game.host ? '(host)' : '',
          r && !r.responding ? '(not responding)' : '',
        ].filter(Boolean).join(' ')
        lines.push(`${p.id === this.game.it ? '>' : ' '} ${p.name.padEnd(14)} ${String(this.game.scores[p.id] ?? 0).padStart(3)}  ${flags}`)
      }
    }
    const now = performance.now()
    for (const e of this.events.slice(-3)) if (now - e.at < 5000) lines.push(e.text)
    return lines
  }
}

/** Name chosen on the start screen, when there is one. */
let preferredName = ''

function playerName(): string {
  if (preferredName) return preferredName.slice(0, 24)
  const q = new URLSearchParams(location.search).get('name')
  if (q) return q.slice(0, 24)
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

/** The running client, for UI code (a lock button) and automated checks. */
export let net: NetClient | null = null

export function startNetworking(ctx: NetContext): void {
  preferredName = ctx.name?.trim() ?? ''
  net = new NetClient(ctx)
  net.start()
  const w = window as unknown as { syn3hNet?: NetClient }
  w.syn3hNet = net
}
