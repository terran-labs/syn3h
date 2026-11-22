/**
 * Gear impacts: what a Plasma Tag or Plasma Thunder shot looks like where it ends. The owner,
 * 18 November 2026: "the particle effects for your laser hits are frankly quite disappointing".
 * They were four soft growing puffs and a flat ring. Now, in layers (recipes.ts for the why):
 *
 *   flash   a hot bright core at the point, a tenth of a second, which the bloom pass spreads;
 *   sparks  streaks thrown out along the surface, white-hot cooling to the gear's colour,
 *           with drag and gravity, bouncing once off the surface (SparkBatch);
 *   light   a soft disc of the gear's light on the ground around it, fading (a stand-in for a
 *           real light, so no shader is rebuilt);
 *   debris  what the surface throws up: dust or clods or powder in the ground's own colour,
 *           steam from water, embers from lava;
 *   scorch  on solid ground, a mark that glows at its rim, cools dark and fades (ScorchMarks).
 *
 * Shots pass through water and lava and end on the bed (unchanged): the impact is drawn where
 * the shot crossed the surface instead (classifyImpact). Looks only: nothing here changes what
 * a shot does. Everything is generated; nothing is loaded.
 *
 * Cost: five draws in all, whatever is happening. The CPU works only when an impact is made
 * (a few dozen buffer writes); everything after that runs on the GPU. Pools are sized by the
 * quality level and rebuilt when it changes.
 */
import * as T from 'three/webgpu'
import type { Game } from '../../core/Game'
import { graphicsLevel, qualityBudget } from '../../core/quality'
import { warmGear } from '../warm'
import { ParticleBatch } from '../../vehicles/effects/ParticleBatch'
import { dustSprite } from '../../vehicles/effects/sprites'
import { flashSprite } from './flashSprite'
import { surfaceTone, type Tone } from '../../vehicles/effects/groundTone'
import type { SurfaceKind } from '../../world/terrain/surface'
import { ImpactPulses } from '../pulse'
import { classifyImpact, impactCounts, RECIPES, type ImpactSurface, type SurfaceSource } from './recipes'
import { impactFlash, impactLight, impactLightRadius, impactScorch, impactSparks, impactSparkSpeed } from './params'
import { SparkBatch, type SparkSpec } from './SparkBatch'
import { NEAR_HIT, nearLens } from './nearLens'
import { ScorchMarks, SCORCH_CAPACITY } from './ScorchMarks'

/** The terrain as the impacts read it. */
export interface ImpactTerrain extends SurfaceSource { lookIndex?(): number; heightAt?(x: number, z: number): number }

const TONES: Record<'dust' | 'clods' | 'powder', Tone> = {
  dust: { shade: 1.15, sat: 0.55, frost: 0 },
  clods: { shade: 0.5, sat: 0.8, frost: 0, earth: 0.65 },
  powder: { shade: 1.35, sat: 0.15, frost: 0.85 },
}
const STEAM = new T.Color(0.85, 0.88, 0.9)
/**
 * The height in metres the camera's view spans at `distance`: a size of `share * viewHeight` draws
 * `share` of the screen's height. For effects that must keep a size on screen however far off.
 */
export function viewHeight(camera: T.Camera, distance: number): number {
  const fov = (camera as T.PerspectiveCamera).fov ?? 60
  return 2 * distance * Math.tan(fov * Math.PI / 360)
}
const EMBER = new T.Color(3.2, 0.9, 0.12)

