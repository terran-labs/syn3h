/**
 * Headlight cones in mist: the beam of each front lamp seen in the air, the "flashlight in the
 * fog" look (the owner, 18 November 2026: simulated, not real scattered light).
 *
 * One instanced mesh of soft, open cones, one per front headlight of every buggy with effects
 * (bots and remote players too: no real light is needed per lamp). Other kinds join one at a
 * time once their lamps have been checked in frames. Each cone sits on its lamp
 * point (VehicleEffects' lamp points: even ones are the front headlights) and points down the
 * road as the real beam does. Its brightness is the lamp's (the beam's dusk-to-dawn ramp, and
 * for the buggy the headlight setting) times the haze in the air at each point of the cone, from
 * the shared haze field: the height haze (weather/fog.ts) and the fog banks (weather/fogMap.ts).
 * So it shows where there is mist to show it and is nothing in clear air or by day.
 *
 * Soft everywhere: brightest down its middle and fading to nothing at its rim (by the angle to
 * the view), fading along its length, and fading where it meets the road or a wall (the scene
 * depth behind it), so it never cuts a line into the world. Additive, depth tested, writes no
 * depth.
 */
import * as T from 'three/webgpu'
import {
  abs, cameraFar, cameraNear, clamp, dot, exp, float, instanceColor, max, normalView, normalize, perspectiveDepthToViewZ,
  positionGeometry, positionView, positionWorld, pow, smoothstep, texture, uniform, vec2, vec3, viewportDepthTexture,
} from 'three/tsl'
import { applyCurve } from '../../world/curve'
import { defineParam } from '../../../shared/params'

type N = any // TSL node

/** How bright the cones are, on top of the lamps' own brightness. 0 turns them off. */
export const headlightCones = defineParam({ id: 'light.headlightCones', label: 'Headlight beams in mist', group: 'Light', scope: 'client', default: 1, min: 0, max: 3, step: 0.05 })

/**
 * How bright each kind's beam is in the air, on top of its lamp's brightness and leaving the
 * lamps themselves alone. The buggy's lamps follow light.buggyHeadlights (0.4 since 18
 * November) and its beam with them; the hovercraft's and jet's lamps are still at 1, so their
 * beams start at 0.4 to match the buggy's. If the owner dims their lamps, set these to 1.
 * World settings since 22 November 2026 (how vehicles look to everyone). Whether beams are drawn
 * at all stays each player's: headlightCones above, which their quality level sets (0 at Minimal).
 */
export const buggyBeams = defineParam({ id: 'light.buggyBeams', label: 'Buggy beams in mist (lamps unchanged)', group: 'Vehicle looks', scope: 'world', default: 1, min: 0, max: 2, step: 0.05 })
export const hovercraftBeams = defineParam({ id: 'light.hovercraftBeams', label: 'Hovercraft beams in mist (lamps unchanged)', group: 'Vehicle looks', scope: 'world', default: 0.4, min: 0, max: 2, step: 0.05 })
export const jetBeams = defineParam({ id: 'light.jetBeams', label: 'Jet beams in mist (lamps unchanged)', group: 'Vehicle looks', scope: 'world', default: 0.4, min: 0, max: 2, step: 0.05 })
/** The beam-only factor for a vehicle kind (1 for kinds without one). */
export function beamFactorFor(kind: string): number {
  if (kind.startsWith('buggy')) return Number(buggyBeams.value)
  return kind === 'hovercraft' ? Number(hovercraftBeams.value) : kind === 'jet' ? Number(jetBeams.value) : 1
}

/** Cone length (m) and half angle (radians) of the buggy's visible beam. */
export const CONE_LENGTH = 18, CONE_HALF_ANGLE = (12 * Math.PI) / 180
/** The real beam's tip below the lamp at 22 m ahead: the cone follows it (effects/index.ts spot target). */
export const CONE_DROP = Math.atan2(0.8, 22)

/**
 * A vehicle kind's beam in mist: its length (m), half angle and drop below the lamp's axis
 * (radians). Every kind draws into the one cone batch with the one material; a kind joins by
 * having a shape here (coneShapeFor), so any vehicle, a bot's included, reuses it.
 */
