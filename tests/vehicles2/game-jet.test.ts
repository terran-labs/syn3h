import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GameJet } from '../../src/vehicles/jetgen/GameJet'
import { Builder, GROUND_Y } from '../../src/vehicles/jetgen/shapes'
import { roleOf } from '../../src/vehicles/skins/showroom'

function visibleCost(root: THREE.Object3D) {
  let triangles = 0, draws = 0
  root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3
    draws++
    for (const a of ['position', 'normal']) {
      expect(Array.from(o.geometry.attributes[a].array).every(Number.isFinite)).toBe(true)
    }
  })
  return { triangles, draws }
}

describe('approved Mk2 game model', () => {
  it('meets geometry and draw budgets with gear up, moving and down at every detail level', () => {
    const jet = new GameJet()
    for (const gear of [0, .25, .75, 1]) {
      jet.update(gear, .3, -.2, .8)
      for (const level of [0, 1, 2] as const) {
        jet.setLevel(level)
        const cost = visibleCost(jet.object)
        expect(cost.triangles).toBeLessThanOrEqual([12000, 2500, 500][level])
        expect(cost.draws).toBeLessThanOrEqual([10, 3, 1][level])
      }
    }
    for (const y of jet.near.footHeights()) expect(y).toBeCloseTo(GROUND_Y, 2)
    jet.dispose()
  })

  it('keeps the pilot clear, uses shared materials and preserves the far ring opening', () => {
    const jet = new GameJet()
    expect(jet.near.clearance).toBeGreaterThanOrEqual(.25)
    expect(jet.near.object.userData.cockpit).toBe(true)
    expect(jet.near.ridePosition!.position.toArray()).toEqual(jet.eye.toArray())
    expect(roleOf(jet.near.materials.glass)).toBe('canopy')
    expect(roleOf(jet.near.materials.glow)).toBe('glow')
    jet.update(1, .2, -.2, 1)
    expect(jet.near.vector.toArray()).toEqual([.2, -.2])
    // Through the ring above the fuselage: silhouette must not fill the hole with a cap.
    jet.far.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, .65, 4), new THREE.Vector3(0, 0, -1), 0, 2)
    expect(ray.intersectObject(jet.far)).toHaveLength(0)
    jet.setColors('#123456', '#abcdef')
    expect((jet.far.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
    jet.dispose()
  })

  it('smooths aerodynamic normals without changing their outline', () => {
    const keys = [[1.5, -.02, .9, 1.5, .07], [2.4, .1, .36, 1.16, .062], [3.3, .2, -.18, .82, .055], [3.55, -.05, -.14, .74, .055]]
    const flat = new Builder(.6, true), smooth = new Builder(.6, true, true)
    flat.surf(keys); smooth.surf(keys)
    for (let i = 0; i < flat.pieces.length; i++) {
      const a = flat.pieces[i].geometry, b = smooth.pieces[i].geometry
      const expanded = b.toNonIndexed()
      expect(Array.from(expanded.attributes.position.array)).toEqual(Array.from(a.attributes.position.array))
      expect(Array.from(expanded.attributes.normal.array)).not.toEqual(Array.from(a.attributes.normal.array))
      expanded.dispose(); a.dispose(); b.dispose()
    }
  })
})

it('switches remote models with hysteresis and unregisters on disposal', () => {
  const owner = new THREE.Group(), callbacks = new Set<(distance: number, remote: boolean, level: number) => void>()
  owner.userData.registerVehicleDetail = (callback: (distance: number, remote: boolean, level: number) => void) => {
    callbacks.add(callback); return () => callbacks.delete(callback)
  }
  const jet = new GameJet(); owner.add(jet.object); jet.attach()
  const move = (distance: number, remote = true) => callbacks.forEach(f => f(distance, remote, 3))
  move(150); expect(jet.far.visible).toBe(true)
  move(118); expect(jet.far.visible).toBe(true)
  move(110); expect(jet.medium(0).object.visible).toBe(true)
  move(28); expect(jet.medium(0).object.visible).toBe(true)
  move(24); expect(jet.near.object.visible).toBe(true)
  move(500, false); expect(jet.near.object.visible).toBe(true)
  jet.dispose(); expect(callbacks.size).toBe(0)
})