export class ImpactFx {
  private sparks!: SparkBatch
  private flash!: ParticleBatch
  private debris!: ParticleBatch
  private readonly light: ImpactPulses
  private readonly scorch = new ScorchMarks()
  private readonly unwarm: () => void
  private level = -1
  private clock = 0
  private serial = 0
  private readonly drawn = { x: 0, y: 0, z: 0 }
  private readonly at = new T.Vector3()
  private readonly n = new T.Vector3()
  private readonly a = new T.Vector3()
  private readonly b = new T.Vector3()
  private readonly v = new T.Vector3()
  private readonly right = new T.Vector3()
  private readonly c4 = new T.Color()
  private readonly up = new T.Vector3()
  private readonly color = new T.Color()
  private readonly spec: SparkSpec = { life: 0.6, width: 0.05, drag: 2.5, gravity: 1, streak: 0.03, normal: { x: 0, y: 1, z: 0 }, bounce: 0 }
  readonly stats = { impacts: 0, sparks: 0, debris: 0, scorches: 0, last: '' as ImpactSurface | '' }

  constructor(private readonly game: Game, private readonly terrain: () => ImpactTerrain | undefined) {
    this.light = new ImpactPulses(game, 'glow')
    game.scene.add(this.scorch.mesh)
    this.rebuild()
    // Prepared again for each new graphics level, by hand or automatic (warm.ts).
    this.unwarm = warmGear(game, [], undefined, () => [this.sparks.mesh, this.flash.mesh, this.debris.mesh, this.scorch.mesh])
  }

  /** Pools for the current quality level. Sparks and debris are a share of the particle budget. */
  private rebuild(): void {
    this.level = Number(graphicsLevel.value)
    const budget = qualityBudget().particles
    const sparkCount = Math.max(48, Math.floor(budget * 0.2))
    this.scorch.limit = this.level === 0 ? 0 : this.level === 1 ? 12 : SCORCH_CAPACITY
    if (this.sparks) this.sparks.resetCapacity(sparkCount)
    else {
      this.sparks = new SparkBatch(sparkCount, 'gear impact sparks')
      // Never thinner than about two and a half pixels: at the default (about one and a half) a
      // spark 20 m off was too faint to register from the chase camera.
      this.sparks.minWidth.value = 0.0065
      this.game.scene.add(this.sparks.mesh)
    }
    if (this.flash) {
      this.flash.resetCapacity(24)
      this.debris.resetCapacity(Math.max(24, Math.floor(budget * 0.05)), this.level === 0 ? 1 : 2)
      return
    }
    this.flash = new ParticleBatch(24, flashSprite, true, 1)
    this.debris = new ParticleBatch(Math.max(24, Math.floor(budget * 0.05)), dustSprite, false, this.level === 0 ? 1 : 2)
    this.game.scene.add(this.flash.mesh, this.debris.mesh)
  }

  private noise(): number {
    // A cheap, well-spread sequence (fractional golden ratio steps): no Math.random, no allocation.
    this.serial = (this.serial + 0.6180339887498949) % 1
    return this.serial
  }

