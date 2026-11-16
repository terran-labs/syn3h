import { describe, expect, expectTypeOf, it } from 'vitest'
import type Node from 'three/src/nodes/core/Node.js'
import { NodeMaterial } from 'three/webgpu'
import { vec3 } from 'three/tsl'
import type { Environment } from '../../src/world/Environment'
import { AlienSkyMesh, type ShaftSourceBuilder } from '../../src/world/sky/AlienSkyMesh'

// These are construction-contract checks. They do not compile a shader or establish
// numerical scattering, live GPU uploads, or scene/PMREM pixel parity.
describe('solar shaft source graph contract', () => {
  it('exposes the same typed callback through the environment contract', () => {
    expectTypeOf<Environment['shaftSource']>().toEqualTypeOf<ShaftSourceBuilder>()
    expectTypeOf<Parameters<ShaftSourceBuilder>[0]>().toEqualTypeOf<Node<'vec3'>>()
    expectTypeOf<ReturnType<ShaftSourceBuilder>['scattering']>().toEqualTypeOf<Node<'vec3'>>()
    expectTypeOf<ReturnType<ShaftSourceBuilder>['transmission']>().toEqualTypeOf<Node<'float'>>()
  })

  it('builds independent source roots without replacing the sky material or uniforms', () => {
    const sky = new AlienSkyMesh()
    const material = sky.material as NodeMaterial
    try {
      const builder = sky.shaftSource
      const colorNode = material.colorNode
      const sunDirection = sky.sunDirection
      const cloudOffset = sky.cloudOffset
      const cloudCoverage = sky.cloudCoverage
      const ray = vec3(0, 1, 0)
      const first = builder(ray)

      // A detached callback must remain bound to this sky. New consumers get distinct
      // roots even after live values change; they must not reuse another shader's roots.
      sky.sunDirection.value.set(1, 0, 0)
      sky.cloudOffset.value.set(0.1, 0.2)
      sky.cloudCoverage.value = 0.7
      sky.cloudLayerVisible = false
      sky.showSunDisc.value = 0
      sky.underwaterAmount = 1
      const second = builder(ray)
      expect(first.scattering.isNode).toBe(true)
      expect(first.transmission.isNode).toBe(true)
      expect(second.scattering).not.toBe(first.scattering)
      expect(second.transmission).not.toBe(first.transmission)
      expect(second.scattering).not.toBe(second.transmission)
      expect(sky.shaftSource).toBe(builder)
      expect(sky.material).toBe(material)
      expect(material.colorNode).toBe(colorNode)
      expect(sky.sunDirection).toBe(sunDirection)
      expect(sky.cloudOffset).toBe(cloudOffset)
      expect(sky.cloudCoverage).toBe(cloudCoverage)
      expect(sky.cloudLayerVisible).toBe(false)
      expect(sky.showSunDisc.value).toBe(0)
      expect(sky.underwaterAmount).toBe(1)
    } finally {
      sky.geometry.dispose()
      material.dispose()
    }
  })
})
