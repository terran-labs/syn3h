/**
 * The hill, drawn as two walls of light along the zone's inner and outer edges, fading
 * upward. Unlit, unfogged, two draw calls: visible from across the map for almost nothing.
 * Tinted by state so you can tell from far away whether to go. Plain basic materials with
 * uniform opacity, in stacked bands: an additive TSL version, and versions with an alpha map,
 * vertex alpha, or fog and tone mapping switched off, all came out invisible or white in this
 * renderer setup. Uniform opacity is what reliably draws.
 */
import * as THREE from 'three/webgpu'
import type { HillZone } from '../../shared/protocol'
import type { Game, System } from '../core/Game'

export type HillTint = 'free' | 'mine' | 'theirs' | 'contested'

const TINTS: Record<HillTint, THREE.Color> = {
  free: new THREE.Color(1.0, 0.72, 0.08),
  mine: new THREE.Color(0.1, 1.0, 0.25),
  theirs: new THREE.Color(1.0, 0.12, 0.05),
  contested: new THREE.Color(0.75, 0.15, 1.0),
}
const HEIGHT = 70

/** Stacked bands of falling opacity stand in for a smooth fade upward: [bottom, top, alpha]. */
const BANDS: [number, number, number][] = [[0, 25, 0.8], [25, 50, 0.6], [50, HEIGHT, 0.35]]
/** Walls vanish as the camera comes within this range of them (start, fully gone). */
const FADE_FAR = 55
const FADE_NEAR = 15
/** Ground posts along both edges: spacing in metres, height, and a cap on how many. */
const POST_SPACING = 14
const POST_HEIGHT = 7
const MAX_POSTS = 120

/** What the marker needs from the terrain: ground height for the posts. */
export interface HillGround {
  heightAt(x: number, z: number): number
}

export class HillMarker implements System {
  tint: HillTint = 'free'
  private readonly group = new THREE.Group()
  /** Per wall (inner, outer), one material per band, so each wall fades on its own. */
  private readonly wallMaterials: THREE.MeshBasicMaterial[][] = []
  private readonly walls: THREE.Group[] = []
  private readonly postMaterial: THREE.MeshBasicMaterial
  private readonly posts: THREE.InstancedMesh
  private readonly cam = new THREE.Vector3()
  private time = 0
  private zone: HillZone | null = null
  private zoneKey = ''

  constructor(private readonly game: Game, private readonly ground: HillGround) {
    for (let w = 0; w < 2; w++) {
      const wall = new THREE.Group()
      const mats = BANDS.map(([, , alpha]) => new THREE.MeshBasicMaterial({
        color: TINTS.free.clone(), transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide,
      }))
      BANDS.forEach(([lo, hi], i) => {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, hi - lo, 96, 1, true), mats[i])
        band.position.y = (lo + hi) / 2
        band.frustumCulled = false
        band.renderOrder = 10 + i
        wall.add(band)
      })
      this.wallMaterials.push(mats)
      this.walls.push(wall)
      this.group.add(wall)
    }
    // Posts live in world space (each stands on the ground), not in the wall group.
    this.postMaterial = new THREE.MeshBasicMaterial({ color: TINTS.free.clone(), transparent: true, opacity: 0.9 })
    const postGeo = new THREE.CylinderGeometry(0.18, 0.18, POST_HEIGHT, 6, 1).translate(0, POST_HEIGHT / 2, 0)
    this.posts = new THREE.InstancedMesh(postGeo, this.postMaterial, MAX_POSTS)
    this.posts.frustumCulled = false
    this.posts.count = 0
    this.group.visible = false
    this.posts.visible = false
    game.scene.add(this.group, this.posts)
  }

  setZone(zone: HillZone | null): void {
    this.zone = zone
    this.group.visible = Boolean(zone)
    this.posts.visible = Boolean(zone)
    if (!zone) return
    const key = JSON.stringify(zone)
    if (key === this.zoneKey) return
    this.zoneKey = key
    this.group.position.set(zone.x, zone.yMin, zone.z)
    const [inner, outer] = this.walls
    // A disc zone has no inner wall.
    inner.visible = zone.inner > 1
    inner.scale.set(Math.max(zone.inner, 0.01), 1, Math.max(zone.inner, 0.01))
    outer.scale.set(zone.outer, 1, zone.outer)
    this.placePosts(zone)
  }

  get visible(): boolean {
    return this.group.visible
  }

  update(dt: number): void {
    const zone = this.zone
    if (!zone) return
    this.time += dt
    // Ease between tints so a capture reads as a change, not a flicker; breathe gently.
    const k = Math.min(1, dt * 4)
    const breathe = 0.88 + Math.sin(this.time * 2.2) * 0.12
    this.game.camera.getWorldPosition(this.cam)
    const d = Math.hypot(this.cam.x - zone.x, this.cam.z - zone.z)
    const radii = [zone.inner, zone.outer]
    this.wallMaterials.forEach((mats, w) => {
      // A landmark from afar; out of the way up close, where the posts mark the edge instead.
      const near = Math.abs(d - radii[w])
      const fade = smooth((near - FADE_NEAR) / (FADE_FAR - FADE_NEAR))
      this.walls[w].visible = fade > 0.01 && (w === 1 || zone.inner > 1)
      mats.forEach((m, i) => {
        m.color.lerp(TINTS[this.tint], k)
        m.opacity = BANDS[i][2] * breathe * fade
      })
    })
    this.postMaterial.color.lerp(TINTS[this.tint], k)
  }

  dispose(): void {
    this.game.scene.remove(this.group, this.posts)
  }

  private placePosts(zone: HillZone): void {
    const m = new THREE.Matrix4()
    let n = 0
    const rings = zone.inner > 1 ? [zone.inner, zone.outer] : [zone.outer]
    for (const r of rings) {
      const count = Math.min(Math.floor(MAX_POSTS / rings.length), Math.max(8, Math.round((2 * Math.PI * r) / POST_SPACING)))
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        const x = zone.x + Math.cos(a) * r
        const z = zone.z + Math.sin(a) * r
        m.makeTranslation(x, this.ground.heightAt(x, z) - 0.5, z)
        this.posts.setMatrixAt(n++, m)
      }
    }
    this.posts.count = n
    this.posts.instanceMatrix.needsUpdate = true
  }
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}