  /**
   * An impact at `point`, the shot having travelled along unit `dir`, on a surface whose unit
   * normal is `normal`. `onVehicle` for a vehicle hit; `color` the gear's own colour (linear,
   * bright), `thunder` for Plasma Thunder's larger impact.
   */
  impact(point: T.Vector3, normal: T.Vector3, dir: T.Vector3, onVehicle: boolean, color: T.Color, thunder: boolean): ImpactSurface {
    const terrain = this.terrain()
    const surface = classifyImpact(point, dir, onVehicle, terrain, this.drawn)
    const recipe = RECIPES[surface]
    const at = this.at.set(this.drawn.x, this.drawn.y, this.drawn.z)
    // On a liquid the surface faces up, whatever the bed beneath it did.
    const n = this.n.copy(surface === 'water' || surface === 'lava' ? T.Object3D.DEFAULT_UP : normal).normalize()
    const counts = impactCounts(recipe, impactSparks.value, this.level, thunder)
    // Seen from the chase camera, 15 to 25 m off, an impact at its true size is a speck: the
    // flash and the light grow with distance from the camera (from 12 m, up to 2.5 times).
    const distance = this.game.camera.position.distanceTo(at)
    const far = Math.min(2.5, Math.max(1, distance / 12))
    // A hit on a vehicle is the one a player most needs to see, and it is often 15 to 40 m off,
    // where it was a few bright pixels by the roof. Its glint lasts longer and is brighter, and
    // its flash and glint keep a size on screen: shares of `view`, the height in metres the
    // screen spans at the hit (0 for a hit on the ground).
    const scale = (thunder ? 1.8 : 1) * far, view = onVehicle ? viewHeight(this.game.camera, distance) : 0
    this.stats.impacts++; this.stats.last = surface

    // Flash: one or two hot cores, briefly very bright; smaller and dimmer right by the camera
    // (a hit on your own car), where at full size it filled the view.
    const near = nearLens(distance, NEAR_HIT)
    if (impactFlash.value > 0) {
      this.color.copy(color).multiplyScalar(2).addScalar(2.5).multiplyScalar(near)
      // Lifted off the surface by a third of its size: through the ground, a camera-facing flash
      // was cut in half by it; lifted further, it floated free of the hit.
      const lifted = this.b.copy(at).addScaledVector(n, impactFlash.value * scale * 0.3)
      const core = Math.max(impactFlash.value * scale, view * 0.12) * near
      this.flash.emit(lifted, this.v.set(0, 0, 0), thunder ? 0.12 : 0.09, core, core * 3, this.color)
      if (thunder) this.flash.emit(lifted, this.v.set(0, 0, 0), 0.2, impactFlash.value * 2 * near, impactFlash.value * 4 * near, this.color.copy(color).multiplyScalar(0.9 * near))
      // After the flash, a faint glow of plasma in the gear's colour that fades over about 0.3 s:
      // something for the eye to follow once the core has gone.
      this.flash.emit(lifted, this.v.set(0, 0.4, 0), thunder ? 0.4 : 0.32, impactFlash.value * scale * 1.1 * near, impactFlash.value * scale * 1.2 * near, this.color.copy(color).multiplyScalar(0.35 * near))
      this.glint(lifted, scale * near, thunder, this.c4.copy(color).multiplyScalar(near), view * near)
    }

    // Sparks: a cone around the normal, two waves (the second slower and a touch later in life).
    const tangent = this.a.copy(Math.abs(n.y) < 0.9 ? T.Object3D.DEFAULT_UP : this.b.set(1, 0, 0)).cross(n).normalize()
    const bitangent = this.b.crossVectors(n, tangent)
    const s = this.spec
    s.normal.x = n.x; s.normal.y = n.y; s.normal.z = n.z; s.bounce = recipe.bounce
    const speed = impactSparkSpeed.value * recipe.speed * (thunder ? 1.35 : 1)
    for (let i = 0; i < counts.sparks; i++) {
      const second = i % 4 === 3, a = this.noise() * Math.PI * 2, spread = second ? 0.6 + this.noise() * 0.9 : 0.3 + this.noise() * 0.8
      const v = this.v.copy(n).multiplyScalar(0.6 + this.noise() * 0.8)
        .addScaledVector(tangent, Math.cos(a) * spread).addScaledVector(bitangent, Math.sin(a) * spread)
        .normalize().multiplyScalar(speed * (second ? 0.3 + this.noise() * 0.25 : 0.6 + this.noise() * 0.8))
      s.life = second ? 1.35 + this.noise() * 0.75 : 0.3 + this.noise() * 0.3; s.width = thunder ? 0.03 : 0.02
      s.drag = second ? 1.2 : 4.5; s.gravity = second ? 1.2 : 0.6; s.streak = second ? 0.035 : 0.06
      this.sparks.emit(at, v, s, this.color.copy(color))
    }
    this.stats.sparks += counts.sparks

    // Light on the ground around it.
    if (impactLight.value > 0) {
      this.color.copy(color).multiplyScalar(0.5 * impactLight.value)
      this.light.emit(at, n, { radius: impactLightRadius.value * (thunder ? 2.5 : 1) * Math.sqrt(far), seconds: thunder ? 0.45 : 0.25, color: this.color })
    }

    // What the surface throws up.
    if (recipe.debris && counts.debris > 0) this.throwDebris(recipe.debris, counts.debris, at, n, tangent, bitangent, surface, terrain, scale)
    this.stats.debris += counts.debris

    // A scorch on solid ground.
    if (recipe.scorch && impactScorch.value > 0) {
      this.color.copy(color).multiplyScalar(0.9)
      // The quad's width: the burn is its middle 0.42, about 0.5 m across for Tag and 1.2 m for Thunder; its streaks reach further.
      this.scorch.emit(at, n, (thunder ? 2.9 : 1.2) * (0.85 + this.noise() * 0.3), impactScorch.value * (thunder ? 1.5 : 1), this.color, 0.78, this.noise())
      this.stats.scorches++
    }
    return surface
  }

