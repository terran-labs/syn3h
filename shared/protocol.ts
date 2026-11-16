/**
 * Wire protocol between clients and the room server.
 *
 * Vehicle state is the only high rate message (20 per second per player), so it is a fixed
 * size binary record built with DataView. Everything else is rare and goes as JSON text.
 *
 * Times on the wire are seconds on the server's clock. Each client estimates its offset to
 * that clock from ping/pong, so a timestamp written by one client means the same instant to
 * every other client. Snapshot interpolation and projectile replay both depend on that.
 *
 * No browser or Node dependencies: the client, the Node server and the Worker share it.
 */
import { wrapDistance } from './wrap'

export const PROTOCOL_VERSION = 2
/** Close code: this player's place was taken over by a newer connection with its secret. */
export const CLOSE_REPLACED = 4003

/** Binary message kinds (first byte). */
export const BIN_STATE = 1
/** A bot's state, sent only by the host. The id slot holds the bot id, not the sender's. */
export const BIN_BOT_STATE = 2

/** Bots get ids from this base up, so they share the player id space without colliding. */
export const BOT_ID_BASE = 0xff00
export const MAX_BOTS = 64
export const isBotId = (id: number) => id >= BOT_ID_BASE && id < BOT_ID_BASE + MAX_BOTS
/** Highest id the server hands to a real player. */
export const MAX_PLAYER_ID = BOT_ID_BASE - 1

/** Vehicle kinds a player may announce. Must match VehicleKind in src/vehicles/index.ts. */
export const VEHICLE_KINDS = ['buggy', 'buggy-classic', 'buggy-syn3h', 'jet', 'hovercraft', 'tank'] as const
export type WireVehicleKind = (typeof VEHICLE_KINDS)[number]
export const DEFAULT_COLORS: [string, string] = ['#7a1838', '#e9a6e0']
const COLOR_PATTERN = /^#[0-9a-f]{6}$/

/** Lower case #rrggbb, or null. */
export function cleanColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return COLOR_PATTERN.test(s) ? s : null
}

export function cleanKind(raw: unknown): WireVehicleKind | null {
  return typeof raw === 'string' && (VEHICLE_KINDS as readonly string[]).includes(raw) ? (raw as WireVehicleKind) : null
}

/** Input axes are quantised to signed bytes. */
const AXIS_SCALE = 127

export const FLAG_BRAKES = 1
export const FLAG_SPECIAL = 2
export const FLAG_FIRE = 4
/** The sender's tab is hidden: this is a heartbeat repeating its last pose. */
export const FLAG_PAUSED = 8
/**
 * The sender rides in a zorb ball (src/vehicles/zorb.ts). Older clients ignore the bit and the
 * server relays state bytes unchanged, so mixed versions interoperate; an old client simply
 * does not draw or collide with the ball.
 */
export const FLAG_ZORB = 16

/**
 * Layout of a state record. The player id slot is written as 0 by the sender and
 * overwritten by the server with the sender's real id, so a client can never speak for
 * another player's vehicle.
 */
export const STATE_BYTES = 68
const O_KIND = 0
const O_ID = 1
const O_T = 3
const O_P = 11
const O_Q = 23
const O_V = 39
const O_W = 51
const O_IN = 63
const O_FLAGS = 67

export interface WireInput {
  x: number
  y: number
  z: number
  w: number
  brakes: boolean
  special: boolean
  fire: boolean
  /** Optional on the way in so older callers still type check; always set by `decodeState`. */
  zorb?: boolean
}

export interface WireState {
  /** Sender's player id. 0 when sent by a client; the server fills it in. */
  id: number
  /** Server clock seconds when the state was sampled. */
  t: number
  p: [number, number, number]
  q: [number, number, number, number]
  v: [number, number, number]
  w: [number, number, number]
  input: WireInput
  /** Heartbeat from a hidden tab: hold still, do not extrapolate. */
  paused?: boolean
  /** True for a bot state (kind BIN_BOT_STATE). */
  bot?: boolean
}

const clampAxis = (n: number) => Math.max(-AXIS_SCALE, Math.min(AXIS_SCALE, Math.round((Number.isFinite(n) ? n : 0) * AXIS_SCALE)))

