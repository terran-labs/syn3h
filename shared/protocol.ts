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

export const PROTOCOL_VERSION = 1

/** Binary message kinds (first byte). */
export const BIN_STATE = 1

/** Input axes are quantised to signed bytes. */
const AXIS_SCALE = 127

export const FLAG_BRAKES = 1
export const FLAG_SPECIAL = 2
export const FLAG_FIRE = 4

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
}

const clampAxis = (n: number) => Math.max(-AXIS_SCALE, Math.min(AXIS_SCALE, Math.round((Number.isFinite(n) ? n : 0) * AXIS_SCALE)))

export function encodeState(s: WireState, out?: Uint8Array): Uint8Array {
  const buf = out ?? new Uint8Array(STATE_BYTES)
  const dv = new DataView(buf.buffer, buf.byteOffset, STATE_BYTES)
  dv.setUint8(O_KIND, BIN_STATE)
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
  dv.setUint8(O_FLAGS, (s.input.brakes ? FLAG_BRAKES : 0) | (s.input.special ? FLAG_SPECIAL : 0) | (s.input.fire ? FLAG_FIRE : 0))
  return buf
}

/** Decode a state record. Returns null if it is malformed or holds non finite numbers. */
export function decodeState(data: ArrayBuffer | Uint8Array): WireState | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.byteLength !== STATE_BYTES) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, STATE_BYTES)
  if (dv.getUint8(O_KIND) !== BIN_STATE) return null
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
    },
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
}

/** Shared game state the server owns. */
export interface GameState {
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
}

export type ClientMessage =
  | { type: 'hello'; v: number; name: string; params: Record<string, ParamWireValue> }
  | { type: 'ping'; t: number }
  | { type: 'param'; id: string; value: ParamWireValue }
  | { type: 'fire'; shot: ShotInfo }
  /** Sent by the victim's own client: "shot `shot` from `shooter` hit me". */
  | { type: 'hit'; shooter: number; shot: number }
  /** Sent by a client whose vehicle touched another player's vehicle. */
  | { type: 'ram'; other: number }
  /** Host only: lock or unlock shared parameters for everyone else. */
  | { type: 'lock'; locked: boolean }

export type TagEvent = 'default' | 'ram' | 'laser' | 'score' | 'leave' | 'lock' | 'host'

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
    }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'join'; player: PlayerInfo }
  | { type: 'leave'; id: number }
  /** `from` is 0 when the server is correcting a rejected change back to the room's value. */
  | { type: 'param'; id: string; value: ParamWireValue; from: number }
  | { type: 'fire'; from: number; shot: ShotInfo }
  | { type: 'hit'; shooter: number; victim: number; shot: number }
  | { type: 'game'; game: GameState; event?: TagEvent; actor?: number; target?: number }
  | { type: 'error'; message: string }

export const MAX_JSON_BYTES = 8192
export const MAX_NAME_LENGTH = 24

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
