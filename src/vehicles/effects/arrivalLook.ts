/**
 * The look of one vehicle arrival (Materialize.ts owns the timing and the particles).
 *
 * The owner, 16 November 2026: "put a little more work into the glowing cloud when vehicles
 * swap or materialize. It's pretty weak at the moment." Everything here is generated in the
 * shaders from a sphere, a quad, an open cylinder and the vehicle's own meshes: no textures.
 *
 *  - Volume. A sphere drawn as a thick glowing cloud: two layers of noise streaming inward
 *    toward the centre, densest where the line of sight through the sphere is longest, with a
 *    white-hot core that grows as it gathers. On release it flings out into a thin shell of
 *    light and thins away.
 *  - Ground. A quad on the surface under it: a pool of the cloud's light while it gathers, and
 *    on release a bright ring that runs outward, the shock of the let-go.
 *  - Beam. A tall soft column of light, faint while gathering and flashing on release, so the
 *    arrival reads from far away.
 *  - Silhouette. The vehicle's own meshes, drawn again in light: a glowing solid that resolves
 *    into the real vehicle from the bottom up during the hold, edged by a bright scan line.
 *  - The player's colours throughout: body colour in the cloud's depth, accent at its glow.
 *
 * Normal blending with HDR colour rather than additive: additive light washes out to nothing
 * over a sunlit desert, while a bright colour drawn over the scene reads at noon and glows at
 * night (hotExposureNode keeps it from bleaching under the night exposure). Reduced motion
 * slows the streaming, fades the silhouette in instead of sweeping it, and holds the ring
 * still. Graphics level 0 uses one noise octave and a coarser sphere.
 */
import * as T from 'three/webgpu'
import {abs,clamp,dot,exp,float,mix,mx_fractal_noise_float,normalView,positionLocal,positionViewDirection,positionWorld,renderGroup,smoothstep,time,uniform,uv,vec3} from 'three/tsl'
import {hotExposureNode} from '../skins/hotExposure'
import {vehicleNightAmount} from '../skins/nightReadability'

// TSL nodes are dynamically typed; sprites.ts uses the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** Seconds the release (shock ring, flung shell, silhouette fade) takes. */
export const RELEASE_SECONDS = .9
/** Share of a departure spent undoing the release before it undoes the gather. */
const DEPART_RELEASE = .3
/** Seconds a cancelled arrival takes to fade. */
const CANCEL_SECONDS = .25
/** Beyond about 1 / FAR_SCALE metres (at size 1) the cloud and beam grow with distance. */
const FAR_SCALE = 1 / 25
/** At most this many of the vehicle's meshes are drawn again as the silhouette. */
const MAX_GHOSTS = 32

/**
 * 1 in daylight, 0 at night. By day the cloud is deeper coloured and more opaque, since glow
 * does not read against a bright sky; at night it glows.
 */
const daylight = (): N => uniform(1).setGroup(renderGroup).onRenderUpdate(frame => 1 - vehicleNightAmount(frame.scene as T.Scene))

/** Smoothstep easing, 0 to 1. */
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

interface Uniforms {
  /** Gathering, 0 at the start of the hold to 1 at its end. */
  progress: N
  /** 0 until release, then 0 to 1 over RELEASE_SECONDS. */
  release: N
  /** Overall brightness: the intensity slider, and the cancel fade. */
  strength: N
  accent: N
  body: N
  /** 1, or a quarter for reduced motion. */
  motion: N
  /** Silhouette scan line height (world y). */
  front: N
}

