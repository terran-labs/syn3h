import * as T from 'three/webgpu'
import { attribute, float, mix, uv, vec3, uniform, renderGroup } from 'three/tsl'
import { defineParam, params } from '../../../shared/params'
import { applyCurve } from '../../world/curve'
import { heightFog } from '../../world/weather/fog'
import { hotExposureNode } from '../skins/hotExposure'
import type { Terrain } from '../../world/Terrain'

const SIDES = 8, SEGMENTS = 4, ROWS = 8, COLUMNS = 2
export const HEADLIGHT_RANGE = 22
export const HEADLIGHT_CAPACITY = 32 * 6
export const remoteBeamBrightness = defineParam({id:'vehicle.remoteBeamBrightness',label:'Remote headlight beams',group:'Vehicles',scope:'client',default:1,min:0,max:3,step:.05})
const QUADS_PER_LAMP = SIDES * SEGMENTS + ROWS * COLUMNS
const clamp = T.MathUtils.clamp

/** No pool on deep water or from a lamp more than five metres off the ground. */
export function poolVisibility(height: number, waterDepth: number): number {
  return clamp((5 - height) / 3, 0, 1) * clamp(1 - Math.max(0, waterDepth) / .5, 0, 1)
}

/** A fixed allocation of instanced quads: cone walls and terrain patches share ONE draw. */
export class HeadlightBatch {
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.MeshBasicNodeMaterial>
  private readonly corners: T.InstancedBufferAttribute[]
  private readonly tint: T.InstancedBufferAttribute
  private readonly domain: T.InstancedBufferAttribute
  private readonly mode: T.InstancedBufferAttribute
  private readonly uploads:T.InstancedBufferAttribute[]
  private used = 0
  private lamps = 0
  private readonly right = new T.Vector3()
  private readonly up = new T.Vector3()
  private readonly aim = new T.Vector3()
  private readonly view = new T.Vector3()
  private readonly points = Array.from({ length: 4 }, () => new T.Vector3())
  private readonly heights = new Float64Array(4)
  private readonly alphas = new Float64Array(4)
  readonly stats = { lamps: 0, quads: 0, draws: 1, updateMs: 0 }

