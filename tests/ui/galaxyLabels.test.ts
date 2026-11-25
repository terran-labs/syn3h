import { describe, expect, it } from 'vitest'
import { captionBlocked, captionBox, captionClearance, captionHidden, captionLayout, covered, type LabelPlace } from '../../src/ui/galaxy/labels'

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
  it('measures whole-caption clearance against nearer globes and the sun', () => {
    const far = place('far', 300, 300, 20, 20), near = place('near', 310, 335, 18, 10)
    const box = { left: 280, top: 325, right: 305, bottom: 350 }
    expect(captionClearance(box, far, [near])).toBeLessThan(0)
    expect(captionClearance(box, far, [{ ...near, depth: 30 }])).toBe(Infinity)
    expect(captionClearance(box, far, [], { ...near })).toBeLessThan(0)
    expect(captionClearance({ ...box, right: 290 }, far, [near])).toBeGreaterThan(0)
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
  it('keeps an edge caption inside the viewport', () => {
    const world = place('edge', 5, 370, 30, 10)
    const box = captionBox(world, 405, { width: 100, height: 32 }, 350, 400)!
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(400)

  })

  it('uses the free space beside the desktop dock when a wide caption grazes its corner', () => {
    const world = place('archipelago', 1015, 600, 40, 10)
    const dock = { left: 1116, top: 688, right: 1264, bottom: 784 }
    const box = captionBox(world, 650, { width: 220, height: 60 }, 1280, 800, [dock])!
    expect(box.top).toBe(650)
    expect(box.left).toBeLessThan(world.x)
    expect(box.right).toBeGreaterThan(world.x)
    expect(captionBlocked(box, [dock])).toBe(false)
  })

  it('keeps a caption continuous as it crosses the dock’s vertical boundary', () => {
    const world = place('archipelago', 1015, 600, 40, 10)
    const dock = { left: 1116, top: 688, right: 1264, bottom: 784 }
    const near = (top: number) => captionBox(world, top, { width: 220, height: 60 }, 1280, 800, [dock])!
    const justAbove = near(619.5), justInside = near(620.5)
    expect(captionBlocked(justInside, [dock])).toBe(false)
    expect(Math.abs(justAbove.left - justInside.left)).toBeLessThan(1)
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
