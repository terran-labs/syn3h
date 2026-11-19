/**
 * Streaked sparks, all on the GPU. Each spark is one instanced quad; the CPU writes it once,
 * when it is born, and the vertex shader does the rest every frame: drag (an exponential fall
 * of speed), gravity, one bounce off the plane it was born on, and the streak, a quad drawn
 * along the spark's own velocity and facing the camera, so a fast spark reads as a short line
 * of light. Hot white at birth, cooling to its tint, fading as it goes.
 *
 * After the stateless GPU particles of the WebGL2 particle tutorials (nullprogram, gpfault):
 * position from birth data and time alone, origin + v (1 - e^-kt) / k + g t^2 / 2, no CPU loop
 * per particle. The bounce is the analytic shortcut for a flat surface: whatever of the path
 * lies below the plane is mirrored above it, scaled by the bounce.
 *
 * A spark whose life is over (or has not begun) collapses to a point and is never rasterised.
 */
import * as T from 'three/webgpu'
import { attribute, cameraPosition, cross, dot, exp, float, mix, normalize, positionGeometry, smoothstep, uniform, vec3 } from 'three/tsl'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'

type N = any // TSL's arithmetic nodes are dynamically typed.

export interface SparkSpec {
  /** Seconds it lives. */
  life: number
  /** Width of the streak, m. */
  width: number
  /** Drag: how fast its speed falls away, per second. */
  drag: number
  /** Share of gravity it feels: 1 a spark, small for an ember drifting up, negative to rise. */
  gravity: number
  /** Seconds of travel the streak is drawn over: 0.03 a spark, 0 a round mote. */
  streak: number
  /**
   * The plane it was born on: its unit normal, and how much of its speed into it comes back
   * when it bounces (0 to 1; 0 stops it dead on the surface). -1: no plane, it falls freely
   * (a liquid, a firework in the air).
   */
  normal: { x: number; y: number; z: number }
  bounce: number
}

export class SparkBatch {
  readonly mesh: T.Mesh
  readonly clock = uniform(0)
  private readonly origin: T.InstancedBufferAttribute
  private readonly velocity: T.InstancedBufferAttribute
  private readonly settings: T.InstancedBufferAttribute
  private readonly plane: T.InstancedBufferAttribute
  private readonly motion: T.InstancedBufferAttribute
  private readonly tint: T.InstancedBufferAttribute
  private next = 0
  private readonly attributes: readonly (readonly [T.InstancedBufferAttribute, number])[]
  emitted = 0

