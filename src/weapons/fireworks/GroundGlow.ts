/**
 * The light a firework throws on the ground under it at night, without a light: a soft additive
 * disc made as a grid whose points take the terrain's height when the burst comes, so it lies on
 * hills and in hollows instead of being buried by them (a flat disc at one height shows only on
 * flat ground). A real light would cost every lit pixel of every frame, and the light set is part
 * of every lit material's shader key, for an effect that lasts a few seconds.
 *
 * A pool of SLOTS meshes, the oldest reused. Each is shaped once per burst on the CPU (a few
 * hundred height samples) and fades by a uniform; nothing is uploaded while it fades, and an idle
 * slot is hidden. Grid detail by graphics level.
 */
import * as T from 'three/webgpu'
import { float, max, uniform, uv } from 'three/tsl'
import type { Game } from '../../core/Game'
import { hotExposureNode } from '../../vehicles/skins/hotExposure'

type N = any // TSL's arithmetic nodes are dynamically typed.
const SLOTS = 3
/** Grid cells across, by graphics level (0 Minimal, 1 Low and Medium, 2 High and up). */
const CELLS = [8, 14, 22] as const
/** Metres above the ground the glow lies, with a polygon offset, so the terrain does not cut it. */
const LIFT = 0.6

interface Slot {
  mesh: T.Mesh<T.PlaneGeometry, T.MeshBasicNodeMaterial>
  fade: { value: number }
  tint: { value: T.Color }
  start: number
  seconds: number
}

export class GroundGlow {
  private slots: Slot[] = []
  private cursor = 0
  private clock = 0
  private level = -1

  constructor(private readonly game: Game) {}

  /** Make the pool for a graphics level (the owner calls it when the level changes). */
  build(level: number): void {
    if (level === this.level) return
    this.reset()
    this.level = level
    const cells = CELLS[Math.max(0, Math.min(2, level))]
    for (let i = 0; i < SLOTS; i++) {
      const geometry = new T.PlaneGeometry(2, 2, cells, cells)
      geometry.rotateX(-Math.PI / 2)
      const existing = this.slots[i]
      if (existing) {
        existing.mesh.geometry.dispose()
        existing.mesh.geometry = geometry
        continue
      }
      const fade = uniform(0), tint = uniform(new T.Color())
      const material = new T.MeshBasicNodeMaterial({ name: 'firework ground glow', transparent: true, depthWrite: false, blending: T.AdditiveBlending })
      const r: N = uv().mul(2).sub(1).length()
      const shape: N = max(float(0), float(1).sub(r)).pow(2.2)
      material.colorNode = (tint as N).mul(shape).mul(fade).mul(hotExposureNode())
      material.opacityNode = shape.mul(fade)
      material.fog = false
      material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2
      const mesh = new T.Mesh(geometry, material)
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 3
      this.game.scene.add(mesh)
      this.slots.push({ mesh, fade, tint, start: -Infinity, seconds: 1 })
    }
  }

  /**
   * A glow of `radius` metres centred on (x, z), lying on the ground `heightAt` gives (or flat at
   * `ground` without one), in `color`, fading over `seconds` from `delay` seconds from now.
   */
  emit(x: number, z: number, ground: number, radius: number, color: T.Color, seconds: number, delay: number, heightAt?: (x: number, z: number) => number): void {
    const slot = this.slots[this.cursor]
    if (!slot) return
    this.cursor = (this.cursor + 1) % this.slots.length
    const position = slot.mesh.geometry.getAttribute('position') as T.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      // The grid's own corners are -1..1; place each point on the terrain under it.
      const gx = this.unit(slot, i, 0), gz = this.unit(slot, i, 2)
      const wx = x + gx * radius, wz = z + gz * radius
      const h = heightAt ? heightAt(wx, wz) : ground
      position.setXYZ(i, wx, (Number.isFinite(h) ? h : ground) + LIFT, wz)
    }
    position.needsUpdate = true
    slot.tint.value.copy(color)
    slot.start = this.clock + delay; slot.seconds = seconds
    slot.fade.value = 0; slot.mesh.visible = false
  }

  /** The grid's unit coordinate (-1..1) of point `i` on axis `axis`, from its row and column. */
  private unit(slot: Slot, i: number, axis: 0 | 2): number {
    const n = (slot.mesh.geometry.parameters.widthSegments) + 1
    const col = i % n, row = Math.floor(i / n)
    return axis === 0 ? col / (n - 1) * 2 - 1 : row / (n - 1) * 2 - 1
  }

  update(dt: number): void {
    this.clock += Math.min(0.1, dt)
    for (const s of this.slots) {
      const t = (this.clock - s.start) / s.seconds
      const on = t >= 0 && t < 1
      s.mesh.visible = on
      s.fade.value = on ? (1 - t) ** 1.6 : 0
    }
  }

  /** Move every glow by (dx, dz), for a world seam. */
  shift(dx: number, dz: number): void {
    for (const s of this.slots) {
      const p = s.mesh.geometry.getAttribute('position') as T.BufferAttribute
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + dx, p.getY(i), p.getZ(i) + dz)
      p.needsUpdate = true
    }
  }

  reset(): void { for (const s of this.slots) { s.start = -Infinity; s.fade.value = 0; s.mesh.visible = false } }

  /** Every slot's mesh, hidden until a burst: drawn under the world entry's cover (Game.precompile). */
  *precompileMeshes(): Iterable<T.Mesh> { for (const s of this.slots) yield s.mesh }

  dispose(): void {
    for (const s of this.slots) { s.mesh.removeFromParent(); s.mesh.geometry.dispose(); s.mesh.material.dispose() }
    this.slots = []; this.level = -1
  }
}
