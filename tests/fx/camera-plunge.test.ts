import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { params } from '../../shared/params'
import { PostChain } from '../../src/fx/post/PostChain'

const water = vi.hoisted(() => ({ coverage: new WeakMap<object, number>() }))
vi.mock('../../src/world/water/underwater', () => ({
  cameraWaterCoverage: (camera: object) => water.coverage.get(camera) ?? 0,
  underwaterAmountForCamera: () => 1, // Residual fog must not make a dry camera splash.
}))

describe('camera splash pulse', () => {
  let now = 1000
  const camera = new THREE.PerspectiveCamera()
  const otherCamera = new THREE.PerspectiveCamera()
  const hull = { liquidState: { wasImmersed: true, lavaDepth: 1 } }
  const focus = vi.fn(() => hull)
  let chain: PostChain
  // Exercise the pulse without a renderer; the browser gate covers its composition.
  const sample = (c = camera): number => (chain as any).updatePlunge(c)
  beforeEach(() => {
    now = 1000
    water.coverage = new WeakMap()
    focus.mockClear()
    params.set('post.plunge', 1)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    chain = new PostChain({ quality: { postTier: 'full' } }, { sunDirection: new THREE.Vector3(0, 1, 0) }, focus)
  })
  afterEach(() => { vi.restoreAllMocks(); params.set('post.plunge', 1) })

  it('ignores immersed hulls, lava and eased fog when the camera is dry or unknown', () => {
    expect(sample()).toBe(0)
    hull.liquidState.wasImmersed = false
    expect(sample()).toBe(0)
    hull.liquidState.wasImmersed = true
    expect(sample()).toBe(0)
    expect(focus).not.toHaveBeenCalled()
  })

  it('scales entry by actual wet coverage and clears immediately on dry exit', () => {
    water.coverage.set(camera, 0.25)
    expect(sample()).toBeCloseTo(0.25)
    now += 20
    water.coverage.set(camera, 0)
    expect(sample()).toBe(0)
    water.coverage.set(camera, 1)
    expect(sample()).toBe(1)
  })

  it('fades during sustained immersion without retriggering', () => {
    water.coverage.set(camera, 1)
    expect(sample()).toBe(1)
    for (let i = 0; i < 8; i++) { now += 100; sample() }
    expect(sample()).toBe(0)
    now += 100
    expect(sample()).toBe(0)
  })

  it('does not carry a wet camera pulse to a different dry camera', () => {
    water.coverage.set(camera, 1)
    expect(sample()).toBe(1)
    expect(sample(otherCamera)).toBe(0)
    water.coverage.set(otherCamera, 0.5)
    expect(sample(otherCamera)).toBeCloseTo(0.5)
  })

  it('honours the off control while still tracking camera contact', () => {
    params.set('post.plunge', 0)
    water.coverage.set(camera, 1)
    expect(sample()).toBe(0)
    water.coverage.set(camera, 0)
    expect(sample()).toBe(0)
    params.set('post.plunge', 1)
    expect(sample()).toBe(0)
  })
})