  constructor(readonly capacity: number, name: string) {
    const quad = new T.PlaneGeometry(1, 1), g = new T.InstancedBufferGeometry().copy(quad as unknown as T.InstancedBufferGeometry)
    quad.dispose(); g.instanceCount = capacity
    // WebGPU allows eight vertex buffers to a draw: the quad's corners and six of the spark's own
    // are seven. The quad's normal and uv would make nine (the draw, and the pass with it, are
    // rejected), so they go; the corner gives the uv.
    g.deleteAttribute('normal'); g.deleteAttribute('uv')
    const attr = (size: number) => new T.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(T.DynamicDrawUsage)
    this.origin = attr(3); this.velocity = attr(3); this.settings = attr(4); this.plane = attr(4); this.motion = attr(2); this.tint = attr(3)
    this.attributes = [[this.origin, 3], [this.velocity, 3], [this.settings, 4], [this.plane, 4], [this.motion, 2], [this.tint, 3]]
    for (let i = 0; i < capacity; i++) this.settings.setXYZW(i, -1e4, 1, 0, 1)
    g.setAttribute('sparkOrigin', this.origin); g.setAttribute('sparkVelocity', this.velocity); g.setAttribute('sparkSettings', this.settings)
    g.setAttribute('sparkPlane', this.plane); g.setAttribute('sparkMotion', this.motion); g.setAttribute('sparkTint', this.tint)

    const o: N = attribute('sparkOrigin', 'vec3'), v0: N = attribute('sparkVelocity', 'vec3')
    const cfg: N = attribute('sparkSettings', 'vec4') // birth, life, width, drag
    const plane: N = attribute('sparkPlane', 'vec4') // normal, bounce
    const motion: N = attribute('sparkMotion', 'vec2') // gravity share, streak seconds
    const age: N = this.clock.sub(cfg.x), t: N = age.max(0), life: N = cfg.y.max(0.001)
    const alive: N = age.greaterThanEqual(0).and(age.lessThan(life)).select(float(1), float(0))
    const k: N = cfg.w.max(0.01), keep: N = exp(k.negate().mul(t))
    const fall: N = vec3(0, -9.8, 0).mul(motion.x)
    const travel: N = v0.mul(float(1).sub(keep).div(k)).add(fall.mul(t.mul(t).mul(0.5)))
    // Below the plane it was born on, the path is mirrored back above it: one bounce.
    // rebound 0 (bounce -1) leaves the path alone: no plane.
    const n: N = plane.xyz, under: N = dot(travel, n).min(0), rebound: N = plane.w.add(1).max(0)
    const centre: N = o.add(travel).sub(n.mul(under.mul(rebound)))
    const v: N = v0.mul(keep).add(fall.mul(t))
    const vel: N = under.lessThan(0).select(v.sub(n.mul(dot(v, n).mul(rebound))), v)
    const speed: N = vel.length()
    const along: N = speed.greaterThan(1e-3).select(vel.div(speed.max(1e-3)), vec3(0, 1, 0))
    const side: N = normalize(cross(along, normalize(cameraPosition.sub(centre))))
    const width: N = cfg.z.mul(alive), length: N = speed.mul(motion.y).max(cfg.z).min(2.5).mul(alive)
    const corner: N = positionGeometry
    const m = new T.MeshBasicNodeMaterial({ name, transparent: true, depthWrite: false, blending: T.AdditiveBlending })
    m.positionNode = centre.add(along.mul(corner.y.mul(length))).add(side.mul(corner.x.mul(width)))
    // Hot white at birth, cooling to its own colour over the first part of its life.
    const u: N = t.div(life).clamp(0, 1)
    const colour: N = mix(vec3(3, 2.7, 2.2), attribute('sparkTint', 'vec3'), smoothstep(0, 0.25, u))
    // The quad's own uv, from its corner (-0.5 to 0.5).
    const across: N = float(1).sub(corner.x.mul(2).abs())
    const head: N = corner.y.add(0.5)
    m.colorNode = colour.mul(hotExposureNode())
    m.opacityNode = float(1).sub(u).pow(1.5).mul(across.pow(2.5)).mul(head.mul(0.75).add(0.25))
    m.fog = false
    this.mesh = new T.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4
  }

  /** One spark, born now or `delay` seconds from now (a firework's later stages). */
  emit(at: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, spec: SparkSpec, color: T.Color, delay = 0): void {
    const i = this.next; this.next = (i + 1) % this.capacity; this.emitted++
    this.origin.setXYZ(i, at.x, at.y, at.z); this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z)
    this.settings.setXYZW(i, this.clock.value + Math.max(0, delay), spec.life, spec.width, spec.drag)
    this.plane.setXYZW(i, spec.normal.x, spec.normal.y, spec.normal.z, spec.bounce)
    this.motion.setXY(i, spec.gravity, spec.streak); this.tint.setXYZ(i, color.r, color.g, color.b)
    // The slots written this frame, uploaded together by flush: an impact writes a dozen or so
    // sparks in a row, and a range per spark per attribute was a separate upload each.
    if (this.lo < 0) this.lo = this.hi = i
    else if (i === this.hi + 1) this.hi = i
    else this.wrapped = true
  }

  private lo = -1
  private hi = -1
  private wrapped = false
  /** Upload what emit wrote since the last flush: one range per attribute. Call once a frame, before drawing. */
  flush(): void {
    if (this.lo < 0) return
    const whole = this.wrapped, lo = this.lo, n = this.hi - this.lo + 1
    for (const [a, size] of this.attributes) { a.clearUpdateRanges(); a.addUpdateRange(whole ? 0 : lo * size, whole ? this.capacity * size : n * size); a.needsUpdate = true }
    this.lo = this.hi = -1; this.wrapped = false
  }

  /** Carry everything already drawn across a world seam. */
  shift(dx: number, dz: number): void {
    this.flush()
    const a = this.origin.array as Float32Array
    for (let i = 0; i < a.length; i += 3) { a[i] += dx; a[i + 2] += dz }
    this.origin.clearUpdateRanges(); this.origin.addUpdateRange(0, a.length); this.origin.needsUpdate = true
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as T.Material).dispose() }
}
