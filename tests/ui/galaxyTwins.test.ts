import { describe, expect, it } from 'vitest'
import { RECIPE_IDS } from '../../shared/recipes'
import { pickTwin, projectTwins } from '../../src/ui/galaxy/twinProjection'
import type { LabelPlace } from '../../src/ui/galaxy/labels'

const sun = { x: 0, y: 0, radius: 5, depth: 5 }
const world = (id: string, x = 80, depth = 10): LabelPlace => ({ id, x, y: 50, radius: 10, visible: true, depth })
const project = (places: LabelPlace[], width = 300) => projectTwins(places, sun, width, 100, () => true)

describe('galaxy twins', () => {
  it('offers one private anchor per real recipe and excludes rehearsal copies and Custom', () => {
    const places = [...RECIPE_IDS.map(id => world(id)), world('alpine~1'), world('custom')]
    expect(project(places).map(twin => twin.id)).toEqual([...RECIPE_IDS])
    expect(projectTwins(places, sun, 300, 100, id => id !== 'ice').some(twin => twin.id === 'ice')).toBe(false)
  })

  it('flips the private anchor inward at an edge and hides a clipped or covered twin', () => {
    const alpine = world('alpine', 280)
    const [inward] = project([alpine])
    expect(inward.visible).toBe(true)
    expect(inward.x + inward.radius).toBeLessThan(alpine.x - alpine.radius)
    expect(project([world('alpine')], 35)[0].visible).toBe(false)
    expect(project([alpine, world('desert', inward.x, 6)])[0].visible).toBe(false)
  })

  it('opens a choice throughout the touch overlap, including inside either painted rim', () => {
    const place = { ...world('alpine'), radius: 15 }, places = [place], twins = project(places)
    const [twin] = twins
    const pick = (x: number, touch = true) => pickTwin(places, twins, sun, x, place.y, 22, touch)
    const publicEdge = twin.rimX - 1, privateEdge = twin.x - twin.radius + 1
    expect(pick(publicEdge)).toEqual({ id: place.id, action: 'choose' })
    expect(pick(twin.rimX + 2)).toEqual({ id: place.id, action: 'choose' })
    expect(pick(privateEdge)).toEqual({ id: place.id, action: 'choose' })
    expect(pick(place.x - place.radius + 1)).toEqual({ id: place.id, action: 'public' })
    expect(pick(twin.x + twin.radius - 1)).toEqual({ id: place.id, action: 'private' })
    expect(pick(publicEdge, false)).toEqual({ id: place.id, action: 'public' })
    expect(pick(privateEdge, false)).toEqual({ id: place.id, action: 'private' })
    expect(pick(250)).toBeUndefined()
  })

  it('gives foreground bodies their pixels when they cross a private disc or the band', () => {
    const alpine = world('alpine'), twins = project([alpine])
    const [twin] = twins
    const foreground = world('desert', twin.x, 6)
    expect(pickTwin([alpine, foreground], twins, sun, twin.x, twin.y, 22, true)).toEqual({ id: 'desert', action: 'public' })
    const foregroundTwins = project([foreground])
    expect(pickTwin([alpine, foreground], [...twins, ...foregroundTwins], sun, twin.x, twin.y, 22, true))
      .toEqual({ id: 'desert', action: 'choose' })
    expect(pickTwin([alpine], twins, { ...sun, x: twin.x, y: twin.y }, twin.x, twin.y, 22, true)).toBeUndefined()
    expect(pickTwin([alpine, foreground], twins, sun, twin.rimX + 2, twin.y, 22, true)).toEqual({ id: 'desert', action: 'public' })
  })
})
