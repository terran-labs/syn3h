import { wrapDelta } from '../../shared/wrap'
import type { Terrain } from '../world/Terrain'
export interface MapEntity { x: number; z: number; heading: number; color: string; self?: boolean }
export function mapPoint(x: number, z: number, size: number, pixels: number): [number, number] {
  return [(x / size + .5) * pixels, (z / size + .5) * pixels]
}
/** Sample once per terrain revision. Rendering markers never resamples the world. */
export function heightPixels(terrain: Pick<Terrain, 'size' | 'heightAt'>, pixels: number): Uint8ClampedArray {
  const heights = new Float32Array(pixels * pixels)
  let min = Infinity, max = -Infinity
  for (let z = 0; z < pixels; z++) for (let x = 0; x < pixels; x++) {
    const value = terrain.heightAt(((x + .5) / pixels - .5) * terrain.size, ((z + .5) / pixels - .5) * terrain.size)
    const height = Number.isFinite(value) ? value : 0
    heights[z * pixels + x] = height; min = Math.min(min, height); max = Math.max(max, height)
  }
  const out = new Uint8ClampedArray(pixels * pixels * 4), span = Math.max(1, max - min), step = terrain.size / pixels
  for (let z = 0; z < pixels; z++) for (let x = 0; x < pixels; x++) {
    const i = z * pixels + x, height = (heights[i] - min) / span
    const dx = heights[z * pixels + Math.min(pixels - 1, x + 1)] - heights[z * pixels + Math.max(0, x - 1)]
    const dz = heights[Math.min(pixels - 1, z + 1) * pixels + x] - heights[Math.max(0, z - 1) * pixels + x]
    const shade = Math.max(.4, Math.min(1.3, .85 + (dx + dz) / (step * 6)))
    out[i * 4] = (65 + height * 125) * shade; out[i * 4 + 1] = (50 + height * 95) * shade; out[i * 4 + 2] = (44 + height * 75) * shade; out[i * 4 + 3] = 255
  }
  return out
}
export class Minimap {
  readonly element = document.createElement('aside')
  private readonly canvas = document.createElement('canvas')
  private readonly base = document.createElement('canvas')
  private readonly pixels = 160
  private readonly unsubscribe?: () => void
  private entities: readonly MapEntity[] = []
  private self?: MapEntity
  private lastDraw = 0
  constructor(private readonly terrain: Terrain, parent: HTMLElement) {
    this.element.className = 'shell-minimap'; this.canvas.width = this.canvas.height = this.base.width = this.base.height = this.pixels
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Terrain map, centred on your vehicle. White arrow is you. North is up.')
    const north = document.createElement('span'); north.textContent = 'N'; this.element.append(this.canvas, north); parent.append(this.element)
    this.regenerate(); this.unsubscribe = terrain.onRegenerate?.(() => this.regenerate())
  }
  private regenerate(): void {
    const ctx = this.base.getContext('2d')!, data = ctx.createImageData(this.pixels, this.pixels)
    data.data.set(heightPixels(this.terrain, this.pixels)); ctx.putImageData(data, 0, 0)
    this.element.dataset.revision = String(Number(this.element.dataset.revision || 0) + 1)
    this.draw()
  }
  setEntities(entities: readonly MapEntity[]): void { this.entities = entities.map(entity => ({ ...entity })) }
  setSelf(entity: MapEntity): void { this.self = entity }
  update(): void { const now = performance.now(); if (now - this.lastDraw > 100) { this.lastDraw = now; this.draw() } }
  /**
   * The world wraps, so the map does too: the player is always at the centre, north is up,
   * and the terrain scrolls under them, repeating at the edges. Everything else is drawn at
   * its nearest image, so a friend just across the seam shows beside you, not a world away.
   */
  private draw(): void {
    const ctx = this.canvas.getContext('2d')!, n = this.pixels, size = this.terrain.size
    const me = this.self ?? this.entities.find(entity => entity.self)
    const cx = me && Number.isFinite(me.x) ? me.x : 0, cz = me && Number.isFinite(me.z) ? me.z : 0
    // Where the tile's top left corner lands so that (cx, cz) is at the centre, wrapped into
    // (-n, 0], then the tile is tiled four times to fill the square.
    const [px, pz] = mapPoint(cx, cz, size, n)
    const ox = -((((px - n / 2) % n) + n) % n), oz = -((((pz - n / 2) % n) + n) % n)
    for (const dz of [0, n]) for (const dx of [0, n]) ctx.drawImage(this.base, Math.round(ox) + dx, Math.round(oz) + dz)
    const entities = this.self && !this.entities.some(entity => entity.self) ? [...this.entities, this.self] : this.entities
    for (const entity of entities) {
      if (![entity.x, entity.z, entity.heading].every(Number.isFinite)) continue
      const x = n / 2 + wrapDelta(cx, entity.x, size) / size * n, z = n / 2 + wrapDelta(cz, entity.z, size) / size * n
      ctx.save(); ctx.translate(x, z)
      ctx.fillStyle = entity.self ? '#ffffff' : /^#[0-9a-f]{6}$/i.test(entity.color) ? entity.color : '#7abaff'
      ctx.strokeStyle = '#07101b'; ctx.lineWidth = 1.5; ctx.beginPath()
      if (entity.self) { ctx.rotate(-entity.heading); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath() }
      else ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke(); ctx.restore()
    }
  }
  dispose(): void { this.unsubscribe?.(); this.element.remove() }
}
