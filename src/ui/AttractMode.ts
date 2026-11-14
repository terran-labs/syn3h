import { Vector3 } from 'three/webgpu'
import type { Terrain } from '../world/Terrain'
import type { Vehicle } from '../vehicles/Vehicle'
import { loadingMessages } from './data/loadingMessages'
export interface CinematicCamera {
  setCinematicPose(position: Vector3, target: Vector3): void
  clearCinematicPose(): void
}
export class AttractMode {
  readonly element = document.createElement('div')
  active = false
  private time = 0
  private camera?: CinematicCamera
  private bots: () => readonly Vehicle[] = () => []
  private readonly position = new Vector3()
  private readonly target = new Vector3()
  constructor(private readonly terrain: Terrain, private readonly parent: HTMLElement) {
    this.element.className = 'attract-overlay'; this.element.hidden = true
    this.element.innerHTML = '<img src="/brand/syn3h.png" alt="Syn3h"><div><p></p><small>Press any key or touch to explore</small></div>'
    parent.append(this.element)
  }
  get ready(): boolean { return Boolean(this.camera) }
  setCamera(camera: CinematicCamera, bots: () => readonly Vehicle[]): void { this.camera = camera; this.bots = bots }
  start(): void { if (!this.ready) return; this.time = 0; this.active = true; this.element.hidden = false; this.parent.classList.add('is-attract'); this.update(0) }
  stop(): void { if (!this.active) return; this.active = false; this.camera?.clearCinematicPose(); this.element.hidden = true; this.parent.classList.remove('is-attract') }
  update(dt: number): void {
    if (!this.active) return
    this.time += Math.min(.1, Math.max(0, dt))
    const summit = this.terrain.summit?.(), segment = Math.floor(this.time / 18) % 3
    const roads = this.terrain.roadPaths?.() ?? [], road = roads.find(path => path.kind === 'volcano') ?? roads[0]
    const bot = this.bots()[0]
    if (segment === 2 && bot) {
      this.target.copy(bot.object.position).add(new Vector3(0, 2, 0))
      this.position.set(16, 9, 22).applyQuaternion(bot.object.quaternion).add(bot.object.position)
      this.element.dataset.shot = 'bot'
    } else if (segment === 1 && road && road.points.length > 2) {
      const step = (this.time % 18) * 1.5, index = Math.min(road.points.length - 2, Math.floor(step)), mix = step - Math.floor(step)
      this.target.copy(road.points[Math.min(road.points.length - 1, index + 8)]).add(new Vector3(0, 3, 0))
      this.position.copy(road.points[index]).lerp(road.points[index + 1], mix).add(new Vector3(10, 12, 0))
      this.element.dataset.shot = 'road'
    } else {
      const x = summit?.x ?? 0, z = summit?.z ?? 0, y = summit?.rimHeight ?? this.terrain.heightAt(x, z)
      const radius = Math.max(100, (summit?.rimRadius ?? this.terrain.size * .12) * 2.2), angle = this.time * .045
      this.target.set(x, y, z); this.position.set(x + Math.cos(angle) * radius, y + radius * .5, z + Math.sin(angle) * radius)
      this.element.dataset.shot = 'volcano'
    }
    this.position.y = Math.max(this.position.y, this.terrain.heightAt(this.position.x, this.position.z) + 8)
    this.camera?.setCinematicPose(this.position, this.target)
    this.element.querySelector('p')!.textContent = loadingMessages[Math.floor(this.time / 5) % loadingMessages.length]
  }
  dispose(): void { this.stop(); this.element.remove() }
}
