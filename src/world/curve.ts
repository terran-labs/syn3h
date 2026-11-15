/**
 * Curved horizon: makes the flat world look like a small round planet.
 *
 * Physics stays flat. In rendering only, every vertex is lowered by its horizontal distance
 * d from the camera: y -= d * d / (2 * R), where R is the planet radius. Every material in
 * the scene must take the same bend or its objects float or sink against the ground, so the
 * bend is one call per material: `applyCurve(material)`.
 *
 * This file is the interface other lanes build against. Until the bend itself lands,
 * `applyCurve` and `updateCurve` do nothing and `world.curve` stays at 0 (flat), so calling
 * them is always safe.
 */
import type * as THREE from 'three/webgpu'
import { defineParam } from '../../shared/params'

/** 0 is flat. 1 is a planet whose circumference is the world tile: a Little Prince ball. */
export const worldCurve = defineParam({
  id: 'world.curve', label: 'Planet curve', group: 'World', scope: 'world', default: 0, min: 0, max: 1, step: 0.01,
})

/**
 * Planet radius in metres for a tile of `size` metres and a curve setting. 0 gives
 * Infinity (flat); 1 gives size / (2 pi); between, the radius falls smoothly, so 0.3 is a
 * gentle planet about ten times that radius.
 */
export function curveRadius(size: number, curve: number): number {
  if (!(curve > 0)) return Infinity
  const c = curve > 1 ? 1 : curve
  // 1 / c^(1.9): 0.3 gives about 9.9 times the tightest radius, 1 gives exactly 1.
  return (size / (2 * Math.PI)) / Math.pow(c, 1.9)
}

/** Give a material the bend. Safe on any node material; call once when the material is made. */
export function applyCurve<T extends THREE.Material>(material: T): T {
  return material
}

/** Once per frame, after the camera has moved: feeds the camera position and radius to every bent material. */
export function updateCurve(_camera: { x: number; y: number; z: number }, _size: number): void {}