  constructor() {
    const base = new T.PlaneGeometry(1, 1)
    const g = new T.InstancedBufferGeometry().copy(base as unknown as T.InstancedBufferGeometry)
    base.dispose()
    const capacity = HEADLIGHT_CAPACITY * QUADS_PER_LAMP
    const buffer = (size: number) => new T.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(T.DynamicDrawUsage)
    this.corners = Array.from({ length: 4 }, (_, i) => { const a = buffer(3); g.setAttribute(`hlCorner${i}`, a); return a })
    this.tint = buffer(4); this.domain = buffer(4); this.mode = buffer(1)
    this.uploads=[...this.corners,this.tint,this.domain,this.mode]
    g.setAttribute('hlTint', this.tint); g.setAttribute('hlDomain', this.domain); g.setAttribute('hlMode', this.mode)
    g.instanceCount = 1
    const m = new T.MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false })
    m.forceSinglePass = true
    const p = uv(), domain = attribute('hlDomain', 'vec4'), tint = attribute('hlTint', 'vec4')
    m.positionNode = mix(mix(attribute('hlCorner0', 'vec3'), attribute('hlCorner1', 'vec3'), p.x), mix(attribute('hlCorner2', 'vec3'), attribute('hlCorner3', 'vec3'), p.x), p.y)
    const local = domain.xy.add(p.mul(domain.zw)), along = local.y
    const pool = float(1).sub(local.x.mul(2).sub(1).pow(2)).max(0).pow(2).mul(along.mul(Math.PI).sin().max(0).pow(1.5))
    const beam = float(1).sub(along).max(0).pow(2).mul(along.mul(12).min(1))
    m.opacityNode = tint.w.mul(attribute('hlMode', 'float').greaterThan(.5).select(pool, beam))
    // Additive fog must attenuate to black, not add another copy of the scene's fog colour.
    // Reuse the world's height/aerial extinction, including its planet-curve inverse.
    const density = uniform(0).setGroup(renderGroup).onRenderUpdate(() => Number(params.get('weather.fogDensity')?.value ?? 0))
    const fog = heightFog(vec3(0), density)
    m.colorNode = tint.xyz.mul(hotExposureNode()).mul(vec3(1).sub(fog.factor))
    applyCurve(m)
    this.mesh = new T.Mesh(g, m)
    this.mesh.name = 'Shared remote headlight beams and pools'
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3
  }

  begin(): void { this.used = 0; this.lamps = 0 }

  /** Inputs are flat world coordinates, before the common planet bend. No retained history. */
  add(origin: T.Vector3, direction: T.Vector3, color: T.Color, strength: number, camera: T.Vector3, terrain: Terrain): void {
    strength *= remoteBeamBrightness.value
    if (this.lamps >= HEADLIGHT_CAPACITY || !(strength > 0)) return
    this.lamps++
    const aim = this.aim.copy(direction).normalize()
    if (aim.lengthSq() < .5) return
    // Downward optical aim, without modifying a vehicle's orientation or physics.
    aim.y -= .045; aim.normalize()
    const right = this.right.crossVectors(aim, T.Object3D.DEFAULT_UP)
    if (right.lengthSq() < .001) right.set(1, 0, 0); else right.normalize()
    const up = this.up.crossVectors(right, aim).normalize()
    const view = this.view.copy(camera).sub(origin)
    const ahead = view.dot(aim), radial = Math.sqrt(Math.max(0, view.lengthSq() - ahead * ahead))
    const inside = ahead > 0 && ahead < HEADLIGHT_RANGE && radial < .12 + ahead * .15
    const sideView = 1 - Math.abs(view.normalize().dot(aim))
    const opacity = strength * (inside ? .012 : .025 + .055 * sideView)
    let range = HEADLIGHT_RANGE
    // Stop the central beam at terrain instead of drawing it through a ridge.
    for (let d = 1; d <= HEADLIGHT_RANGE; d += 1) {
      const x = origin.x + aim.x * d, z = origin.z + aim.z * d
      if (terrain.heightAt(x, z) > origin.y + aim.y * d + .15) { range = d; break }
    }
    for (let row = 0; row < SEGMENTS; row++) for (let face = 0; face < SIDES; face++) {
      for (let k = 0; k < 4; k++) {
        const t = (row + (k >= 2 ? 1 : 0)) / SEGMENTS, a = (face + k % 2) * Math.PI * 2 / SIDES
        const d = t * range, r = .06 + d * .15
        this.points[k].copy(origin).addScaledVector(aim, d).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r)
      }
      this.quad(color, opacity, 0, row / SEGMENTS, 1, 1 / SEGMENTS, 0)
    }
    const altitude = origin.y - terrain.heightAt(origin.x, origin.z)
    const airborne = poolVisibility(altitude, 0)
    if (airborne <= 0) return
    const horizontal = Math.hypot(aim.x, aim.z)
    if (horizontal < .3) return
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLUMNS; col++) {
      for (let k = 0; k < 4; k++) {
        const t = (row + (k >= 2 ? 1 : 0)) / ROWS, xUnit = (col + k % 2) / COLUMNS
        const d = .2 + t * range, width = .12 + d * .17
        const point = this.points[k].copy(origin).addScaledVector(aim, d).addScaledVector(right, (xUnit * 2 - 1) * width)
        const ground = terrain.heightAt(point.x, point.z)
        const water = terrain.liquidHeightAt?.(point.x, point.z) ?? -Infinity
        const beamY = origin.y + aim.y * d
        // Only illuminate ground inside the cone. Sampling all corners follows uneven terrain.
        this.alphas[k] = poolVisibility(altitude, water - ground) * clamp(1 - Math.abs(ground - beamY) / (.2 + d * .2), 0, 1)
        this.heights[k] = ground
        point.y = ground + .035
      }
      // A hard shoreline or cliff must not get a bright bridge between sampled corners.
      const visibility = Math.min(this.alphas[0],this.alphas[1],this.alphas[2],this.alphas[3])
      if (visibility <= 0 || Math.max(this.heights[0],this.heights[1],this.heights[2],this.heights[3]) - Math.min(this.heights[0],this.heights[1],this.heights[2],this.heights[3]) > 2) continue
      this.quad(color, strength * visibility * .26, col / COLUMNS, row / ROWS, 1 / COLUMNS, 1 / ROWS, 1)
    }
  }

  private quad(color: T.Color, alpha: number, u: number, v: number, du: number, dv: number, mode: number): void {
    const i = this.used++
    for (let k = 0; k < 4; k++) { const p = this.points[k]; this.corners[k].setXYZ(i, p.x, p.y, p.z) }
    // Preserve lamp chromaticity without multiplying six bright tank lenses into six suns.
    const scale = 1 / Math.max(1, color.r, color.g, color.b)
    this.tint.setXYZW(i, color.r * scale, color.g * scale, color.b * scale, alpha)
    this.domain.setXYZW(i, u, v, du, dv); this.mode.setX(i, mode)
  }

  end(): void {
    // Keep one degenerate transparent instance even by day/Minimal. It warms this exact
    // scene/post shader and preserves its pipeline when the first remote vehicle arrives.
    if (!this.used) {
      for (const a of this.corners) a.setXYZ(0, 0, 0, 0)
      this.tint.setXYZW(0, 0, 0, 0, 0); this.domain.setXYZW(0, 0, 0, 1, 1); this.mode.setX(0, 0)
    }
    const count = Math.max(1, this.used)
    for (const a of this.uploads) { a.clearUpdateRanges(); a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true }
    this.mesh.geometry.instanceCount = count
    this.stats.lamps = this.lamps; this.stats.quads = this.used
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}