function volumeMaterial(u: Uniforms, octaves: number): T.MeshBasicNodeMaterial {
  const m = new T.MeshBasicNodeMaterial({transparent: true, depthWrite: false})
  m.fog = false
  const dir = positionLocal.normalize()
  const t: N = time.mul(u.motion)
  // A feature at q appears at q - dir * t: the pattern streams in toward the centre.
  // A lumpy outline: the sphere's surface heaves with slow noise, so its edge is never a circle.
  m.positionNode = positionLocal.mul(mx_fractal_noise_float(dir.mul(1.6).add(vec3(0, t.mul(.35), 0)), 1, 2, .5).mul(.28).add(1))
  const inflow = mx_fractal_noise_float(positionLocal.mul(.95).add(dir.mul(t.mul(.7))), octaves, 2, .5)
  const churn = mx_fractal_noise_float(positionLocal.mul(1.9).add(vec3(t.mul(.3), t.mul(-.9), t.mul(.5))), 1, 2, .5)
  // Facing the viewer straight on, the sight line crosses the whole sphere: thick. At the rim, thin.
  const facing: N = abs(dot(normalView, positionViewDirection))
  const live = float(1).sub(u.release)
  // Soft all the way to the rim, so it reads as a cloud and not a ball.
  // A steady fill the noise only shades, so it reads as one cloud rather than separate blots.
  const density = mix(float(.45), float(1), smoothstep(-.5, .5, inflow.mul(.75).add(churn.mul(.35)))).mul(smoothstep(.05, .85, facing))
  const cloud = density.mul(u.progress.mul(.75).add(.25)).mul(live.pow(3))
  const core = facing.pow(7).mul(u.progress.pow(1.5)).mul(live)
  const shell = float(1).sub(facing).pow(2.5).mul(u.release.greaterThan(0).select(live.pow(2), 0))
  // Mostly the accent; the body colour only shades the deeper folds.
  const tint = mix(u.accent, u.body, smoothstep(.1, .7, churn).mul(.45))
  const day = daylight()
  m.colorNode = tint.mul(cloud.mul(mix(1.1, .8, day)).add(mix(.35, .3, day))).add(vec3(1, 1, 1).mul(core.mul(mix(1.8, 1.2, day)))).add(u.accent.mul(shell.mul(2.5))).mul(u.strength).mul(hotExposureNode())
  m.opacityNode = clamp(cloud.mul(mix(1.5, 2.6, day)).add(core.mul(.7)).add(shell.mul(.9)), 0, 1).mul(clamp(u.strength, 0, 1))
  return m
}

function groundMaterial(u: Uniforms): T.MeshBasicNodeMaterial {
  const m = new T.MeshBasicNodeMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})
  m.fog = false
  const r = uv().mul(2).sub(1).length()
  const live = float(1).sub(u.release)
  // The pool of light under the cloud.
  const pool = float(1).sub(r).clamp(0, 1).pow(1.6).mul(u.progress.mul(.8).add(.2)).mul(live.pow(.5))
  // The release ring runs outward; with reduced motion it stays at half radius and only fades.
  const reach = mix(float(.5), u.release.mul(1.05), u.motion.sub(.25).div(.75).clamp(0, 1))
  const ring = exp(r.sub(reach).div(.05).pow(2).negate()).mul(u.release.greaterThan(0).select(live.pow(1.5), 0))
  const day = daylight()
  m.colorNode = u.accent.mul(pool.mul(mix(1.6, .9, day))).add(mix(u.accent, vec3(1, 1, 1), .35).mul(ring.mul(4))).mul(u.strength).mul(hotExposureNode())
  m.opacityNode = clamp(pool.mul(mix(.7, 1.2, day)).add(ring), 0, 1).mul(float(1).sub(smoothstep(.95, 1, r))).mul(clamp(u.strength, 0, 1))
  return m
}

function beamMaterial(u: Uniforms): T.MeshBasicNodeMaterial {
  const m = new T.MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: T.DoubleSide})
  m.fog = false
  const v = uv().y
  const facing: N = abs(dot(normalView, positionViewDirection))
  const flash = u.release.greaterThan(0).select(float(1).sub(u.release).pow(2).mul(1.6), 0)
  const level = u.progress.mul(.6).add(.15).add(flash)
  // By day a deeper accent, drawn more opaque and wider in the core, so it reads against the sky.
  const day = daylight()
  const core = mix(facing.pow(2), facing.pow(.8), day)
  const lit = core.mul(float(1).sub(v).pow(1.6)).mul(level)
  m.colorNode = mix(u.accent, vec3(1, 1, 1), facing.pow(6).mul(mix(.5, .15, day))).mul(lit.mul(mix(2.5, 1.1, day))).mul(u.strength).mul(hotExposureNode())
  m.opacityNode = clamp(lit.mul(mix(.8, 1.8, day)), 0, 1).mul(clamp(u.strength, 0, 1))
  return m
}

