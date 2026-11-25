import { describe, expect, it } from 'vitest'
import { captionBlocked, captionBox, captionHidden, captionLayout, captionMask, covered, type LabelPlace } from '../../src/ui/galaxy/labels'

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

describe('captions and the lobby controls', () => {
  // Bug caught: a caption over the Settings button or reading through the settings card.
  const dock = { left: 600, top: 1000, right: 728, bottom: 1100 }
  it('blocks a caption that touches a control or comes within the margin of one', () => {
    expect(captionBlocked({ left: 560, top: 980, right: 640, bottom: 1010 }, [dock])).toBe(true)
    expect(captionBlocked({ left: 500, top: 960, right: 596, bottom: 995 }, [dock])).toBe(true)
  })
  it('leaves a caption clear of every control alone', () => {
    expect(captionBlocked({ left: 100, top: 400, right: 220, bottom: 440 }, [dock])).toBe(false)
    expect(captionBlocked({ left: 100, top: 400, right: 220, bottom: 440 }, [])).toBe(false)
  })
})

describe('caption placement', () => {
  it('keeps an edge caption inside the viewport and its mask aligned with the globe', () => {
    const world = place('edge', 5, 370, 30, 10)
    const box = captionBox(world, 405, { width: 100, height: 32 }, 350, 400)!
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(400)
    const center = (box.left + box.right) / 2
    const front = place('front', center + 8, box.top + 4, 15, 5)
    expect(captionMask(world, [front], undefined, box.top, 2, center)).toContain('calc(50% + 4.0px) 2.0px')
  })

  it('gives a collision to the highlighted caption and keeps the dock clear', () => {
    const box = { left: 10, right: 100, top: 40, bottom: 70 }
    const idle = { id: 'idle', box, priority: 0 }
    const pointed = { id: 'pointed', box, priority: 3 }
    expect(captionLayout([idle, pointed], []).has('idle')).toBe(false)
    expect(captionLayout([idle, pointed], []).get('pointed')).toBeGreaterThan(0)
    expect(captionLayout([idle, pointed], [box]).size).toBe(0)
  })
})