export function encodeState(s: WireState, out?: Uint8Array): Uint8Array {
  const buf = out ?? new Uint8Array(STATE_BYTES)
  const dv = new DataView(buf.buffer, buf.byteOffset, STATE_BYTES)
  dv.setUint8(O_KIND, s.bot ? BIN_BOT_STATE : BIN_STATE)
  dv.setUint16(O_ID, s.id, true)
  dv.setFloat64(O_T, s.t, true)
  for (let i = 0; i < 3; i++) dv.setFloat32(O_P + i * 4, s.p[i], true)
  for (let i = 0; i < 4; i++) dv.setFloat32(O_Q + i * 4, s.q[i], true)
  for (let i = 0; i < 3; i++) dv.setFloat32(O_V + i * 4, s.v[i], true)
  for (let i = 0; i < 3; i++) dv.setFloat32(O_W + i * 4, s.w[i], true)
  dv.setInt8(O_IN, clampAxis(s.input.x))
  dv.setInt8(O_IN + 1, clampAxis(s.input.y))
  dv.setInt8(O_IN + 2, clampAxis(s.input.z))
  dv.setInt8(O_IN + 3, clampAxis(s.input.w))
  dv.setUint8(O_FLAGS, (s.input.brakes ? FLAG_BRAKES : 0) | (s.input.special ? FLAG_SPECIAL : 0) | (s.input.fire ? FLAG_FIRE : 0) | (s.paused ? FLAG_PAUSED : 0) | (s.input.zorb ? FLAG_ZORB : 0))
  return buf
}

/** Decode a state record. Returns null if it is malformed or holds non finite numbers. */
export function decodeState(data: ArrayBuffer | Uint8Array): WireState | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.byteLength !== STATE_BYTES) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, STATE_BYTES)
  const kind = dv.getUint8(O_KIND)
  if (kind !== BIN_STATE && kind !== BIN_BOT_STATE) return null
  const f = (o: number) => dv.getFloat32(o, true)
  const p: [number, number, number] = [f(O_P), f(O_P + 4), f(O_P + 8)]
  const q: [number, number, number, number] = [f(O_Q), f(O_Q + 4), f(O_Q + 8), f(O_Q + 12)]
  const v: [number, number, number] = [f(O_V), f(O_V + 4), f(O_V + 8)]
  const w: [number, number, number] = [f(O_W), f(O_W + 4), f(O_W + 8)]
  const t = dv.getFloat64(O_T, true)
  for (const n of [t, ...p, ...q, ...v, ...w]) if (!Number.isFinite(n)) return null
  const flags = dv.getUint8(O_FLAGS)
  return {
    id: dv.getUint16(O_ID, true),
    t, p, q, v, w,
    input: {
      x: dv.getInt8(O_IN) / AXIS_SCALE,
      y: dv.getInt8(O_IN + 1) / AXIS_SCALE,
      z: dv.getInt8(O_IN + 2) / AXIS_SCALE,
      w: dv.getInt8(O_IN + 3) / AXIS_SCALE,
      brakes: (flags & FLAG_BRAKES) !== 0,
      special: (flags & FLAG_SPECIAL) !== 0,
      fire: (flags & FLAG_FIRE) !== 0,
      zorb: (flags & FLAG_ZORB) !== 0,
    },
    paused: (flags & FLAG_PAUSED) !== 0,
    bot: kind === BIN_BOT_STATE,
  }
}

/** Overwrite the player id of an encoded state in place. Used by the server when relaying. */
export function stampStateId(bytes: Uint8Array, id: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, STATE_BYTES).setUint16(O_ID, id, true)
}

// ---------------------------------------------------------------------------------------
// Control messages (JSON)
// ---------------------------------------------------------------------------------------

export type Vec3 = [number, number, number]
export type ParamWireValue = number | boolean

export interface PlayerInfo {
  id: number
  name: string
  /** Spawn slot, the lowest free index when the player joined. */
  slot: number
  score: number
  kind: WireVehicleKind
  /** Body and accent colours, #rrggbb. */
  colors: [string, string]
  /** A vehicle simulated by the host rather than a person. */
  bot?: boolean
}