it('builds a detail level only when it is first shown', () => {
  const jet = new GameJet()
  expect(jet.built()).toEqual([false, false, false, false])
  // A jet that spawns far away costs one small outline, in the player's colour.
  jet.setColors('#123456', '#abcdef'); jet.setLevel(2); jet.update(0, 0, 0, .5)
  expect(jet.built()).toEqual([false, false, false, true])
  expect((jet.far.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
  // Closing in builds the medium pose in use, then the close model with the gear state so far.
  jet.setLevel(1); expect(jet.built()).toEqual([false, true, false, true])
  jet.update(1, 0, 0, .5); expect(jet.built()).toEqual([false, true, true, true])
  jet.setLevel(0)
  expect(jet.near.gearAmount).toBe(1)
  expect((jet.near.materials.paint as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
  // Hidden close model does no gear work; it catches up when it is shown again.
  jet.setLevel(2); jet.update(0, 0, 0, 0); expect(jet.near.gearAmount).toBe(1)
  jet.setLevel(0); expect(jet.near.gearAmount).toBe(0)
  let visible = 0
  for (const o of jet.object.children) if (o.visible && (o instanceof THREE.Mesh || o.children.length)) visible++
  expect(visible).toBe(1)
  jet.dispose()
})

describe('Mk2 moving parts and thrusters', () => {
  /** Mean position of the trailing edge (the rearmost vertices) of the flap vertices that pass `pick`. */
  function trailingEdge(jet: GameJet, pick: (x: number, y: number) => boolean) {
    const batch = jet.near.object.getObjectByName('jet-flap-batch') as THREE.Mesh
    const p = batch.geometry.attributes.position, points: THREE.Vector3[] = []
    for (let i = 0; i < p.count; i++) if (pick(p.getX(i), p.getY(i))) points.push(new THREE.Vector3().fromBufferAttribute(p, i))
    const rear = Math.max(...points.map(v => v.z)), edge = points.filter(v => v.z > rear - .03)
    return edge.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(edge.length)
  }
  const upperRight = (x: number, y: number) => x > .1 && y > .7, upperLeft = (x: number, y: number) => x < -.1 && y > .7
  const flankRight = (x: number, y: number) => x > .7 && Math.abs(y - .05) < .3

  it('deflects the tail ring like control surfaces and draws them in one batch', () => {
    const jet = new GameJet(), controls = new THREE.Vector3()
    const pose = (pitch: number, roll: number, yaw: number) => { jet.update(0, 0, 0, .5, controls.set(pitch, roll, yaw)); return { ur: trailingEdge(jet, upperRight), ul: trailingEdge(jet, upperLeft), fr: trailingEdge(jet, flankRight) } }
    const rest = pose(0, 0, 0)
    // Nose up: both upper trailing edges rise together; the vertical flanks do not move.
    const up = pose(1, 0, 0)
    expect(up.ur.y - rest.ur.y).toBeGreaterThan(.03); expect(up.ul.y - rest.ul.y).toBeCloseTo(up.ur.y - rest.ur.y, 4)
    expect(up.fr.distanceTo(rest.fr)).toBeLessThan(1e-4)
    // Roll right: right side up, left side down.
    const roll = pose(0, 1, 0)
    expect(roll.ur.y - rest.ur.y).toBeGreaterThan(.03); expect(roll.ul.y - rest.ul.y).toBeLessThan(-.03)
    // Nose right: the flank's trailing edge swings right, like a rudder.
    const yaw = pose(0, 0, 1)
    expect(yaw.fr.x - rest.fr.x).toBeGreaterThan(.03)
    // Never more than 20 degrees, whatever the inputs add up to.
    const most = pose(1, 1, 1)
    expect(most.ur.distanceTo(rest.ur)).toBeLessThan(.75 * .38 * 2 * Math.sin(.35 / 2) + .01)
    // Petals and flaps are one draw each: five in flight, eight with the gear down.
    let draws = 0; jet.near.object.traverseVisible(o => { if (o instanceof THREE.Mesh) draws++ })
    expect(draws).toBeLessThanOrEqual(5)
    jet.update(1, .2, .1, .5, controls.set(.5, 0, 0)); draws = 0
    jet.near.object.traverseVisible(o => { if (o instanceof THREE.Mesh) draws++ })
    expect(draws).toBeLessThanOrEqual(8)
    jet.dispose()
  })

  it('walls every thruster off from the inside of the hull', () => {
    const b = new Builder(.6, true, true); new GameJet().design.build(b)
    const opaque = new THREE.Group(), front = new THREE.MeshBasicMaterial()
    for (const piece of b.pieces) if (piece.mat === 'dark') opaque.add(new THREE.Mesh(piece.geometry, front))
    opaque.updateMatrixWorld(true)
    expect(b.nozzles).toHaveLength(3)
    for (const n of b.nozzles) for (const [dx, dy] of [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
      // Looking straight up the throat from behind: an aft-facing dark surface must stop the ray.
      const origin = new THREE.Vector3(n.x + dx * n.r, n.y + dy * n.r, n.z + 1)
      const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, 2).intersectObject(opaque)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].face!.normal.z).toBeGreaterThan(.5)
      expect(hits[0].point.z).toBeGreaterThan(n.z - .5)
    }
    b.pieces.forEach(p => p.geometry.dispose()); b.flaps.forEach(f => f.geometry.dispose())
  })

  it('sweeps each side of the cockpit rim as one smooth tube that ends in a fine point', () => {
    const b = new Builder(.6, true, true); new GameJet().design.build(b)
    // The rim pieces are the dark ones that run the length of the canopy opening.
    const rims = b.pieces.filter(p => p.mat === 'dark').map(p => { p.geometry.computeBoundingBox(); return p.geometry }).filter(g => g.boundingBox!.max.z - g.boundingBox!.min.z > 1.5)
    expect(rims).toHaveLength(2)
    // One on each side, and slim: nowhere thicker than 6 cm, under a centimetre at the ends.
    expect(rims[0].boundingBox!.min.x * rims[1].boundingBox!.min.x).toBeLessThan(0)
    const rim = rims[0], p = rim.attributes.position, box = rim.boundingBox!
    let tip = 0
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < box.min.z + .004) tip = Math.max(tip, Math.abs(p.getX(i)) - Math.abs(box.min.x > 0 ? box.min.x : box.max.x))
    expect(tip).toBeLessThan(.012)
    // Welded and smooth: no vertex normal disagrees with a face it belongs to by more than 75 degrees.
    const index = rim.index!, n = rim.attributes.normal, a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), v = new THREE.Vector3()
    let worst = 1
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(p, index.getX(i)); c.fromBufferAttribute(p, index.getX(i + 1)).sub(a); d.fromBufferAttribute(p, index.getX(i + 2)).sub(a)
      const face = c.cross(d); if (face.lengthSq() < 1e-14) continue
      face.normalize()
      for (let k = 0; k < 3; k++) worst = Math.min(worst, face.dot(v.fromBufferAttribute(n, index.getX(i + k))))
    }
    expect(worst).toBeGreaterThan(Math.cos(80 * Math.PI / 180))
    b.pieces.forEach(q => q.geometry.dispose()); b.flaps.forEach(f => f.geometry.dispose())
  })
})

it('ships only the approved Mk2: nothing the game jet loads imports the study designs', async () => {
  const { readFileSync } = await import('node:fs')
  // Everything Jet.ts pulls in from the jet generator. designs.ts is the lab's catalogue.
  for (const file of ['Jet.ts', 'jetgen/GameJet.ts', 'jetgen/NextJet.ts', 'jetgen/JetSilhouette.ts', 'jetgen/MovingBatch.ts', 'jetgen/shapes.ts', 'jetgen/shipped.ts']) {
    const source = readFileSync(new URL(`../../src/vehicles/${file}`, import.meta.url), 'utf8')
    expect(source, file).not.toMatch(/from '\.\/(jetgen\/)?designs'/)
  }
  expect(new GameJet().design.id).toBe('hex-mk2')
})
