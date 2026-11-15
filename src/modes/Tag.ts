/**
 * Tag display: a marker floating over whoever is "it", and the original's bounds reset for
 * the local vehicle (VehicleMe.js 70-77). The rules themselves run on the room server.
 */
import * as THREE from 'three/webgpu'
import type { Game, System } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'

export class TagMarker implements System {
  /** The vehicle that is "it", or null. */
  target: Vehicle | null = null
  /**
   * The local vehicle. Its own marker is hidden: from the chase camera a point above your own
   * car lands on whoever is ahead of you, which reads as them being "it". The HUD says it instead.
   */
  local: Vehicle | null = null
  private readonly marker = new THREE.Group()
  private t = 0

  constructor(private readonly game: Game) {
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.15) })
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), glow)
    gem.scale.set(1, 1.6, 1)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.08, 6, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2, 0.3), transparent: true, opacity: 0.8 }),
    )
    ring.rotation.x = Math.PI / 2
    // A thin beam down to the vehicle makes "it" findable across the map.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 30, 4, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.5, 0.2), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    beam.position.y = 15
    this.marker.add(gem, ring, beam)
    this.marker.visible = false
    game.scene.add(this.marker)
  }

  update(dt: number): void {
    this.t += dt
    const v = this.target
    this.marker.visible = Boolean(v) && v !== this.local
    if (!v) return
    this.marker.position.copy(v.object.position)
    this.marker.position.y += 3.2 + Math.sin(this.t * 3) * 0.25
    this.marker.rotation.y = this.t * 2
  }

  dispose(): void {
    this.game.scene.remove(this.marker)
  }
}

/** Puts the local vehicle back if it falls off the world, and tames runaway speed. */
export class BoundsGuard implements System {
  /** Spawn slot to return to. */
  slot = 0
  onReset: () => void = () => {}

  constructor(private player: Vehicle, private readonly terrain: Terrain) {}

  /** The local player changed vehicle in place. */
  setPlayer(next: Vehicle): void { this.player = next }

  postPhysics(): void {
    const b = this.player.body
    const p = b.translation()
    const half = this.terrain.size / 2 + 200
    // A wrapping world has no edge to leave by: only falling through it counts.
    const outside = !this.terrain.wrapSize && (Math.abs(p.x) > half * 4 || Math.abs(p.z) > half * 4)
    if (p.y < -300 || outside || !Number.isFinite(p.y)) {
      const s = this.terrain.spawnPoint(this.slot)
      this.player.teleport(s.position, s.heading)
      this.onReset()
      return
    }
    const v = b.linvel()
    if (Math.hypot(v.x, v.y, v.z) > 500) b.setLinvel({ x: v.x * 0.5, y: v.y * 0.5, z: v.z * 0.5 }, true)
  }
}