export interface ConeShape { length: number; halfAngle: number; drop: number }
export const CONE_SHAPES: Readonly<Record<'buggy' | 'hovercraft' | 'jet', ConeShape>> = {
  buggy: { length: CONE_LENGTH, halfAngle: CONE_HALF_ANGLE, drop: CONE_DROP },
  // The hovercraft's lamp (.23 m up) aims 1 m down at 20 m; it sits low over water, so a
  // shorter, wider beam that meets the surface instead of tunnelling under it.
  hovercraft: { length: 16, halfAngle: (14 * Math.PI) / 180, drop: Math.atan2(1.03, 20.15) },
  // The jet's lamps hang under the nose and it is usually flying: a longer, narrower beam
  // reads as a landing light reaching ahead rather than a puddle under the fuselage.
  jet: { length: 28, halfAngle: (9 * Math.PI) / 180, drop: Math.atan2(1.15, 18.7) },
}
/** The cone shape for a vehicle kind, or null for a kind without cones. */
export function coneShapeFor(kind: string): ConeShape | null {
  if (kind.startsWith('buggy')) return CONE_SHAPES.buggy
  return kind === 'hovercraft' || kind === 'jet' ? CONE_SHAPES[kind] : null
}
/**
 * Brightness of a cone in thick mist, per unit of lamp brightness, and the haze density (per
 * metre) at which it reaches about two thirds of that: the glow saturates, so a dense bank
 * reads as a bright beam rather than a white-out. Tuned by frames.
 */
export const CONE_GAIN = 1.6, CONE_DENSITY_SCALE = 120
/** Metres over which a cone fades where it meets the scene behind it. */
export const CONE_SOFT_DEPTH = 1.5
/** Most cones drawn (two per vehicle). */
export const MAX_CONES = 128

/** The shared haze numbers a cone reads, written by the effects world each frame. */
export interface ConeHaze {
  hazeD: N; hazeH: N; sea: N
  /**
   * The fog bank map (fogMap.ts) and its weights, or zero weights with no banks. `bankMap` is
   * the shader's final sampled node: set its `value` to swap the map in (a texture node's
   * sample() and level() copy it, so only the last one drawn from is live).
   */
  bankMap: N; bankWeights: N; bankInvSize: N
}

export function createConeHaze(): ConeHaze {
  return {
    hazeD: uniform(0), hazeH: uniform(40), sea: uniform(0),
    bankMap: null, bankWeights: uniform(new T.Vector2(0, 0)), bankInvSize: uniform(1 / 2048),
  }
}
let empty: T.DataTexture | null = null
function emptyMap(): T.DataTexture {
  if (!empty) { empty = new T.DataTexture(new Uint16Array(4), 1, 1, T.RGBAFormat, T.HalfFloatType); empty.needsUpdate = true }
  return empty
}

/** The cone geometry: apex at the origin, opening along -Z, length 1 and end radius 1. */
function coneGeometry(): T.BufferGeometry {
  const g = new T.ConeGeometry(1, 1, 32, 1, true)
  g.translate(0, -0.5, 0) // apex at the origin, base at y = -1
  g.rotateX(Math.PI / 2) // y -> z: base at z = -1
  return g
}

