/**
 * Scorches where gear struck solid ground: a ragged blob lying on the surface that glows at
 * its rim while hot, cools to a dark mark, then fades. A bounded pool; a busy scene reuses the
 * oldest. The CPU writes a mark once, when it is made; its age, shape and colour are worked
 * out on the GPU from its birth time, so an idle pool costs one draw and no uploads.
 *
 * Blended as premultiplied light over a darkening: out = glow + under * (1 - darkness), so one
 * pass both burns the ground and lights it.
 */
import * as T from 'three/webgpu'
import { atan, attribute, exp, float, smoothstep, uniform, uv } from 'three/tsl'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'

type N = any // TSL's arithmetic nodes are dynamically typed.
const UP = new T.Vector3(0, 0, 1)
export const SCORCH_CAPACITY = 32

export class ScorchMarks {
  readonly mesh: T.InstancedMesh
  readonly clock = uniform(0)
  /** How many of the pool's slots are used: fewer at lower quality, 0 for none. */
  limit = SCORCH_CAPACITY
  private readonly state: T.InstancedBufferAttribute
  private readonly glow: T.InstancedBufferAttribute
  private next = 0
  private readonly place = new T.Object3D()
  private readonly turn = new T.Quaternion()

  constructor() {
    const g = new T.PlaneGeometry(1, 1)
    this.state = new T.InstancedBufferAttribute(new Float32Array(SCORCH_CAPACITY * 4), 4).setUsage(T.DynamicDrawUsage)
    this.glow = new T.InstancedBufferAttribute(new Float32Array(SCORCH_CAPACITY * 3), 3).setUsage(T.DynamicDrawUsage)
    for (let i = 0; i < SCORCH_CAPACITY; i++) this.state.setXYZW(i, -1e4, 1, 0, 0)
    g.setAttribute('scorchState', this.state); g.setAttribute('scorchGlow', this.glow)
    const s: N = attribute('scorchState', 'vec4') // birth, life, seed, darkness
    const age: N = this.clock.sub(s.x), life: N = s.y.max(0.1)
    const p: N = uv().mul(2).sub(1), r: N = p.length(), a: N = atan(p.y, p.x)
    // A small dark burn with a slightly ragged edge, a different shape for every mark, and a few
    // dark streaks thrown out from it. While hot, a thin rim at its edge glows in the gear's
    // colour, cooling within a fraction of a second; the mark itself never glows (the light on
    // the ground around an impact is ImpactPulses' glow, and it is brief).
    const edge: N = float(0.42).add(a.mul(5).add(s.z.mul(6.28)).sin().mul(0.03)).add(a.mul(11).add(s.z.mul(17)).sin().mul(0.015))
    const inside: N = float(1).sub(smoothstep(edge.sub(0.12), edge, r))
    const band: N = r.sub(edge.sub(0.04)).div(0.035)
    const rim: N = exp(band.mul(band).negate())
    const rays: N = a.mul(6.5).add(s.z.mul(20)).sin().abs().pow(16).mul(float(1).sub(smoothstep(edge, edge.add(0.5), r))).mul(smoothstep(edge.sub(0.1), edge, r))
    const live: N = age.greaterThanEqual(0).and(age.lessThan(life)).select(float(1), float(0))
    const heat: N = exp(age.max(0).negate().div(0.15))
    const fade: N = float(1).sub(smoothstep(life.mul(0.55), life, age))
    const m = new T.MeshBasicNodeMaterial({ name: 'gear scorch', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    m.blending = T.CustomBlending; m.blendSrc = T.OneFactor; m.blendDst = T.OneMinusSrcAlphaFactor
    m.colorNode = attribute('scorchGlow', 'vec3').mul(heat.mul(rim.mul(2.4))).mul(live).mul(hotExposureNode())
    m.opacityNode = inside.max(rays.mul(0.65)).mul(s.w).mul(fade).mul(smoothstep(0, 0.08, age)).mul(live)
    // No fog: with this blend, fog added to the clear part of the quad drew it as a pale square.
    m.fog = false
    this.mesh = new T.InstancedMesh(g, m, SCORCH_CAPACITY)
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage)
    const hidden = new T.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < SCORCH_CAPACITY; i++) this.mesh.setMatrixAt(i, hidden)
  }

  /** A scorch at `at`, lying on unit `normal`, `size` m across, lasting `life` s, glowing `glow`. */
  emit(at: T.Vector3, normal: T.Vector3, size: number, life: number, glow: T.Color, darkness: number, seed: number): void {
    if (this.limit <= 0 || !(life > 0)) return
    const i = this.next % Math.min(this.limit, SCORCH_CAPACITY); this.next = i + 1
    this.place.position.copy(at).addScaledVector(normal, 0.04)
    this.place.quaternion.setFromUnitVectors(UP, normal).multiply(this.turn.setFromAxisAngle(UP, seed * Math.PI * 2))
    this.place.scale.setScalar(size); this.place.updateMatrix()
    this.mesh.setMatrixAt(i, this.place.matrix); this.mesh.instanceMatrix.needsUpdate = true
    this.state.setXYZW(i, this.clock.value, life, seed, darkness); this.state.addUpdateRange(i * 4, 4); this.state.needsUpdate = true
    this.glow.setXYZ(i, glow.r, glow.g, glow.b); this.glow.addUpdateRange(i * 3, 3); this.glow.needsUpdate = true
  }

  /** Carry the marks across a world seam. */
  shift(dx: number, dz: number): void {
    const m = new T.Matrix4()
    for (let i = 0; i < SCORCH_CAPACITY; i++) {
      this.mesh.getMatrixAt(i, m)
      m.elements[12] += dx; m.elements[14] += dz
      this.mesh.setMatrixAt(i, m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as T.Material).dispose() }
}
