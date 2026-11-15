/** Amber light rising around a carried vehicle, computed from cylinder coordinates. */
import * as THREE from 'three/webgpu'
import { color, float, max, sin, smoothstep, uniform, uv } from 'three/tsl'
import type { Game } from '../../core/Game'
import { graphicsLevel, levelNumber } from '../../core/quality'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'
import { warmGear } from '../warm'

type N = any
export interface LiftFieldOptions { radius: number; height: number; seed: number }
export const liftFieldOptions: LiftFieldOptions = { radius: 3.2, height: 3.8, seed: 17 }

export class LiftFieldLook {
  readonly geometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true)
  readonly material = new THREE.MeshBasicNodeMaterial({ name: 'gear yoink lift field', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
  private readonly clock: N = uniform(0)
  private readonly detail: N = uniform(1)
  private readonly unwarm: () => void

  constructor(game: Game, readonly options = liftFieldOptions) {
    const p: N = uv(), y = p.y
    const edges = smoothstep(0, 0.12, y).mul(float(1).sub(smoothstep(0.8, 1, y)))
    // Three soft bands rise toward the lifted vehicle. The level-zero field uses only these.
    const phase = y.mul(3).sub(this.clock.mul(0.65)).fract()
    const band = max(float(0), float(1).sub(phase.sub(0.5).abs().mul(10))).pow(2)
    // Glints spiral up the field. A fixed seed offsets the pattern without a bitmap or noise table.
    const x = p.x.mul(18).add(y.mul(5)).add(options.seed).fract().sub(0.5).abs()
    const dots = max(float(0), float(1).sub(x.mul(10))).pow(3).mul(max(float(0), float(1).sub(phase.sub(0.5).abs().mul(7))).pow(3))
    const breath = sin(this.clock.mul(2)).mul(0.08).add(0.92)
    const shape = band.mul(0.25).add(dots.mul(this.detail).mul(1.6)).mul(edges).mul(breath)
    const tint: N = color(new THREE.Color(2.5, 1.25, 0.16))
    this.material.colorNode = tint.mul(shape).mul(hotExposureNode())
    this.material.opacityNode = shape.mul(0.3).clamp(0, 0.6)
    this.material.blending = THREE.CustomBlending
    this.material.blendSrc = THREE.OneFactor
    this.material.blendDst = THREE.OneMinusSrcAlphaFactor
    this.material.blendSrcAlpha = THREE.OneFactor
    this.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
    this.unwarm = warmGear(game, [[this.geometry, this.material]])
  }

  create(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.scale.set(this.options.radius, this.options.height, this.options.radius)
    mesh.visible = false
    return mesh
  }

  update(time: number): void {
    this.clock.value = time
    this.detail.value = levelNumber(graphicsLevel.value) === 0 ? 0 : 1
  }

  dispose(): void { this.unwarm(); this.geometry.dispose(); this.material.dispose() }
}
