/**
 * The water's own haze curve must leave the picture exactly as before where there is no scene
 * fog (a world built before Environment, a lab, a test), and must wrap the scene fog when there
 * is one, so it can never show water unfogged where land is fogged by a stale node.
 */
import { describe, expect, it } from 'vitest'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { hazeCurve } from '../../src/world/water/surface'

type Fogged = MeshStandardNodeMaterial & { setupFog(builder: { fogNode: unknown }, output: unknown): unknown }

describe('water haze curve', () => {
  it('is the default when the scene has no fog yet', () => {
    const material = new MeshStandardNodeMaterial() as Fogged
    hazeCurve(material)
    const output = vec4(1, 0, 0, 1)
    expect(material.setupFog({ fogNode: null }, output)).toBe(output)
  })
  it('wraps the scene fog the material is compiled against, every time', () => {
    const material = new MeshStandardNodeMaterial() as Fogged
    hazeCurve(material)
    const output = vec4(1, 0, 0, 1)
    const a = material.setupFog({ fogNode: vec4(0, 0, 1, 1) }, output)
    const b = material.setupFog({ fogNode: vec4(0, 1, 0, 1) }, output)
    expect(a).not.toBe(output)
    expect(b).not.toBe(a)
  })
})
