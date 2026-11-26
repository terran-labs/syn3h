import { describe, expect, it } from 'vitest'
import { captionBlocked, captionBox, captionClearance, captionHidden, captionLayout, captionOptions, captionRows, covered, type CaptionOption, type LabelPlace } from '../../src/ui/galaxy/labels'

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

  const option = (left: number, width = 90, content: CaptionOption['content'] = 'full'): CaptionOption =>
    ({ box: { left, right: left + width, top: 40, bottom: 70 }, content })

  it('keeps the highlighted name when two names have no non-overlapping placements', () => {
    const idle = { id: 'idle', options: [option(10)], priority: 0 }
    const pointed = { id: 'pointed', options: [option(10)], priority: 3 }
    expect([...captionLayout([idle, pointed]).keys()]).toEqual(['pointed'])
  })

  it('keeps a neighbour’s name by moving a caption and compacting the next conflict', () => {
    const highlighted = { id: 'highlighted', options: [option(10), option(150)], priority: 3 }
    const current = { id: 'current', options: [option(170), option(245, 44, 'name')], priority: 1 }
    const cornered = { id: 'cornered', options: [option(25, 44)], priority: 0 }
    const layout = captionLayout([highlighted, current, cornered])
    expect(layout.size).toBe(3)
    expect(layout.get('highlighted')?.box).toEqual(highlighted.options[1].box)
    expect(layout.get('current')?.content).toBe('name')
    expect(layout.get('cornered')?.box).toEqual(cornered.options[0].box)
  })

  it('tries moving a neighbouring name before accepting a spot in the solar glare', () => {
    const parent = { id: 'parent', priority: 3, options: [option(10), option(150)] }
    const other = { id: 'other', priority: 0, options: [option(25, 44), { ...option(265, 44), inGlare: true as const }] }
    const layout = captionLayout([parent, other])
    expect(layout.get('parent')).toBe(parent.options[1])
    expect(layout.get('other')?.inGlare).toBeUndefined()
  })

  it('keeps the planet in place when a more strongly highlighted moon conflicts', () => {
    const parent = { id: 'alpine', priority: 0, options: [option(10), option(150)] }
    const moon = { id: 'moon', priority: 3, moon: true, options: [option(25, 44)] }
    const crowded = captionLayout([moon, parent])
    expect(crowded.get('alpine')).toBe(parent.options[0])
    expect(crowded.has('moon')).toBe(false)
    const clear = captionLayout([parent, { ...moon, options: [option(190, 44)] }])
    expect(clear.has('moon')).toBe(true)
  })

  it('puts a caption above its globe when the usual place is bright even if the sun is behind', () => {
    const world = place('swamp', 665, 345, 18, 10)
    const sun = { x: 640, y: 424, radius: 16, depth: 20 }
    const metrics = { scale: 1.18, name: { width: 72, height: 13 }, biome: { width: 22, height: 12 } }
    const options = captionOptions(world, metrics, { width: 1280, height: 800, blockers: [] }, [world], sun)
    expect(options[0].inGlare).toBeUndefined()
    expect(options[0].box.bottom).toBeLessThan(world.y - world.radius)
    expect(options.some(option => option.inGlare)).toBe(true)
  })

  it('slides the outward name above the streak when its usual side conflicts with a caption', () => {
    const world = place('obsidian', 138, 429, 7, 20)
    const sun = { x: 195, y: 447, radius: 8, depth: 16 }
    const metrics = { scale: 1.04, name: { width: 49, height: 11 }, biome: { width: 44, height: 10 } }
    const options = captionOptions(world, metrics, { width: 390, height: 844, blockers: [] }, [world], sun)
    const alpine = { id: 'alpine', priority: 1, options: [{ ...option(6),
      box: { left: 6, right: 111, top: 384, bottom: 421 } }] }
    const layout = captionLayout([alpine, { id: world.id, priority: 0, options }])
    expect(layout.get(alpine.id)).toBe(alpine.options[0])
    const obsidian = layout.get(world.id)!
    expect(obsidian.inGlare).toBeUndefined()
    expect(obsidian.box.right).toBeLessThan(world.x - world.radius)
    expect(obsidian.box.top).toBeGreaterThan(alpine.options[0].box.bottom)
    expect(obsidian.box.top + metrics.name.height * metrics.scale).toBeLessThan(sun.y - sun.radius)
  })

  it('accounts for the desktop streak beyond the circular glow', () => {
    const world = place('obsidian', 510, 383, 15, 18)
    const sun = { x: 640, y: 424, radius: 16, depth: 15 }
    const metrics = { scale: 1.08, name: { width: 60, height: 14 }, biome: { width: 50, height: 12 } }
    const options = captionOptions(world, metrics, { width: 1280, height: 800, blockers: [] }, [world], sun)
    expect(options[0].inGlare).toBeUndefined()
    expect(options[0].box.right).toBeLessThan(world.x - world.radius)
    expect(options.some(({ box, inGlare }) => box.top > world.y + world.radius && inGlare)).toBe(true)
  })

  it('keeps the narrower printed row attached after clamping an above-caption to an edge', () => {
    const world = place('alpine', 12, 435, 9, 18)
    const metrics = { scale: 1.16, name: { width: 90.6, height: 11 }, biome: { width: 26.3, height: 11 } }
    const [caption] = captionOptions(world, metrics, { width: 390, height: 442, blockers: [] }, [world])
    expect(caption.content).toBe('full')
    expect(caption.blockEnd).toBe(true)
    expect(caption.inline).toBe('start')
    const [, biome] = captionRows(caption.box, [metrics.name, metrics.biome]
      .map(row => ({ width: row.width * metrics.scale, height: row.height * metrics.scale })), caption.inline, caption.blockEnd)
    expect(biome.left).toBeLessThan(world.x)
    expect(biome.right).toBeGreaterThan(world.x)
    expect(world.y - world.radius - biome.bottom).toBeLessThan(metrics.name.height * metrics.scale)
  })

  it('uses the unused height of the hit target to keep printed rows next to an above-caption globe', () => {
    const world = place('ice', 351, 415, 4, 23)
    const metrics = { scale: 1, name: { width: 97, height: 11 }, biome: { width: 39, height: 11 } }
    const [caption] = captionOptions(world, metrics, { width: 390, height: 427, blockers: [] }, [world])
    expect(caption.blockEnd).toBe(true)
    expect(caption.box.bottom - caption.box.top).toBeGreaterThan(metrics.name.height + metrics.biome.height)
    const [, biome] = captionRows(caption.box, [metrics.name, metrics.biome], caption.inline, caption.blockEnd)
    expect(world.y - world.radius - biome.bottom).toBeLessThan(metrics.name.height)
  })

  it('drops a moon when every local option is inside the solar glare', () => {
    const world = place('moon', 55, 60, 10, 10)
    const sun = { x: 100, y: 100, radius: 30, depth: 20 }
    const space = { width: 200, height: 200, blockers: [] }
    const metrics = { scale: 1, name: { width: 50, height: 12 }, biome: { width: 40, height: 10 } }
    expect(captionOptions(world, metrics, space, [world], sun).some(option => option.inGlare)).toBe(true)
    expect(captionOptions(world, { ...metrics, moon: true }, space, [world], sun)).toEqual([])
  })

  it('keeps the full caption above its disc if the dock takes the preferred place below', () => {
    const world = place('world', 100, 100, 18, 10)
    const metrics = { scale: 1, name: { width: 60, height: 14 }, biome: { width: 83, height: 11 } }
    const dock = { left: 50, right: 150, top: 122, bottom: 200 }
    const options = captionOptions(world, metrics, { width: 200, height: 200, blockers: [dock] }, [world])
    expect(options[0].content).toBe('full')
    expect(options[0].box.bottom).toBeLessThan(world.y - world.radius)
    expect(options.every(({ box }) => !captionBlocked(box, [dock]))).toBe(true)
  })

  it('uses the side if foreground bodies block both vertical placements', () => {
    const world = place('world', 100, 100, 15, 10)
    const foreground = [place('near-top', 100, 60, 19, 5), place('near-bottom', 100, 140, 19, 5)]
    const metrics = { scale: 1, name: { width: 60, height: 14 }, biome: { width: 55, height: 11 } }
    const options = captionOptions(world, metrics, { width: 220, height: 200, blockers: [] }, [world, ...foreground])
    const { box, content } = options[0]
    expect(content).toBe('full')
    expect(box.right < world.x - world.radius || box.left > world.x + world.radius).toBe(true)
  })

  it('offers only a reachable name and count if the biome row is too wide', () => {
    const world = place('world', 70, 65, 14, 10)
    const metrics = { scale: 1, name: { width: 44, height: 12 }, biome: { width: 145, height: 11 }, count: { width: 50, height: 10 } }
    const options = captionOptions(world, metrics, { width: 140, height: 130, blockers: [] }, [world])
    expect(options[0].content).toBe('with-count')
    expect(options.some(option => option.content === 'name')).toBe(true)
    expect(options.every(({ box }) => box.right - box.left >= 44 && box.bottom - box.top >= 24)).toBe(true)
  })

  it('leaves the whole target clear of the sun and foreground and omits a wholly covered world', () => {
    const world = place('world', 90, 80, 18, 10)
    // Most of this disc is covered, but its exposed side still has a name and hit target.
    const front = place('front', 96, 80, 20, 5)
    const sun = { x: 100, y: 40, radius: 12, depth: 4 }
    const metrics = { scale: 1, name: { width: 55, height: 12 }, biome: { width: 48, height: 11 } }
    const space = { width: 250, height: 200, blockers: [] }
    const options = captionOptions(world, metrics, space, [world, front], sun)
    expect(options.length).toBeGreaterThan(0)
    expect(options.every(({ box }) => captionClearance(box, world, [front], sun) > 1)).toBe(true)
    expect(captionOptions(world, metrics, space, [world], { ...world, depth: 5 })).toEqual([])
  })
})
