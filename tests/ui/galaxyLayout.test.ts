import { describe, expect, it } from 'vitest'
import { bodyOf, fitDistance, GALAXY_MAX, openingDistance, orbitLayout, worldRadius } from '../../src/ui/galaxy/Galaxy'
import { ORDINARY_BODY, PLANETS, type PlanetBody } from '../../src/world/planets'

const recipeBodies = PLANETS.map(recipe => recipe.body ?? ORDINARY_BODY)
/** Systems to try: the real recipes, then mixes of sizes and heats, for every count. */
function systems(): PlanetBody[][] {
  const all: PlanetBody[][] = [recipeBodies, [...recipeBodies, { size: 1, heat: 0.95 }]]
  for (let count = 1; count <= GALAXY_MAX; count++) {
    all.push(Array.from({ length: count }, (_, i) => ({ size: 0.3 + ((i * 7) % 11) * 0.12, heat: ((i * 5) % 9) / 9 })))
    all.push(Array.from({ length: count }, () => ({ size: 1.6, heat: 0.5 })))   // the largest worlds, all the same heat
    all.push(recipeBodies.slice(0, count))
  }
  return all
}
/** The narrowest clear space between any two worlds' surfaces, over many moments. */
function smallestGap(bodies: PlanetBody[]): number {
  let smallest = Infinity
  // Hours of orbit in uneven steps, so no alignment of the orbits is skipped over.
  for (let step = 0; step < 3000; step++) {
    const places = orbitLayout(bodies, step * 7.31)
    for (let a = 0; a < places.length; a++) for (let b = a + 1; b < places.length; b++) {
      const [ax, ay, az] = places[a].position, [bx, by, bz] = places[b].position
      smallest = Math.min(smallest, Math.hypot(ax - bx, ay - by, az - bz) - places[a].radius - places[b].radius)
    }
  }
  return smallest
}

describe('galaxy layout', () => {
  it('never lets two worlds touch, with clear space between them, for every count and mix of sizes', () => {
    for (const bodies of systems()) if (bodies.length > 1) expect(smallestGap(bodies)).toBeGreaterThanOrEqual(0.079)
  })
  it('gives every world an orbit of its own, each beyond the last by both radii and the clear space', () => {
    for (const bodies of systems()) {
      const lanes = orbitLayout(bodies, 0).sort((a, b) => a.orbit - b.orbit)
      for (let i = 1; i < lanes.length; i++) expect(lanes[i].orbit - lanes[i - 1].orbit).toBeGreaterThanOrEqual(lanes[i].radius + lanes[i - 1].radius + 0.079)
    }
  })
  it('orders the orbits by heat: molten worlds nearest the sun, frozen ones farthest', () => {
    const places = orbitLayout(recipeBodies, 0)
    const byOrbit = PLANETS.map((recipe, i) => ({ id: recipe.id, heat: recipeBodies[i].heat, orbit: places[i].orbit })).sort((a, b) => a.orbit - b.orbit)
    for (let i = 1; i < byOrbit.length; i++) expect(byOrbit[i].heat).toBeLessThanOrEqual(byOrbit[i - 1].heat)
    expect(byOrbit[0].id).toBe('volcanic')
    expect(byOrbit.at(-1)!.id).toBe('ice')
    // A recipe with no body of its own is an ordinary temperate planet, in the middle.
    const added = orbitLayout([...recipeBodies, ORDINARY_BODY], 0), newcomer = added.at(-1)!
    expect(newcomer.orbit).toBeGreaterThan(Math.min(...added.map(p => p.orbit)))
    expect(newcomer.orbit).toBeLessThan(Math.max(...added.map(p => p.orbit)))
  })
  it('sizes worlds by their bodies, with moons much smaller than planets', () => {
    const radius = (id: string) => worldRadius(PLANETS.find(recipe => recipe.id === id)!.body!.size)
    const planets = PLANETS.filter(recipe => !['moon', 'ice'].includes(recipe.id)).map(recipe => radius(recipe.id))
    for (const moon of ['moon', 'ice']) expect(radius(moon)).toBeLessThan(Math.min(...planets) * 0.7)
    expect(radius('swamp')).toBeGreaterThan(radius('alpine'))
    // Every recipe says what kind of body it is.
    for (const recipe of PLANETS) expect(recipe.body, recipe.id).toBeDefined()
    // A world still forming is molten: among the hot worlds.
    expect(bodyOf({ id: 'custom', label: 'Custom', land: 0, sea: 0, glow: false, seed: 1, forming: true }).heat).toBeGreaterThan(0.9)
    expect(bodyOf({ id: 'ice~1', label: 'Ice moon 2', land: 0, sea: 0, glow: false, seed: 1, recipe: 'ice' })).toEqual(PLANETS.find(r => r.id === 'ice')!.body)
  })
  it('turns the inner worlds faster than the outer ones, as Kepler has it', () => {
    const turned = (index: number) => { const a = orbitLayout(recipeBodies, 0)[index], b = orbitLayout(recipeBodies, 10)[index]; return { orbit: a.orbit, angle: Math.abs(Math.atan2(b.position[2], b.position[0]) - Math.atan2(a.position[2], a.position[0])) } }
    const worlds = PLANETS.map((_, i) => turned(i)).sort((a, b) => a.orbit - b.orbit)
    for (let i = 1; i < worlds.length; i++) expect(worlds[i].angle).toBeLessThan(worlds[i - 1].angle)
    // Period squared over orbit cubed is the same for all: angle times orbit to the 3/2 is constant.
    for (const world of worlds) expect(world.angle * Math.pow(world.orbit, 1.5)).toBeCloseTo(worlds[0].angle * Math.pow(worlds[0].orbit, 1.5), 6)
  })
  it('does not line the worlds up at the start', () => {
    const angles = orbitLayout(recipeBodies, 0).map(place => (Math.atan2(place.position[2], place.position[0]) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b)
    // No half of the sky is empty, and no two worlds start within five degrees of each other.
    const gaps = angles.map((angle, i) => (angles[(i + 1) % angles.length] - angle + Math.PI * 2) % (Math.PI * 2))
    expect(Math.max(...gaps)).toBeLessThan(Math.PI)
    expect(Math.min(...gaps)).toBeGreaterThan(5 * Math.PI / 180)
  })
  it('places one world for each, up to the limit, in the order given, the same every time', () => {
    for (let count = 1; count <= GALAXY_MAX + 2; count++) expect(orbitLayout(Array.from({ length: count }, () => ORDINARY_BODY), 0)).toHaveLength(Math.min(count, GALAXY_MAX))
    expect(orbitLayout(recipeBodies, 123.4)).toEqual(orbitLayout(recipeBodies, 123.4))
    expect(orbitLayout(recipeBodies, 0)[0].position).not.toEqual(orbitLayout(recipeBodies, 10)[0].position)
  })
  it('opens closer on portrait phones while leaving tablets and landscape fitted', () => {
    const full = fitDistance(recipeBodies)
    expect(openingDistance(recipeBodies, 390, 844)).toBeCloseTo(full * 0.8)
    for (const [width, height] of [[844, 390], [1024, 1366], [1440, 900]]) {
      expect(openingDistance(recipeBodies, width, height)).toBe(full)
    }
  })
  it('frames the whole system at the first view, with a tenth world too', () => {
    for (const bodies of [recipeBodies, [...recipeBodies, { size: 1, heat: 0.95 }]]) {
      const reach = fitDistance(bodies) * 0.62
      for (const place of orbitLayout(bodies, 7)) expect(place.orbit + place.radius).toBeLessThan(reach)
    }
  })
})
