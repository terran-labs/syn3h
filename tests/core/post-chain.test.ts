import { describe, expect, it } from 'vitest'
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