/** The cone batch: one instanced mesh for every vehicle's front lamps. */
export function createConeBatch(haze: ConeHaze): T.InstancedMesh {
  const material = new T.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false })
  // How far along the cone (0 at the lamp, 1 at its end).
  // The geometry's own position: positionLocal already carries the instance matrix.
  const along = clamp(positionGeometry.z.negate(), 0, 1) as N
  // Brightest through the middle of the beam, nothing at its rim.
  const facing = abs(dot(normalize(normalView), normalize(positionView.negate()))) as N
  // Brightest through the middle of the beam and gone at its outline; the upper half of the
  // shell is dimmer still, so the beam's top edge is a soft fade, not a line against the dark.
  const up = smoothstep(-0.2, 1.0, positionGeometry.y.div(max(along, float(1e-3))))
  const rim = pow(facing, float(3)).mul(float(1).sub(up.mul(0.75)))
  // Brighter near the lamp, gone at the end; and not a hard ring at the lamp itself.
  // Bright at the lamp, thinning toward the beam's reach: most of it in the first third.
  const fall = pow(float(1).sub(along), float(2.6)).mul(smoothstep(0.0, 0.06, along))
  // Where it meets the world behind it: the scene's depth at this pixel against the cone's.
  const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture().x, cameraNear, cameraFar) as N
  const soft = smoothstep(0.0, CONE_SOFT_DEPTH, positionView.z.sub(sceneZ))
  // The haze here: height haze, plus the fog banks from the map at this place.
  const y = positionWorld.y as N
  const height = (haze.hazeD as N).mul(exp(y.sub(haze.sea).div(haze.hazeH).negate()))
  const m = (texture(emptyMap()) as N).sample(vec2(positionWorld.x, positionWorld.z).mul(haze.bankInvSize).add(0.5)).level(float(0))
  haze.bankMap = m
  const bank = m.r.mul(haze.bankWeights.x).add(m.g.mul(haze.bankWeights.y))
  const density = height.add(bank)
  const glow = float(1).sub(exp(density.mul(-CONE_DENSITY_SCALE)))
  const light = vec3(instanceColor).mul(glow).mul(CONE_GAIN).mul(rim).mul(fall).mul(soft)
  material.colorNode = max(light, vec3(0))
  applyCurve(material)
  const mesh = new T.InstancedMesh(coneGeometry(), material, MAX_CONES)
  mesh.name = 'headlight-cones'
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.renderOrder = 5
  mesh.setColorAt(0, new T.Color(0, 0, 0))
  return mesh
}

const tilt = new T.Matrix4(), shape = new T.Matrix4()
/**
 * Write one vehicle's cones from its lamp points (even ones are the front headlights) at
 * `brightness` (the lamp's, before haze). Returns the next free index.
 */
export function writeVehicleCones(mesh: T.InstancedMesh, index: number, object: T.Object3D, points: readonly T.Object3D[], colour: T.Color, brightness: number, scratch: T.Matrix4, camera?: T.Vector3, cone: ConeShape = CONE_SHAPES.buggy): number {
  tilt.makeRotationX(-cone.drop)
  const radius = cone.length * Math.tan(cone.halfAngle)
  shape.makeScale(radius, radius, cone.length)
  for (let i = 0; i < points.length && index < MAX_CONES; i += 2, index++) {
    scratch.copy(points[i].matrixWorld).multiply(tilt).multiply(shape)
    let fade = 1
    if (camera) fade = insideFade(scratch, camera, radius, cone.length)
    if (!object.visible || !(brightness * fade > 0)) scratch.makeScale(0, 0, 0)
    mesh.setMatrixAt(index, scratch)
    mesh.setColorAt(index, tmpColour.copy(colour).multiplyScalar(brightness * fade))
  }
  return index
}

const inverse = new T.Matrix4(), local = new T.Vector3()
/**
 * A shell of a cone cannot show the beam from inside it (its walls would draw as a tunnel), so
 * a cone fades out as the camera comes within CONE_INSIDE_FADE metres of its surface and is
 * gone with the camera inside. From in front, the lamps' own glare carries the look.
 */
export function insideFade(matrix: T.Matrix4, camera: T.Vector3, radius: number, length = CONE_LENGTH): number {
  local.copy(camera).applyMatrix4(inverse.copy(matrix).invert())
  const along = -local.z
  if (along > 1.2) return 1
  // Metres outside the cone's wall, roughly: the radial gap at this depth, or the distance
  // behind the lamp.
  const outside = along <= 0 ? Math.hypot(local.x * radius, local.y * radius, along * length) : (Math.hypot(local.x, local.y) - Math.max(along, 0)) * radius
  const t = Math.min(1, Math.max(0, outside / CONE_INSIDE_FADE))
  return t * t * (3 - 2 * t)
}
/** Metres from a cone's surface over which it fades as the camera comes in. */
export const CONE_INSIDE_FADE = 2
const tmpColour = new T.Color()
const hidden = new T.Matrix4().makeScale(0, 0, 0)
/** Collapse the slots no vehicle wrote this frame. */
export function hideUnusedCones(mesh: T.InstancedMesh, index: number): void {
  for (let i = index; i < mesh.count; i++) mesh.setMatrixAt(i, hidden)
}