/**
 * Game modes, the value of the shared parameter `game.mode`.
 *
 * Explore is the default: no game is running. Nobody is "it", there is no hill, and nothing
 * scores; the tools still push things about as toys. Tag and King of the Hill run only when
 * a player chooses them. Explore took a new number so that 0 and 1 keep meaning what they
 * always did. Protocol 2 is retained: frozen clients tolerate numeric mode 2, though
 * their older interface may label it incorrectly. The optional hello modes field marks
 * clients whose initial Tag setting is a choice rather than the retired default.
 */
export const MODE_TAG = 0
export const MODE_KOTH = 1
export const MODE_EXPLORE = 2

/**
 * The King of the Hill zone: a ring (or, with inner 0, a disc) around a centre, between two
 * heights. Computed from the terrain by the host and sent to the server, which does not
 * generate terrain.
 */
export interface HillZone {
  x: number
  z: number
  inner: number
  outer: number
  yMin: number
  yMax: number
}

/**
 * Side of the world's tile in metres for each `terrain.planetSize` (0 small, 1 medium, 2
 * large). The room server needs it to measure distances on a wrapping world and cannot load
 * the terrain generator; a test keeps this equal to the generator's PLANET_SIZES.
 */
export const WRAP_SIZES = [1024, 2048, 4096] as const

/** Smallest and largest tile, and the step every tile is a whole number of (64 cells of 4 m). */
export const TILE_MIN = 1024
export const TILE_MAX = 4096
export const TILE_STEP = 256

/**
 * Side of the world's tile in metres for a stored `terrain.planetSize`: 1024 × 2^stored,
 * rounded to whole TILE_STEPs. So 0, 1 and 2, the three old sizes, stay exactly 1024, 2048
 * and 4096 m, and every value between is a size between. Anything else that could be stored
 * (out of range, not a number) is clamped, so this is always a whole tile, never 0 or NaN.
 * The room server and the terrain generator both use it.
 */
export function tileSize(stored: unknown): number {
  const v = typeof stored === 'number' ? stored : Number(stored)
  const exponent = Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1
  return Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round((TILE_MIN * 2 ** exponent) / TILE_STEP) * TILE_STEP))
}

/** Sanity limits for a zone sent by a client. Returns a clean copy, or null. */
export function cleanZone(raw: unknown): HillZone | null {
  if (!raw || typeof raw !== 'object') return null
  const z = raw as HillZone
  const nums = [z.x, z.z, z.inner, z.outer, z.yMin, z.yMax]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (Math.abs(z.x) > 20000 || Math.abs(z.z) > 20000) return null
  if (z.inner < 0 || z.outer > 2000 || z.outer - z.inner < 4) return null
  if (z.yMax - z.yMin < 2 || z.yMax - z.yMin > 2000 || Math.abs(z.yMin) > 10000) return null
  return { x: z.x, z: z.z, inner: z.inner, outer: z.outer, yMin: z.yMin, yMax: z.yMax }
}

/** `wrapSize` is the side of a wrapping world in metres (0 or absent: it does not wrap). */
export function inZone(zone: HillZone, p: readonly number[], wrapSize = 0): boolean {
  const d = wrapSize > 0 ? wrapDistance(p[0], p[2], zone.x, zone.z, wrapSize) : Math.hypot(p[0] - zone.x, p[2] - zone.z)
  return d >= zone.inner && d <= zone.outer && p[1] >= zone.yMin && p[1] <= zone.yMax
}

/** King of the Hill state. */
export interface KothState {
  zone: HillZone | null
  /** Player alone in the zone and scoring, or 0. */
  holder: number
  /** Two or more vehicles in the zone: nobody scores. */
  contested: boolean
  /** Who won the last round, shown until `resetAt`. */
  winner: number
  /** Server seconds when the round resets after a win, or 0. */
  resetAt: number
  /** Players and bots stuck in the lava, with the server second each counts again. Nothing
   * is ever removed from play; a stuck vehicle only sits out of the hill count. */
  out: Record<number, number>
}

