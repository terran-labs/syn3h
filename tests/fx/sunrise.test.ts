import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'
import { PostChain } from '../../src/fx/post/PostChain'
import { sunDirection } from '../../src/world/sky/skyMath'

describe('dawn and dusk shaft projection', () => {
  for (const phase of ['dawn', 'dusk']) for (const degrees of [2, 5, 10]) {
    it(`keeps a ${degrees} degree ${phase} sun visible in front of the camera`, () => {
      const hour = phase === 'dawn' ? 6 + degrees / 15 : 18 - degrees / 15
      const sun = new Vector3(...sunDirection(hour, 0, 37))
      const camera = new PerspectiveCamera(65, 16 / 9, .1, 3000)
      camera.position.set(137, 80, -249)
      camera.lookAt(camera.position.clone().add(new Vector3(sun.x, 0, sun.z)))
      camera.updateMatrixWorld(true)
      const chain = new PostChain({ quality: { postTier: 'lite' } }, { sunDirection: sun })
      const renderer = { getDrawingBufferSize: (size: Vector2) => size.set(1280, 720) }
      // Exercise the actual projection, not a hand-authored screen coordinate.
      const visibility = (chain as any).updateSun(camera, renderer)
      const uv = (chain as any).u.sunUv.value as Vector2
      expect(visibility).toBeGreaterThan(0)
      expect(uv.x).toBeCloseTo(.5)
      expect(uv.y).toBeGreaterThan(0)
      expect(uv.y).toBeLessThan(.5)
      camera.lookAt(camera.position.clone().sub(sun))
      camera.updateMatrixWorld(true)
      expect((chain as any).updateSun(camera, renderer)).toBe(0)
    })
  }
})
