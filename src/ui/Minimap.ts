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
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Terrain map. White arrow is your vehicle. North is up.')
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
  private draw(): void {
    const ctx = this.canvas.getContext('2d')!; ctx.drawImage(this.base, 0, 0)
    const entities = this.self && !this.entities.some(entity => entity.self) ? [...this.entities, this.self] : this.entities
    for (const entity of entities) {
      if (![entity.x, entity.z, entity.heading].every(Number.isFinite)) continue
      const [x, z] = mapPoint(entity.x, entity.z, this.terrain.size, this.pixels)
      ctx.save(); ctx.translate(Math.max(4, Math.min(this.pixels - 4, x)), Math.max(4, Math.min(this.pixels - 4, z)))
      ctx.fillStyle = entity.self ? '#ffffff' : /^#[0-9a-f]{6}$/i.test(entity.color) ? entity.color : '#7abaff'
      ctx.strokeStyle = '#07101b'; ctx.lineWidth = 1.5; ctx.beginPath()
      if (entity.self) { ctx.rotate(-entity.heading); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath() }
      else ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke(); ctx.restore()
    }
  }
  dispose(): void { this.unsubscribe?.(); this.element.remove() }
}
