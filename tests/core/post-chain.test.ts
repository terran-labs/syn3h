import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { Param, ParamValue } from '../../shared/params'
import type { QualityLevel } from '../../src/core/quality'
import { PostChain as LivePostChain, type PostGraphPreset } from '../../src/fx/post/PostChain'
import * as P from '../../src/fx/post/params'
import { drawFrame, type PostChain } from '../../src/core/renderOptions'

describe('post chain hook', () => {
  const scene = { name: 'scene' }, camera = { name: 'camera' }
  const fakeRenderer = () => { const calls: unknown[][] = []; return { calls, render(...args: unknown[]) { calls.push(args) } } }
  it('draws straight through the renderer, once, when no chain is registered', () => {
    const renderer = fakeRenderer()
    drawFrame(renderer, scene, camera, null, 16.7)
    expect(renderer.calls).toEqual([[scene, camera]])
  })
  it('hands the frame to the chain alone when one is registered', () => {
    const renderer = fakeRenderer(), seen: unknown[][] = []
    const chain: PostChain<typeof renderer, typeof scene, typeof camera> = { render: (...args) => { seen.push(args) } }
    drawFrame(renderer, scene, camera, chain, 16.7)
    // Game itself asks the renderer for nothing: what reaches the screen is the chain's business.
    expect(renderer.calls).toEqual([])
    expect(seen).toEqual([[renderer, scene, camera, 16.7]])
  })
})

describe('covered post graphs', () => {
  it('retains both distinct neighbors, reuses the selected graph, and evicts a distant neighbor', async () => {
    const patched = [
      [P.postOn, true], [P.postBloom, 0], [P.postShafts, 0], [P.postFlare, 0],
      [P.postAO, 0], [P.postGI, 0], [P.postContact, 0], [P.postClouds, 0],
      [P.postDebug, 0], [P.postMotionBlur, 0], [P.postHeat, 0], [P.postTemporal, false],
    ] as const
    const original = patched.map(([param]) => param.value)
    const rendered: THREE.RenderPipeline[] = []
    const pipelineDraw = vi.spyOn(THREE.RenderPipeline.prototype, 'render').mockImplementation(function (this: THREE.RenderPipeline) {
      rendered.push(this)
    })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderer = {
      toneMapping: THREE.ACESFilmicToneMapping,
      outputColorSpace: THREE.SRGBColorSpace,
      toneMappingExposure: 1,
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(800, 450),
    } as unknown as THREE.WebGPURenderer
    let level: QualityLevel = 3
    const setPostActive = vi.fn()
    const chain = new LivePostChain({
      quality: { postTier: 'lite', getQualityState: () => ({ level }), setPostActive },
    }, { sunDirection: new THREE.Vector3(0, 1, -1).normalize() })
    const medium: PostGraphPreset = { level: 2, tier: 'lite', value: id => id === 'post.bloom' ? 0.4 : undefined }
    const ultra: PostGraphPreset = { level: 4, tier: 'full', value: () => undefined }
    const draw = () => chain.render(renderer, scene, camera)
    const yieldFrame = vi.fn(async () => {})
    const warm = { yieldFrame, draw: vi.fn(draw) }

    try {
      for (const [param, value] of patched) (param as Param<ParamValue>).value = value
      draw()
      const highGraph = rendered[0]
      expect(chain.coveredVariantKey(medium)).not.toBe(chain.coveredVariantKey(ultra))
      await chain.warmCovered(warm, medium)
      const mediumGraph = rendered[1]
      await chain.warmCovered(warm, ultra)
      await chain.warmCovered(warm, medium)

      expect(warm.draw).toHaveBeenCalledTimes(3)
      expect(yieldFrame).toHaveBeenCalledTimes(3)
      expect(rendered[3]).toBe(mediumGraph)
      expect(chain.builds).toBe(3)
      expect(chain.tier).toBe('lite')
      expect(P.postBloom.value).toBe(0)
      expect(setPostActive).not.toHaveBeenCalled()
      expect(chain.reuseStats.dormantGraphs).toBe(2)

      draw()
      expect(rendered[4]).toBe(highGraph)
      level = 2
      P.postBloom.value = 0.4
      draw()
      expect(rendered[5]).toBe(mediumGraph)
      expect(chain.builds).toBe(3)
      expect(chain.reuseStats).toMatchObject({ activations: 1, dormantGraphs: 1 })

      level = 3
      P.postBloom.value = 0
      draw()
      expect(rendered[6]).toBe(highGraph)
      expect(chain.builds).toBe(3)

      chain.render({ ...renderer } as THREE.WebGPURenderer, scene, camera)
      expect(chain.builds).toBe(4)
      expect(chain.reuseStats.dormantGraphs).toBe(0)

      const pending = chain.warmCovered(warm, medium)
      chain.dispose()
      await pending
      expect(warm.draw).toHaveBeenCalledTimes(3)
      expect(chain.reuseStats.dormantTargets).toBe(0)
    } finally {
      chain.dispose()
      pipelineDraw.mockRestore()
      patched.forEach(([param], i) => { (param as Param<ParamValue>).value = original[i] })
    }
  })
})
