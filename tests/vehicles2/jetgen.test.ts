import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { JET_DESIGNS } from '../../src/vehicles/jetgen/designs'
import { NextJet } from '../../src/vehicles/jetgen/NextJet'
import { GROUND_Y } from '../../src/vehicles/jetgen/shapes'

describe('generated next-generation jets', () => {
  it('offers fifteen distinct designs in three rounds', () => {
    expect(JET_DESIGNS).toHaveLength(15)
    expect(new Set(JET_DESIGNS.map(d => d.id)).size).toBe(15)
  })
  for (const design of JET_DESIGNS) {
    it(`${design.name} builds, fits the current jet's envelope and keeps its functions`, () => {
      const jet = new NextJet(design)
      const hull = new THREE.Box3()
      jet.object.children.filter(o => o instanceof THREE.Mesh).forEach(o => {
        const g = (o as THREE.Mesh).geometry, p = g.getAttribute('position'), n = g.getAttribute('normal')
        for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true)
        g.computeBoundingBox(); hull.union(g.boundingBox!)
      })
      // The current jet's collider spans x +-3.85 and z -3.4..3.43; stay close to it.
      expect(hull.max.x).toBeLessThan(4); expect(hull.min.x).toBeGreaterThan(-4)
      expect(hull.min.z).toBeGreaterThan(-3.9); expect(hull.max.z).toBeLessThan(3.9)
      // Nothing but the gear reaches the ground.
      expect(hull.min.y).toBeGreaterThan(GROUND_Y + .1)
      expect(jet.hover).toHaveLength(3)
      expect(jet.nozzles.length).toBeGreaterThan(0)
      expect(jet.footHeights()).toHaveLength(3)
      jet.setGear(1)
      expect(jet.gear.visible).toBe(true)
      for (const y of jet.footHeights()) expect(y).toBeCloseTo(GROUND_Y, 2)
      // The main nozzle is its own part and swivels about its pivot.
      expect(jet.thruster.children.length).toBeGreaterThan(0)
      jet.setVector(.3, -.2)
      expect(jet.thruster.rotation.x).toBeCloseTo(.3); expect(jet.thruster.rotation.y).toBeCloseTo(.2)
      // The reduced version keeps every function at well under half the triangles.
      const low = new NextJet(design, .5)
      expect(low.triangles()).toBeLessThan(jet.triangles() * (design.hard ? .8 : .5))
      expect(low.hover).toHaveLength(3); expect(low.thruster.children.length).toBeGreaterThan(0)
      low.dispose()
      jet.setGear(0)
      expect(jet.gear.visible).toBe(false)
      for (const y of jet.footHeights()) expect(y).toBeGreaterThan(GROUND_Y + .5)
      jet.dispose()
    })
  }
})