/** Shared game state the server owns. */
export interface GameState {
  /** MODE_TAG or MODE_KOTH. */
  mode: number
  koth: KothState
  /** Player id of whoever is "it", or 0 for nobody. */
  it: number
  scores: Record<number, number>
  /** Player id of the host: the first player in, then the longest connected. */
  host: number
  /** While true only the host may change 'world' parameters. */
  locked: boolean
}

/** A laser shot. Every client simulates it from the same origin, direction and time. */
export interface ShotInfo {
  /** Unique per shooter. */
  id: number
  /** Muzzle position. */
  o: Vec3
  /** Unit direction. */
  d: Vec3
  /** Extra forward speed inherited from the launcher, m/s. */
  boost: number
  /** Server clock seconds at the moment of firing. */
  t: number
  /**
   * Kind: absent for the tag beam, 'red' for Big Red (src/weapons/bigRedParams.ts), 'pester'
   * for a Pester (src/weapons/pester), which chases vehicle `to`.
   */
  k?: 'red' | 'pester'
  to?: number
}

/**
 * A player's Bungee cord (src/weapons/bungee). Sent by its owner whenever it changes and
 * every two seconds while attached; the room checks and relays it. Positions are canonical.
 * `hook`: launched from `o` with velocity `d` (m/s) at server time `t`. `on`: attached to
 * vehicle `to`, or to the ground at `at` with surface normal `n`, with `r` metres of cord out.
 */
export type CordWire =
  | { s: 'hook'; o: [number, number, number]; d: [number, number, number]; t: number }
  | { s: 'on'; to?: number; at?: [number, number, number]; n?: [number, number, number]; r: number }
  | { s: 'off' }

/**
 * Yoink (src/weapons/yoink): `grab` starts carrying vehicle `to` in front of the sender;
 * `fling` gives `to` the velocity change `v` (m/s) and ends any carry, and is also a gust's
 * shove; `drop` ends a carry with no fling. The carried vehicle's own client does the pushing.
 */
export type YoinkWire =
  | { s: 'grab'; to: number }
  | { s: 'fling'; to: number; v: [number, number, number] }
  | { s: 'drop'; to: number }

export interface RaceParticipant {
  id: number
  name: string
  status: 'racing' | 'finished' | 'withdrawn'
}

/** Host simulation proposal. The room supplies canonical names and bounds phase deadlines. */
export interface RaceUpdate {
  id: string
  revision: number
  phase: 'countdown' | 'running' | 'finished' | 'cancelled'
  remainingMs: number
  destination: { label: string; x: number; y: number; z: number; radius: number }
  participants: RaceParticipant[]
  winnerId: number | null
  reason?: string
}

export interface RaceState extends RaceUpdate {
  /** Room-clock seconds corresponding to remainingMs. */
  updatedAt: number
  /** Preserved when the winner leaves or changes their name. */
  winnerName: string | null
}

export const RACE_COUNTDOWN_MS = 5000
export const RACE_RUNNING_MS = 120000
export const RACE_RESULT_MS = 8000
export const RACE_COOLDOWN_MS = 90000