function ghostMaterial(u: Uniforms): T.MeshBasicNodeMaterial {
  const m = new T.MeshBasicNodeMaterial({transparent: true, depthWrite: false})
  m.fog = false
  const y = positionWorld.y
  // Above the scan line the vehicle is still light; below, it has resolved. Reduced motion
  // cross-fades the whole body instead of sweeping it.
  const sweep = smoothstep(u.front.sub(.06), u.front.add(.06), y)
  const still = float(1).sub(u.progress)
  const unresolved = mix(still, sweep, u.motion.sub(.25).div(.75).clamp(0, 1)).mul(float(1).sub(u.release))
  const line = exp(y.sub(u.front).div(.06).pow(2).negate()).mul(u.motion.greaterThan(.5).select(1, 0)).mul(float(1).sub(u.release.mul(4)).clamp(0, 1))
  const rim = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2).mul(float(1).sub(u.release).pow(2))
  m.colorNode = u.accent.mul(unresolved.mul(.85).add(rim.mul(.9))).add(vec3(1, 1, 1).mul(line.mul(2))).mul(u.strength).mul(hotExposureNode())
  m.opacityNode = clamp(unresolved.mul(.88).add(line).add(rim.mul(.5)), 0, 1).mul(clamp(u.strength, 0, 1))
  return m
}

export class ArrivalLook {
  readonly object = new T.Group()
  readonly volume: T.Mesh
  readonly ground: T.Mesh
  readonly beam: T.Mesh
  private readonly u: Uniforms
  private readonly ghostMat: T.MeshBasicNodeMaterial
  private readonly ghosts: T.Mesh[] = []
  /** Where the cloud is (the hold point, or a moving remote copy's position). */
  readonly centre = new T.Vector3()
  /** The vehicle's lowest and highest points above its origin, for the silhouette sweep. */
  private low = -1
  private high = 1
  private size = 1
  private releaseAge = -1
  private cancelAge = -1
  private intensity = 1
  /** True between start() and the end of the release or cancel fade. */
  active = false
  /**
   * A departure: the arrival played backwards. Its `progress` (0 to 1 over the whole departure)
   * runs the release in reverse first (the ring and the flung shell close in on the vehicle),
   * then the gather in reverse (the vehicle turns to light from the top down while the cloud
   * thins outward). The caller removes the vehicle at the end, inside the cloud.
   */
  departing = false

