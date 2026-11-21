import { expect, it, vi } from 'vitest'
import type { WebGPURenderer } from 'three/webgpu'
import { GlassTiming } from '../../src/fx/post/glassTiming'

it('charges both glass blur draws and excludes the shared final composite', async () => {
  const costs = new Map([['horizontal', .2], ['vertical', .3], ['final', 12]])
  const renderer = {
    _currentRenderContext: '',
    backend: {
      trackTimestamp: true,
      getTimestampUID: (context: string) => context,
      hasTimestampQuery: (id: string) => costs.has(id),
      getTimestamp: (id: string) => costs.get(id),
      resolveTimestampsAsync: vi.fn().mockResolvedValue(undefined),
    },
  }
  const horizontal = { _quadMesh: { onAfterRender() {} } }
  const vertical = { _quadMesh: { onAfterRender() {} } }
  const final = {
    _quadMesh: { onAfterRender() {} },
    render() {
      for (const [id, pass] of [['horizontal', horizontal], ['vertical', vertical], ['final', final]] as const) {
        renderer._currentRenderContext = id
        pass._quadMesh.onAfterRender()
      }
    },
  }
  const timing = new GlassTiming()
  timing.monitoring = true
  timing.draw(renderer as unknown as WebGPURenderer, final, [horizontal, vertical])
  await Promise.resolve()
  expect(timing.ms).toBeCloseTo(.5)
})
