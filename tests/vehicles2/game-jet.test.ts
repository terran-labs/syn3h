import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { GameJet, jetArticulation } from '../../src/vehicles/jetgen/GameJet'
import { Builder, GROUND_Y } from '../../src/vehicles/jetgen/shapes'
import { MK2_FITTINGS } from '../../src/vehicles/jetgen/shipped'
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
      jet.update(gear, .8, new THREE.Vector3(.8, -.3, -.5))
      for (const level of [0, 1, 2] as const) {
        jet.setLevel(level)
        // Base model budget, then the plume and the fitted tail lights, one draw each whatever their size.
        jet.plume.mesh.visible = false; jet.tailLights.mesh.visible = false
        const cost = visibleCost(jet.object)
        jet.plume.mesh.visible = true; jet.tailLights.mesh.visible = true
        expect(cost.triangles).toBeLessThanOrEqual([12000, 2800, 500][level])
        // Medium: body and glass (the throat is lit by the plume), plus the moving ring surfaces and the petals with the
        // boom collars, which must still be seen to move at that distance.
        expect(cost.draws).toBeLessThanOrEqual([9, 5, 1][level])
        expect(visibleCost(jet.object).draws - cost.draws).toBe(2)
      }
    }
    for (const y of jet.near.footHeights()) expect(y).toBeCloseTo(GROUND_Y, 2)
    jet.dispose()
  })

  it('keeps the pilot clear, uses shared materials and preserves the far ring opening', () => {
    const jet = new GameJet()
    expect(jet.near.clearance).toBeGreaterThanOrEqual(.25)
    expect(jet.near.object.userData.cockpit).toBe(true)
    // The close model is drawn inside the jet's scale (jetgen/size.ts): its eye is at design size.
    const eye = jet.eye.clone().divideScalar(jet.size).toArray()
    jet.near.ridePosition!.position.toArray().forEach((c, i) => expect(c).toBeCloseTo(eye[i], 6))
    expect(roleOf(jet.near.materials.glass)).toBe('canopy')
    expect(roleOf(jet.near.materials.glow)).toBe('glow')
    // The petals follow the stick: nose up and yaw, at full travel (jet.articulation).
    jet.update(1, 1, new THREE.Vector3(.2, 0, -.2))
    const travel = .35 * jetArticulation.value
    jet.near.vector.toArray().forEach((v, i) => expect(v).toBeCloseTo([.2 * travel, -.2 * travel][i], 6))
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

it('shares fixed jet resources across concurrent actors and retains them when all leave', () => {
  const a = new GameJet(), b = new GameJet()
  const tail = a.tailLights.mesh, plume = a.plume.mesh, far = a.far
  const shared = [tail.geometry, tail.material as THREE.Material, plume.geometry, plume.material as THREE.Material, far.geometry]
  let disposals = 0
  const recordDisposal = () => { disposals++ }
  for (const resource of shared) resource.addEventListener('dispose', recordDisposal)

  expect(b.tailLights.mesh).not.toBe(tail)
  expect(b.tailLights.mesh.geometry).toBe(tail.geometry)
  expect(b.tailLights.mesh.material).toBe(tail.material)
  expect(b.plume.mesh.geometry).toBe(plume.geometry)
  expect(b.plume.mesh.material).toBe(plume.material)
  expect(b.far.geometry).toBe(far.geometry)
  expect(b.far.material).not.toBe(far.material)

  const idle = b.plume.levels
  a.setLevel(2)
  a.setColors(0x123456, 0xabcdef)
  a.update(0, 1, undefined, false)
  expect(a.plume.levels).not.toEqual(idle)
  expect(b.plume.levels).toEqual(idle)
  expect(plume.userData.plumeColor.getHex()).toBe(0xabcdef)
  expect(b.plume.mesh.userData.plumeColor.getHex()).toBe(b.design.accent)
  expect(b.far.material.color.getHex()).toBe(b.design.paint)

  a.dispose()
  expect(b.tailLights.mesh.parent).toBe(b.object)
  expect(disposals).toBe(0)
  b.dispose()
  expect(disposals).toBe(0)
  const later = new GameJet()
  expect(later.tailLights.mesh.geometry).toBe(tail.geometry)
  expect(later.tailLights.mesh.material).toBe(tail.material)
  expect(later.plume.mesh.geometry).toBe(plume.geometry)
  expect(later.plume.mesh.material).toBe(plume.material)
  expect(later.far.geometry).toBe(far.geometry)
  later.dispose()
  expect(disposals).toBe(0)
  for (const resource of shared) resource.removeEventListener('dispose', recordDisposal)
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
  jet.setColors('#123456', '#abcdef'); jet.setLevel(2); jet.update(0, .5)
  expect(jet.built()).toEqual([false, false, false, true])
  expect((jet.far.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
  // Closing in builds the medium pose in use, then the close model with the gear state so far.
  jet.setLevel(1); expect(jet.built()).toEqual([false, true, false, true])
  jet.update(1, .5); expect(jet.built()).toEqual([false, true, true, true])
  jet.setLevel(0)
  expect(jet.near.gearAmount).toBe(1)
  expect((jet.near.materials.paint as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456')
  // Hidden close model does no gear work; it catches up when it is shown again.
  jet.setLevel(2); jet.update(0, 0); expect(jet.near.gearAmount).toBe(1)
  jet.setLevel(0); expect(jet.near.gearAmount).toBe(0)
  let visible = 0
  for (const o of jet.object.children) if (o.visible && o !== jet.plume.mesh && o !== jet.tailLights.mesh && (o instanceof THREE.Mesh || o.children.length)) visible++
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
    // Directions at the original's travel; larger looks swing the edges out of the regions picked.
    const saved = jetArticulation.value; jetArticulation.value = 1
    const jet = new GameJet(), controls = new THREE.Vector3()
    const pose = (pitch: number, roll: number, yaw: number) => { jet.update(0, .5, controls.set(pitch, roll, yaw)); return { ur: trailingEdge(jet, upperRight), ul: trailingEdge(jet, upperLeft), fr: trailingEdge(jet, flankRight) } }
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
    // Never more than the full travel (jet.articulation times 20 degrees), whatever the inputs add up to.
    const most = pose(1, 1, 1)
    expect(most.ur.distanceTo(rest.ur)).toBeLessThan(.75 * .38 * 2 * Math.sin(.35 * jetArticulation.value / 2) + .01)
    // Petals with the boom collars, and the flaps, are one draw each: five in flight, eight with the gear down.
    let draws = 0; jet.near.object.traverseVisible(o => { if (o instanceof THREE.Mesh) draws++ })
    expect(draws).toBeLessThanOrEqual(5)
    expect(jet.plume.mesh.parent).toBe(jet.object)
    jet.update(1, .5, controls.set(.5, 0, 0)); draws = 0
    jet.near.object.traverseVisible(o => { if (o instanceof THREE.Mesh) draws++ })
    expect(draws).toBeLessThanOrEqual(8)
    jet.dispose(); jetArticulation.value = saved
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

describe('Mk2 thrust plume', () => {
  it('starts every cone at a real nozzle or hover port of the built model', () => {
    const jet = new GameJet(), b = new Builder(.6, true, true); jet.design.build(b)
    // Reading the pieces builds the hull, which is when its nozzle is recorded.
    void b.pieces
    // Rear nozzles: the fittings are the model's own exits.
    expect(MK2_FITTINGS.nozzles).toHaveLength(b.nozzles.length)
    for (const n of MK2_FITTINGS.nozzles) {
      const match = b.nozzles.find(m => Math.hypot(m.x - n.x, m.y - n.y, m.z - n.z) < .02)
      expect(match, JSON.stringify(n)).toBeDefined(); expect(n.r).toBeCloseTo(match!.r, 2)
    }
    // Belly ports: Builder.hover is 12 cm below each port's face.
    expect(MK2_FITTINGS.ports).toHaveLength(b.hover.length)
    for (const p of MK2_FITTINGS.ports) expect(b.hover.some(([x, y, z]) => Math.hypot(x - p.x, y - p.y, z - p.z) < .03), JSON.stringify(p)).toBe(true)
    // And the cones' first rings sit within the throat: no glow away from a fitting.
    const position = jet.plume.mesh.geometry.attributes.position, where = jet.plume.mesh.geometry.attributes.plume
    for (let i = 0; i < position.count; i++) if (where.getX(i) === 0) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i)
      const fittings = where.getY(i) ? MK2_FITTINGS.ports : MK2_FITTINGS.nozzles
      expect(fittings.some(f => Math.hypot(v.x - f.x, v.y - f.y, v.z - f.z) < f.r + .15)).toBe(true)
    }
    b.pieces.forEach(q => q.geometry.dispose()); b.flaps.forEach(f => f.geometry.dispose()); jet.dispose()
  })

  it('glows at idle, grows with throttle, flares at full, and follows hover or flight', () => {
    const jet = new GameJet(), v = new THREE.Vector3()
    jet.update(1, 0, v, true)
    const idle = jet.plume.levels
    // Hover at rest: the belly ports show a short glow and the rear nozzles idle.
    expect(idle[3]).toBeGreaterThan(.3); expect(idle[1]).toBeGreaterThan(.2)
    jet.update(1, .6, v, true); const lift = jet.plume.levels
    expect(lift[2]).toBeGreaterThan(idle[2] * 2); expect(lift[3]).toBeGreaterThan(idle[3] * 2)
    // Flight: the rear cones carry it and the ports are dark.
    jet.update(0, .6, v, false); const cruise = jet.plume.levels
    expect(cruise[3]).toBe(0); expect(cruise[0]).toBeCloseTo(lift[2], 5)
    jet.update(0, 1, v, false); const full = jet.plume.levels
    // The last 15 percent of throttle adds a flare beyond the straight line.
    expect(full[1] - cruise[1]).toBeGreaterThan(1.1 * .4 + .5); expect(full[0]).toBeGreaterThan(1.2)
    // One draw, never culled short, coloured by the player's accent.
    expect(jet.plume.mesh.geometry.boundingSphere!.radius).toBeGreaterThan(8)
    jet.setColors('#123456', '#00ff80')
    expect((jet.plume.mesh.userData.plumeColor as THREE.Color).getHexString()).toBe('00ff80')
    jet.dispose()
  })
})


describe('Mk2 fitted tail lights',()=>{
 it('backs both red lenses with housings touching the outer nozzle lips',()=>{
  const jet=new GameJet(),g=jet.tailLights.mesh.geometry,p=g.attributes.position,mask=g.attributes.tailLens
  expect(g.index!.count/3).toBe(28)
  for(const n of MK2_FITTINGS.nozzles.filter(n=>n.x!==0)){
   const housing=new THREE.Box3(),lens=new THREE.Box3()
   for(let i=0;i<p.count;i++){
    const point=new THREE.Vector3().fromBufferAttribute(p,i)
    if(Math.abs(point.x-n.x)>.2)continue
    ;(mask.getX(i)>0?lens:housing).expandByPoint(point)
   }
   expect(housing.min.y).toBeLessThan(n.y+n.r)
   expect(housing.max.y).toBeGreaterThan(n.y+n.r)
   expect(housing.max.z).toBeCloseTo(n.z,5)
   expect(lens.min.z-housing.max.z).toBeCloseTo(.002,5)
   expect(lens.min.x).toBeGreaterThan(housing.min.x);expect(lens.max.x).toBeLessThan(housing.max.x)
   expect(lens.min.y).toBeGreaterThan(housing.min.y);expect(lens.max.y).toBeLessThan(housing.max.y)
  }
  const colors=Array.from(g.attributes.color.array)
  jet.setColors('#00ff00','#0000ff');jet.update(0,1)
  expect(Array.from(g.attributes.color.array)).toEqual(colors)
  for(const level of [0,1,2] as const){jet.setLevel(level);expect(jet.tailLights.mesh.visible).toBe(true)}
  jet.dispose()
 })
})