  constructor(level: number) {
    this.u = {
      progress: uniform(0), release: uniform(0), strength: uniform(1), motion: uniform(1), front: uniform(0),
      accent: uniform(new T.Color(.5, .85, 1)), body: uniform(new T.Color(.2, .4, .8)),
    }
    const octaves = level === 0 ? 1 : 2
    this.volume = new T.Mesh(new T.IcosahedronGeometry(1, level === 0 ? 2 : 4), volumeMaterial(this.u, octaves))
    this.volume.renderOrder = 5
    const quad = new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    this.ground = new T.Mesh(quad, groundMaterial(this.u))
    this.ground.renderOrder = 2
    const column = new T.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, .5, 0)
    this.beam = new T.Mesh(column, beamMaterial(this.u))
    this.beam.renderOrder = 5
    this.ghostMat = ghostMaterial(this.u)
    for (const m of [this.volume, this.ground, this.beam]) { m.frustumCulled = false; m.castShadow = m.receiveShadow = false }
    this.object.add(this.volume, this.ground, this.beam)
    this.object.visible = false
  }

  /** Everything this look draws, for shader compilation ahead of the first arrival. */
  get meshes(): T.Mesh[] { return [this.volume, this.ground, this.beam] }

  start(vehicle: {object: T.Object3D; colors: {body: T.ColorRepresentation; accent: T.ColorRepresentation}}, reducedMotion: boolean, departing = false): void {
    this.detachGhosts()
    this.active = true
    this.departing = departing
    this.releaseAge = this.cancelAge = -1
    this.u.release.value = 0
    this.u.progress.value = 0
    this.u.motion.value = reducedMotion ? .25 : 1
    ;(this.u.accent.value as T.Color).set(vehicle.colors.accent)
    ;(this.u.body.value as T.Color).set(vehicle.colors.body)
    this.object.visible = true
    this.attachGhosts(vehicle.object)
  }

  /** Per frame while active. `progress` is the hold's share elapsed; `surface` the ground or liquid height under the centre. */
  update(dt: number, progress: number, surface: number, size: number, intensity: number, distance = 0): void {
    if (!this.active) return
    this.size = size
    this.intensity = intensity
    let strength = intensity
    if (this.cancelAge >= 0) {
      this.cancelAge += dt
      strength *= Math.max(0, 1 - this.cancelAge / CANCEL_SECONDS)
      if (this.cancelAge >= CANCEL_SECONDS) { this.end(); return }
    } else if (this.releaseAge >= 0) {
      this.releaseAge += dt
      this.u.release.value = Math.min(1, this.releaseAge / RELEASE_SECONDS)
      if (this.releaseAge >= RELEASE_SECONDS) { this.end(); return }
    } else if (this.departing) {
      // The first part undoes the release, the rest undoes the gather.
      const split = DEPART_RELEASE
      this.u.release.value = progress < split ? 1 - progress / split : 0
      this.u.progress.value = progress < split ? 1 : 1 - (progress - split) / (1 - split)
    } else {
      this.u.progress.value = progress
    }
    this.u.strength.value = strength
    const p = this.u.progress.value as number, r = this.u.release.value as number
    // Gathers in from wide to vehicle sized; on release flings out to three times that.
    // Seen from far off (another player's arrival), the cloud and beam keep a minimum apparent
    // size, so an arrival 100 m away still reads as one.
    const far = Math.max(1, distance * FAR_SCALE / size)
    const radius = size * (r > 0 ? 1.4 + 3.2 * ease(r) : 2.8 - 1.4 * ease(p)) * Math.sqrt(far)
    this.volume.position.copy(this.centre)
    this.volume.scale.set(radius, radius * .8, radius)
    const reach = size * 7
    this.ground.position.set(this.centre.x, surface + .12, this.centre.z)
    this.ground.scale.set(reach, 1, reach)
    this.beam.position.set(this.centre.x, surface, this.centre.z)
    this.beam.scale.set(.45 * size * far, 40 * size * Math.sqrt(far), .45 * size * far)
    // The scan line climbs from just under the vehicle to just over it during the hold.
    const bottom = this.centre.y + this.low - .2
    this.u.front.value = bottom + (this.high - this.low + .4) * ease(p)
  }

  /** The light this arrival casts now, 0 when it casts none (for the shared point light). */
  light(): number {
    if (!this.active || this.cancelAge >= 0) return 0
    const r = this.u.release.value as number
    return this.intensity * (r > 0 ? (1 - r) ** 2 * 3 : .4 + .8 * (this.u.progress.value as number))
  }

  get accent(): T.Color { return this.u.accent.value as T.Color }

  release(): void {
    if (!this.active || this.releaseAge >= 0 || this.cancelAge >= 0) return
    this.u.progress.value = 1
    this.releaseAge = 0
  }

  cancel(): void {
    if (this.active && this.cancelAge < 0) this.cancelAge = 0
  }

  private end(): void {
    this.active = false
    this.object.visible = false
    this.detachGhosts()
  }

  /** The vehicle's meshes drawn again in light, as children so they move and switch detail with it. */
  private attachGhosts(root: T.Object3D): void {
    root.updateWorldMatrix(true, true)
    const box = new T.Box3()
    root.traverse(o => {
      const mesh = o as T.Mesh
      if (!mesh.isMesh || this.ghosts.length >= MAX_GHOSTS || mesh.userData.arrivalGhost) return
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as T.Material | undefined
      if (!material || material.transparent) return
      let ghost: T.Mesh
      const instanced = mesh as T.InstancedMesh
      if (instanced.isInstancedMesh) {
        const copy = new T.InstancedMesh(mesh.geometry, this.ghostMat, instanced.count)
        copy.instanceMatrix = instanced.instanceMatrix
        ghost = copy
      } else ghost = new T.Mesh(mesh.geometry, this.ghostMat)
      ghost.userData.arrivalGhost = true
      ghost.renderOrder = 6
      ghost.frustumCulled = false
      ghost.castShadow = ghost.receiveShadow = false
      mesh.add(ghost)
      this.ghosts.push(ghost)
      if (!instanced.isInstancedMesh && mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox()
      if (!instanced.isInstancedMesh && mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    })
    const origin = root.getWorldPosition(new T.Vector3()).y
    this.low = box.isEmpty() ? -1 : Math.max(-4, box.min.y - origin)
    this.high = box.isEmpty() ? 1 : Math.min(4, Math.max(this.low + .5, box.max.y - origin))
  }

  private detachGhosts(): void {
    for (const ghost of this.ghosts) ghost.removeFromParent()
    this.ghosts.length = 0
  }

  dispose(): void {
    this.end()
    this.object.removeFromParent()
    for (const m of [this.volume, this.ground, this.beam]) { m.geometry.dispose(); (m.material as T.Material).dispose() }
    this.ghostMat.dispose()
  }
}
