import { describe, expect, it } from 'vitest'
import { bodyOf, fitDistance, GALAXY_MAX, openingDistance, orbitLayout, orbitShape, worldRadius, type OrbitBody } from '../../src/ui/galaxy/Galaxy'
import { ORDINARY_BODY, PLANETS } from '../../src/world/planets'

const recipeBodies: OrbitBody[] = PLANETS.map(recipe => ({ ...(recipe.body ?? ORDINARY_BODY), id: recipe.id }))
type PlanetBody = OrbitBody
/** The angle between two directions from the sun. */
const between = (a: number[], b: number[]) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))
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
  it('gives every planet a lane of its own, and keeps each moon by its planet', () => {
    for (const bodies of systems()) {
      const places = orbitLayout(bodies, 3.3), planets = places.filter(p => p.parent === undefined)
      expect(new Set(planets.map(p => p.orbit)).size).toBe(planets.length)
      for (const moon of places.filter(p => p.parent !== undefined)) {
        const planet = places[moon.parent!]
        expect(moon.orbit).toBe(planet.orbit)
        expect(Math.hypot(...moon.position.map((v, k) => v - planet.position[k]))).toBeLessThan(planet.radius * 3 + moon.radius + 0.6)
      }
    }
  })
  it('orders the system as its worlds are: molten inside, dry, then wet and living, then frozen; the Moon circles Alpine', () => {
    const places = orbitLayout(recipeBodies, 0)
    const lanes = PLANETS.map((recipe, i) => ({ id: recipe.id, place: places[i] })).filter(l => l.place.parent === undefined).sort((a, b) => a.place.orbit - b.place.orbit).map(l => l.id)
    expect(lanes).toEqual(['volcanic', 'obsidian', 'desert', 'badlands', 'swamp', 'archipelago', 'alpine', 'ice'])
    expect(places[PLANETS.findIndex(r => r.id === 'moon')].parent).toBe(PLANETS.findIndex(r => r.id === 'alpine'))
  })
  it('tilts and stretches each orbit a little, differently and the same every time', () => {
    const shapes = Array.from({ length: GALAXY_MAX }, (_, lane) => orbitShape(lane))
    for (const shape of shapes) {
      expect(shape.inclination * 180 / Math.PI).toBeGreaterThanOrEqual(1.5); expect(shape.inclination * 180 / Math.PI).toBeLessThanOrEqual(4)
      expect(shape.eccentricity).toBeGreaterThanOrEqual(0.02); expect(shape.eccentricity).toBeLessThanOrEqual(0.05)
    }
    expect(new Set(shapes.map(s => s.node.toFixed(3))).size).toBe(shapes.length)
    expect(orbitShape(3)).toEqual(orbitShape(3))
    // Every world leaves the flat plane, and keeps close to it.
    for (const place of orbitLayout(recipeBodies, 0)) if (place.path) expect(Math.abs(place.path.normal[1])).toBeGreaterThan(Math.cos(4.01 * Math.PI / 180))
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
    expect(bodyOf({ id: 'ice~1', label: 'Ice moon 2', land: 0, sea: 0, glow: false, seed: 1, recipe: 'ice' })).toMatchObject(PLANETS.find(r => r.id === 'ice')!.body!)
  })
  it('turns the inner worlds faster than the outer ones, as Kepler has it', () => {
    const turned = (index: number) => { const a = orbitLayout(recipeBodies, 0)[index], b = orbitLayout(recipeBodies, 10)[index]; return { orbit: a.orbit, moon: a.parent !== undefined, angle: between(a.position, b.position) } }
    const worlds = PLANETS.map((_, i) => turned(i)).filter(w => !w.moon).sort((a, b) => a.orbit - b.orbit)
    for (let i = 1; i < worlds.length; i++) expect(worlds[i].angle).toBeLessThan(worlds[i - 1].angle)
    // Period squared over orbit cubed is the same for all: angle times orbit to the 3/2 is constant.
    for (const world of worlds) expect(world.angle * Math.pow(world.orbit, 1.5)).toBeCloseTo(worlds[0].angle * Math.pow(worlds[0].orbit, 1.5), 6)
  })
  it('does not line the worlds up at the start', () => {
    const angles = orbitLayout(recipeBodies, 0).filter(place => place.parent === undefined).map(place => (Math.atan2(place.position[2], place.position[0]) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b)
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
  it('opens closer on portrait phones and short landscape screens, leaving tablets and desktops fitted', () => {
    const full = fitDistance(recipeBodies)
    expect(openingDistance(recipeBodies, 390, 844)).toBeCloseTo(full * 0.8)
    // A phone on its side: closer, so the worlds spread across its width, never past the fit.
    for (const [width, height] of [[844, 390], [932, 430]]) {
      const d = openingDistance(recipeBodies, width, height)
      expect(d).toBeLessThan(full); expect(d).toBeGreaterThan(full * 0.5)
    }
    for (const [width, height] of [[1024, 1366], [1440, 900], [1366, 1024]]) {
      expect(openingDistance(recipeBodies, width, height)).toBe(full)
    }
  })
  it('frames the whole system at the first view, with a tenth world too', () => {
    for (const bodies of [recipeBodies, [...recipeBodies, { size: 1, heat: 0.95 }]]) {
      const reach = fitDistance(bodies) * 0.62
      for (const place of orbitLayout(bodies, 7)) expect(Math.hypot(...place.position) + place.radius).toBeLessThan(reach)
    }
  })
})
