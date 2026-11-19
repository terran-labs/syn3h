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
import { ParticleBatch } from '../../vehicles/effects/ParticleBatch'
import { dustSprite, glowSprite } from '../../vehicles/effects/sprites'
import { surfaceTone, type Tone } from '../../vehicles/effects/groundTone'
import type { SurfaceKind } from '../../world/terrain/surface'
import { ImpactPulses } from '../pulse'
import { classifyImpact, impactCounts, RECIPES, type ImpactSurface, type SurfaceSource } from './recipes'
import { impactFlash, impactLight, impactLightRadius, impactScorch, impactSparks, impactSparkSpeed } from './params'
import { SparkBatch, type SparkSpec } from './SparkBatch'
import { ScorchMarks, SCORCH_CAPACITY } from './ScorchMarks'

/** The terrain as the impacts read it. */
export interface ImpactTerrain extends SurfaceSource { lookIndex?(): number; heightAt?(x: number, z: number): number }

const TONES: Record<'dust' | 'clods' | 'powder', Tone> = {
  dust: { shade: 1.15, sat: 0.55, frost: 0 },
  clods: { shade: 0.5, sat: 0.8, frost: 0, earth: 0.65 },
  powder: { shade: 1.35, sat: 0.15, frost: 0.85 },
}
const STEAM = new T.Color(0.85, 0.88, 0.9)
const EMBER = new T.Color(3.2, 0.9, 0.12)

export class ImpactFx {
  private sparks!: SparkBatch
  private flash!: ParticleBatch
  private debris!: ParticleBatch
  private readonly light: ImpactPulses
  private readonly scorch = new ScorchMarks()
  private level = -1
  private clock = 0
  private serial = 0
  private readonly drawn = { x: 0, y: 0, z: 0 }
  private readonly at = new T.Vector3()
  private readonly n = new T.Vector3()
  private readonly a = new T.Vector3()
  private readonly b = new T.Vector3()
  private readonly v = new T.Vector3()
  private readonly color = new T.Color()
  private readonly spec: SparkSpec = { life: 0.6, width: 0.05, drag: 2.5, gravity: 1, streak: 0.03, normal: { x: 0, y: 1, z: 0 }, bounce: 0 }
  readonly stats = { impacts: 0, sparks: 0, debris: 0, scorches: 0, last: '' as ImpactSurface | '' }

  constructor(private readonly game: Game, private readonly terrain: () => ImpactTerrain | undefined) {
    this.light = new ImpactPulses(game, 'glow')
    game.scene.add(this.scorch.mesh)
    this.rebuild()
  }

  /** Pools for the current quality level. Sparks and debris are a share of the particle budget. */
  private rebuild(): void {
    this.level = Number(graphicsLevel.value)
    this.sparks?.dispose(); this.flash?.dispose(); this.debris?.dispose()
    const budget = qualityBudget().particles
    this.sparks = new SparkBatch(Math.max(48, Math.floor(budget * 0.12)), 'gear impact sparks')
    this.flash = new ParticleBatch(24, glowSprite, true, this.level === 0 ? 1 : 2)
    this.debris = new ParticleBatch(Math.max(24, Math.floor(budget * 0.05)), dustSprite, false, this.level === 0 ? 1 : 2)
    this.scorch.limit = this.level === 0 ? 0 : this.level === 1 ? 12 : SCORCH_CAPACITY
    this.game.scene.add(this.sparks.mesh, this.flash.mesh, this.debris.mesh)
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
    const scale = thunder ? 1.8 : 1
    this.stats.impacts++; this.stats.last = surface

    // Flash: one or two hot cores, briefly very bright.
    if (impactFlash.value > 0) {
      this.color.copy(color).multiplyScalar(1.4).addScalar(1.2)
      this.flash.emit(at, this.v.set(0, 0, 0), thunder ? 0.16 : 0.1, impactFlash.value * scale, impactFlash.value * scale * 2, this.color)
      if (thunder) this.flash.emit(at, this.v.set(0, 0, 0), 0.32, impactFlash.value * 2.4, impactFlash.value * 3, this.color.copy(color).multiplyScalar(0.8))
    }

    // Sparks: a cone around the normal, two waves (the second slower and a touch later in life).
    const tangent = this.a.copy(Math.abs(n.y) < 0.9 ? T.Object3D.DEFAULT_UP : this.b.set(1, 0, 0)).cross(n).normalize()
    const bitangent = this.b.crossVectors(n, tangent)
    const s = this.spec
    s.normal.x = n.x; s.normal.y = n.y; s.normal.z = n.z; s.bounce = recipe.bounce
    const speed = impactSparkSpeed.value * recipe.speed * (thunder ? 1.35 : 1)
    for (let i = 0; i < counts.sparks; i++) {
      const second = i % 3 === 2, a = this.noise() * Math.PI * 2, spread = 0.35 + this.noise() * 0.9
      const v = this.v.copy(n).multiplyScalar(0.6 + this.noise() * 0.8)
        .addScaledVector(tangent, Math.cos(a) * spread).addScaledVector(bitangent, Math.sin(a) * spread)
        .normalize().multiplyScalar(speed * (second ? 0.45 : 0.7 + this.noise() * 0.6))
      s.life = (second ? 0.9 : 0.45) + this.noise() * 0.35; s.width = (thunder ? 0.08 : 0.05) * (second ? 0.8 : 1)
      s.drag = second ? 1.6 : 2.6; s.gravity = 1; s.streak = second ? 0.05 : 0.03
      this.sparks.emit(at, v, s, this.color.copy(color))
    }
    this.stats.sparks += counts.sparks

    // Light on the ground around it.
    if (impactLight.value > 0) {
      this.color.copy(color).multiplyScalar(0.5 * impactLight.value)
      this.light.emit(at, n, { radius: impactLightRadius.value * (thunder ? 3 : 1), seconds: thunder ? 0.7 : 0.35, color: this.color })
    }

    // What the surface throws up.
    if (recipe.debris && counts.debris > 0) this.throwDebris(recipe.debris, counts.debris, at, n, tangent, bitangent, surface, terrain, scale)
    this.stats.debris += counts.debris

    // A scorch on solid ground.
    if (recipe.scorch && impactScorch.value > 0) {
      this.color.copy(color).multiplyScalar(0.45)
      this.scorch.emit(at, n, (thunder ? 3.2 : 1.3) * (0.85 + this.noise() * 0.3), impactScorch.value * (thunder ? 1.5 : 1), this.color, thunder ? 0.7 : 0.55, this.noise())
      this.stats.scorches++
    }
    return surface
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
    this.sparks.clock.value = this.clock; this.flash.clock.value = this.clock; this.debris.clock.value = this.clock; this.scorch.clock.value = this.clock
    this.light.update(dt)
  }

  /** Carry everything drawn across a world seam. */
  shift(dx: number, dz: number): void {
    this.sparks.shift(dx, dz); this.flash.shift(dx, dz); this.debris.shift(dx, dz); this.scorch.shift(dx, dz); this.light.shift(dx, dz)
  }

  reset(): void { this.light.reset() }

  dispose(): void {
    this.sparks.dispose(); this.flash.dispose(); this.debris.dispose(); this.scorch.dispose(); this.light.dispose()
  }
}