export type ClientMessage =
  /**
   * `resume` is a random secret this tab keeps for this room. In a room with `game.rejoin`
   * on, a player who drops and says hello again with the same secret within the grace time
   * carries on as the same player. It is never sent to other players.
   * `page` is random per page load: a hello with the same secret and the same page is that page
   * reconnecting, and takes its place back at once; a duplicated tab has the secret, not the page.
   */
  | { type: 'hello'; v: number; modes?: 2; name: string; params: Record<string, ParamWireValue>; kind?: string; colors?: [string, string]; resume?: string; page?: string }
  /**
   * Change vehicle kind, colours or name after joining. `name` is optional and newer: an older
   * room ignores it, and the name then changes at the next join. The room cleans and
   * de-duplicates a name exactly as at hello, and takes at most one rename per
   * RENAME_INTERVAL_MS; an ignored rename is answered with the player's current profile.
   */
  | { type: 'profile'; kind?: string; colors?: [string, string]; name?: string }
  | { type: 'ping'; t: number }
  | { type: 'param'; id: string; value: ParamWireValue }
  /** Optional bot actor: only the current host may act for a live bot it simulates. */
  | { type: 'fire'; shot: ShotInfo; bot?: number }
  /**
   * Sent by the victim's own client: "shot `shot` from `shooter` hit me". The host also
   * reports hits on bots, naming the bot as `victim`.
   */
  | { type: 'hit'; shooter: number; shot: number; victim?: number }
  /**
   * Sent by a client whose vehicle touched another player's vehicle. `push` is the velocity
   * change, m/s, the rammer's client worked out for the other vehicle; the server relays it
   * to that player as `shove`. See src/net/shove.ts.
   */
  | { type: 'ram'; other: number; push?: [number, number, number] }
  /** Host only: lock or unlock shared parameters for everyone else. */
  | { type: 'lock'; locked: boolean }
  /** Host only: the King of the Hill zone it computed from the terrain. */
  | { type: 'zone'; zone: HillZone }
  /** My vehicle (or, from the host, bot `bot`) is stuck in the lava. */
  | { type: 'stuck'; bot?: number }
  /** The old name for `stuck`, still accepted from tabs holding an older bundle. */
  | { type: 'died'; cause: 'lava' | 'fell'; bot?: number }
  /** Put the shared world back to defaults (allowed whenever moving a shared slider is). */
  | { type: 'reset' }
  /** Host only: which vehicle bot `id` is, so guests build the same kind (mixed bot fleets). */
  | { type: 'bot'; id: number; kind: string }
  /** My Bungee cord changed. */
  | { type: 'cord'; cord: CordWire; bot?: number }
  /** I grabbed, flung or dropped a vehicle with Yoink. */
  | { type: 'yoink'; y: YoinkWire; bot?: number }
  /** A human announces their own driving state; lobby spectators default to ineligible. */
  | { type: 'race-ready'; driving: boolean }
  | { type: 'race'; race: RaceUpdate }
  /** A participant withdraws themselves, never another vehicle. */
  | { type: 'race-leave'; id: string }

export type TagEvent =
  | 'default' | 'ram' | 'laser' | 'score' | 'leave' | 'lock' | 'host'
  // King of the Hill
  | 'mode' | 'capture' | 'contest' | 'free' | 'stuck' | 'dunk' | 'win' | 'reset'

export type ServerMessage =
  | {
      type: 'welcome'
      v: number
      id: number
      slot: number
      room: string
      players: PlayerInfo[]
      params: Record<string, ParamWireValue>
      game: GameState
      serverTime: number
      race?: RaceState | null
    }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'join'; player: PlayerInfo }
  | { type: 'profile'; player: PlayerInfo }
  | { type: 'leave'; id: number }
  /** `from` is 0 when the server is correcting a rejected change back to the room's value. */
  | { type: 'param'; id: string; value: ParamWireValue; from: number }
  | { type: 'fire'; from: number; shot: ShotInfo }
  | { type: 'hit'; shooter: number; victim: number; shot: number }
  /** Player `from` rammed you: the velocity change to apply if your own physics missed it. */
  | { type: 'shove'; from: number; push: [number, number, number] }
  /** Player `from`'s Bungee cord, relayed at server time `t`. */
  | { type: 'cord'; from: number; cord: CordWire; t: number }
  /** Player `from` used Yoink on vehicle `y.to`. */
  | { type: 'yoink'; from: number; y: YoinkWire }
  | { type: 'race'; race: RaceState | null }
  | { type: 'game'; game: GameState; event?: TagEvent; actor?: number; target?: number }
  /**
   * The room's world was replaced: set every world parameter to its default, then apply
   * `params`. `idle`: nobody was playing; `host`: player `from` asked for defaults; `join`:
   * the first player into an idle reset room brought their world.
   */
  | { type: 'reset'; reason: 'idle' | 'host' | 'join'; from: number; params: Record<string, ParamWireValue>; game: GameState }
  | { type: 'error'; message: string }

export const MAX_JSON_BYTES = 8192
export const MAX_NAME_LENGTH = 24
/** The least time between two renames by one player, so a name cannot flood a room. */
export const RENAME_INTERVAL_MS = 2000

/** Parse a control message without throwing. Returns null on anything malformed. */
export function parseJson<T>(text: string): T | null {
  if (text.length > MAX_JSON_BYTES) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && typeof v.type === 'string' ? (v as T) : null
  } catch {
    return null
  }
}

export function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}
