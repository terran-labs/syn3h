import { describe, expect, it } from 'vitest'
import { captionHidden, captionMask, covered, type LabelPlace } from '../../src/ui/galaxy/labels'

const place = (id: string, x: number, y: number, radius: number, depth: number): LabelPlace => ({ id, x, y, radius, visible: true, depth })

describe('planet captions: depth', () => {
  // Bug it catches: a caption written over the planet in front of its own.
  it('fades a planet mostly behind a nearer one, and only then', () => {
    const back = place('back', 100, 100, 20, 10), front = place('front', 104, 100, 30, 5)
    expect(captionHidden(back, [back, front])).toBe(true)
    expect(captionHidden(front, [back, front])).toBe(false)
    expect(captionHidden(back, [back, { ...front, x: 160 }])).toBe(false)
  })
  it('fades a planet behind the sun, not one in front of it', () => {
    const p = place('p', 200, 200, 10, 10)
    expect(captionHidden(p, [p], { x: 200, y: 200, radius: 20, depth: 5 })).toBe(true)
    expect(captionHidden(p, [p], { x: 200, y: 200, radius: 20, depth: 15 })).toBe(false)
  })
  it('measures cover as a share of the disc', () => {
    expect(covered({ x: 0, y: 0, radius: 10 }, { x: 0, y: 0, radius: 20 })).toBe(1)
    expect(covered({ x: 0, y: 0, radius: 10 }, { x: 40, y: 0, radius: 10 })).toBe(0)
  })
})

describe('planet captions: occlusion', () => {
  it('cuts a caption only by nearer bodies that reach it, from its own top centre', () => {
    const far = place('far', 300, 300, 20, 20), near = place('near', 310, 335, 18, 10), farther = place('farther', 310, 335, 18, 30)
    expect(captionMask(far, [far, farther], undefined, 325)).toBe('none')
    const mask = captionMask(far, [far, near], undefined, 325)
    expect(mask).toContain('calc(50% + 10.0px) 10.0px')
    expect(mask).toContain('transparent 17.5px, #000 18.5px')
    expect(captionMask(near, [far, near], undefined, 358)).toBe('none')
    // The sun cuts what is behind it.
    expect(captionMask(far, [far], { x: 300, y: 330, radius: 12, depth: 5 }, 325)).not.toBe('none')
  })
})
