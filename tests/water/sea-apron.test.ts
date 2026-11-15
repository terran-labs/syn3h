import { expect, it } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { apronGeometry } from '../../src/world/terrain/volcanics'

it.each([64, 2048])('faces every horizon-ring triangle upward on a %i metre tile', size => {
  const geometry = apronGeometry({ size, heightAt: () => -20 })
  try {
    const positions = geometry.getAttribute('position'), indices = geometry.getIndex()!
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    expect(indices.count).toBe(24)
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(positions, indices.getX(i))
      b.fromBufferAttribute(positions, indices.getX(i + 1))
      c.fromBufferAttribute(positions, indices.getX(i + 2))
      // Front-side lava must remain visible from above; double-sided water must choose
      // its underwater shading from below, including every far-horizon edge.
      expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0)
    }
  } finally { geometry.dispose() }
})