  /**
   * The muzzle flash where a shot leaves the vehicle, along unit `dir`: a hot core for a few
   * frames and a short cone of streaks thrown forward. The vehicle's own glow (Lasers.addGlow)
   * swells around it; this is the bright moment that says "that one fired". Same batches as an
   * impact, so no material of its own.
   */
  muzzle(at: T.Vector3, dir: T.Vector3, color: T.Color, thunder: boolean): void {
    const distance = this.game.camera.position.distanceTo(at)
    const size = Math.max(thunder ? 1.4 : 0.9, viewHeight(this.game.camera, distance) * 0.04)
    const lifted = this.b.copy(at).addScaledVector(dir, size * 0.3)
    this.flash.emit(lifted, this.v.set(0, 0, 0), thunder ? 0.09 : 0.06, size, size * 1.6, this.color.copy(color).multiplyScalar(1.5).addScalar(2))
    const s = this.spec
    s.normal.x = 0; s.normal.y = 1; s.normal.z = 0; s.bounce = -1
    s.drag = 9; s.gravity = 0; s.streak = 0.05
    const side = this.right.copy(Math.abs(dir.y) < 0.9 ? T.Object3D.DEFAULT_UP : this.up.set(1, 0, 0)).cross(dir).normalize()
    const up = this.up.crossVectors(dir, side)
    const count = this.level <= 0 ? 3 : thunder ? 9 : 6
    for (let i = 0; i < count; i++) {
      const a = this.noise() * Math.PI * 2, spread = 0.12 + this.noise() * 0.22
      const v = this.v.copy(dir).addScaledVector(side, Math.cos(a) * spread).addScaledVector(up, Math.sin(a) * spread).normalize()
        .multiplyScalar((thunder ? 34 : 26) * (0.6 + this.noise() * 0.6) * Math.max(1, size / 0.9))
      s.life = 0.1 + this.noise() * 0.08; s.width = (thunder ? 0.05 : 0.035) * Math.max(1, size / 0.9)
      this.sparks.emit(lifted, v, s, this.color.copy(color))
    }
  }

