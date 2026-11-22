import { describe, expect, it } from 'vitest'
import { Vector2 } from 'three/webgpu'
import { ASPECT_SLACK, ViewFit } from '../../src/core/viewFit'

/**
 * The bug a player hit (v26.11.2201, iPhone): after turning the phone a few times the world
 * was drawn for the wrong shape and stretched over the screen until the page reloaded. After
 * any sequence of size reports, stale ones included, the next drawn frame must have the
 * buffer at the canvas's size and the camera's aspect at the buffer's shape.
 */
function rig() {
  const renderer = { w: 0, h: 0, ratio: 1.25, getSize: (t: Vector2) => t.set(renderer.w, renderer.h), setSize(w: number, h: number) { renderer.w = w; renderer.h = h } }
  const camera = { aspect: 1, updateProjectionMatrix() {} }
  return { renderer, camera, fit: new ViewFit(renderer, camera, new Vector2()) }
}

describe('ViewFit', () => {
  it('converges on the last measured canvas size whatever came before', () => {
    const { renderer, camera, fit } = rig()
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const sizes = [[390, 844], [844, 390], [844, 844], [390, 390], [874, 402], [402, 874], [0, 0]]
    for (let run = 0; run < 200; run++) {
      // A burst of reports, some applied at once (a resize event), some only recorded (a
      // ResizeObserver while the loop runs), some stale shapes, and the temporal pass setting
      // the aspect from whole buffer pixels between frames.
      for (let k = 0, n = 1 + Math.floor(random() * 6); k < n; k++) {
        const [w, h] = sizes[Math.floor(random() * sizes.length)]
        fit.measure(w, h)
        if (random() < 0.5) fit.fit()
        if (random() < 0.3 && renderer.h) camera.aspect = Math.floor(renderer.w * renderer.ratio) / Math.floor(renderer.h * renderer.ratio)
      }
      const [w, h] = sizes[Math.floor(random() * (sizes.length - 1))]
      fit.measure(w, h)
      fit.fit() // the drawn frame
      expect([renderer.w, renderer.h]).toEqual([w, h])
      expect(Math.abs(camera.aspect / (renderer.w / renderer.h) - 1)).toBeLessThanOrEqual(ASPECT_SLACK)
      expect(fit.stale).toBe(false)
    }
  })

  it('leaves a settled view alone', () => {
    const { renderer, camera, fit } = rig()
    fit.measure(844, 390); fit.fit()
    let sets = 0
    renderer.setSize = () => { sets++ }
    camera.aspect = Math.floor(844 * 1.25) / Math.floor(390 * 1.25)
    expect(fit.fit()).toBe(false)
    expect(sets).toBe(0)
  })
})