  /**
   * A glint: four white-hot rays thrown out across the screen from the flash, gone in a fifth of
   * a second. The flash alone is a round blob that sinks into a bright sky or your own headlight;
   * a star of thin lines reads as "something hit there" at a glance. Drawn by the spark batch
   * (no material of its own): rays with no gravity, heavy drag and a long streak.
   */
  private glint(at: T.Vector3, scale: number, thunder: boolean, color: T.Color, view = 0): void {
    // On a vehicle (`view` > 0, the screen's height in metres there): half as long again, wider,
    // and reaching at least a tenth of the screen's height out.
    const vehicle = view > 0
    const cam = this.game.camera, right = this.right.setFromMatrixColumn(cam.matrixWorld, 0), up = this.up.setFromMatrixColumn(cam.matrixWorld, 1)
    const s = this.spec
    s.normal.x = 0; s.normal.y = 1; s.normal.z = 0; s.bounce = -1
    s.life = (thunder ? 0.22 : 0.16) * (vehicle ? 1.6 : 1); s.width = (thunder ? 0.07 : 0.05) * scale * (vehicle ? 1.5 : 1); s.drag = 12; s.gravity = 0; s.streak = 0.09
    // A slight tilt off the screen's axes, different each time, so it never looks stamped.
    // A ray travels about speed / drag before it stops.
    const tilt = 0.35 + this.noise() * 0.3, speed = Math.max((thunder ? 20 : 15) * scale, view * 0.1 * 12)
    for (let k = 0; k < 4; k++) {
      const a = tilt + k * Math.PI / 2, long = k % 2 === 0 ? 1 : 0.7
      const v = this.v.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)).multiplyScalar(speed * long)
      this.sparks.emit(at, v, s, this.color.copy(color).multiplyScalar(vehicle ? 1.6 : 1))
    }
  }

  private throwDebris(kind: NonNullable<(typeof RECIPES)[ImpactSurface]['debris']>, count: number, at: T.Vector3, n: T.Vector3, tangent: T.Vector3, bitangent: T.Vector3, surface: ImpactSurface, terrain: ImpactTerrain | undefined, scale: number): void {
    if (kind === 'embers') {
      // Embers: slow, glowing, rising a little before they fall, no streak.
      const s = this.spec
      s.normal.x = n.x; s.normal.y = n.y; s.normal.z = n.z; s.bounce = -1
      for (let i = 0; i < count; i++) {
        const a = this.noise() * Math.PI * 2, r = 0.5 + this.noise() * 1.5
        const v = this.v.copy(n).multiplyScalar(2 + this.noise() * 3).addScaledVector(tangent, Math.cos(a) * r).addScaledVector(bitangent, Math.sin(a) * r)
        s.life = 1.2 + this.noise() * 1.2; s.width = 0.09; s.drag = 0.8; s.gravity = 0.25; s.streak = 0.02
        this.sparks.emit(at, v, s, EMBER)
      }
      return
    }
    if (kind === 'steam') this.color.copy(STEAM)
    else {
      const c = surfaceTone(terrain?.lookIndex?.() ?? 0, (surface as SurfaceKind), TONES[kind], 1)
      this.color.setRGB(c[0], c[1], c[2])
    }
    for (let i = 0; i < count; i++) {
      const a = this.noise() * Math.PI * 2, r = (kind === 'steam' ? 0.6 : 1.6) * (0.4 + this.noise())
      const v = this.v.copy(n).multiplyScalar(kind === 'steam' ? 1.2 + this.noise() * 1.5 : 1.5 + this.noise() * 2.5)
        .addScaledVector(tangent, Math.cos(a) * r).addScaledVector(bitangent, Math.sin(a) * r)
      const size = (kind === 'clods' ? 0.25 : 0.45) * scale * (0.7 + this.noise() * 0.6)
      this.debris.emit(at, v, kind === 'steam' ? 1.6 : 0.9 + this.noise() * 0.5, size, kind === 'steam' ? 1.6 : 0.9, this.color)
    }
  }

  update(dt: number): void {
    if (this.level !== Number(graphicsLevel.value)) this.rebuild()
    this.clock += Math.min(0.1, dt)
    this.sparks.flush()
    this.sparks.clock.value = this.clock; this.flash.clock.value = this.clock; this.debris.clock.value = this.clock; this.scorch.clock.value = this.clock
    this.light.update(dt)
  }

  /** Carry everything drawn across a world seam. */
  shift(dx: number, dz: number): void {
    this.sparks.shift(dx, dz); this.flash.shift(dx, dz); this.debris.shift(dx, dz); this.scorch.shift(dx, dz); this.light.shift(dx, dz)
  }

  reset(): void { this.light.reset() }

  dispose(): void {
    this.unwarm()
    this.sparks.dispose(); this.flash.dispose(); this.debris.dispose(); this.scorch.dispose(); this.light.dispose()
  }
}
