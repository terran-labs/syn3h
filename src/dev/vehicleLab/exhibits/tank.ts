/**
 * Next-gen tank design studies (src/vehicles/tankDesigns). Round seven is the generator the game
 * tank uses (src/vehicles/Tank.ts, `tank.design`), shown here with the shared showroom shading
 * and its three detail levels. Rounds four to six are appearance studies kept as history.
 */
import * as THREE from 'three/webgpu'
import { designs as round4 } from '../../../vehicles/tankDesigns/designs'
import { round5 } from '../../../vehicles/tankDesigns/round5'
import { poseArm, round6 } from '../../../vehicles/tankDesigns/round6'
import { round7 } from '../../../vehicles/tankDesigns/round7'
import { round8, type TankBody } from '../../../vehicles/tankDesigns/round8'
import { ExpeditionTank } from '../../../vehicles/tankDesigns/expeditionKit'
import { makeMats, withDetail } from '../../../vehicles/tankDesigns/kit'
import { addHeadlightBeams } from '../materials'
import type { LabExhibit, LabModel } from '../types'

const ROUNDS = [{ group: '4', designs: round4, hinge: 'Six treads, each on one trailing arm from a single boss on the body' }, { group: '5', designs: round5, hinge: 'Tall cockpit, six big headlamps, a solid rear bumper beam' },
  { group: '6', designs: round6, hinge: 'Each tread on one heavy swing arm that is also its fender, with one coilover to a tower on the hull' },
  { group: '7', designs: round7, hinge: 'One continuous body and cockpit; six independent tread and fender assemblies on fixed hull pivots' },
  { group: '8', designs: round8, hinge: 'The original tank\'s scale: a low lofted body between six treads, one force field bubble, a pylon and swing arm to each tread' }]
const round4to6 = [...round4, ...round5, ...round6]

export const tank: LabExhibit = {
  // Listed with the other design studies in the lab's sidebar.
  section: 'Design studies',
  id: 'tank',
  title: 'Syn3h next-gen tank',
  groupLabel: 'Round',
  heading: group => group === '8' ? 'Round 8: ten takes on the original tank, in the buggy and jet\'s styling' : group === '7' ? 'Round 7: rejected exploration bodies' : group === '6' ? 'Round 6: rejected body studies' : group === '4' ? 'Syn3h next-gen tank: round 4, aerospace bodies on trailing arm treads' : 'Syn3h next-gen tank: round 5, tall cockpits, big lamps, solid bumpers',
  async designs() {
    return ROUNDS.flatMap(r => r.designs.map(d => ({ id: d.id, name: d.name, notes: [d.tagline, r.hinge], group: r.group })))
  },
  async build(info) {
    const generated = [...round8, ...round7].find(x => x.id === info.id)
    if (generated) return buildExpedition(generated)
    const d = round4to6.find(x => x.id === info.id)!, m = makeMats(d.color, d.accent), object = new THREE.Group()
    const levels = [withDetail(.34, () => d.build(m)), d.build(m)]
    levels[1].visible = false; object.add(...levels)
    // Each arm swings on its boss; the pod on its end counter-rotates to stay flat (designs.ts tread()).
    const arms: THREE.Object3D[] = []
    object.traverse(o => { if (o.userData.arm) arms.push(o) })
    return {
      object,
      // Tread lugs stand 0.05 m below the model's y = 0.
      groundY: -.05,
      lods: ['Budget', 'Study'],
      lodDistances: [1e6],
      setLod: index => levels.forEach((l, i) => { l.visible = i === index }),
      setColors: (body, accent) => { m.paintU.value.set(body); m.accentU.value.set(accent) },
      resetColors: () => { m.paintU.value.setHex(d.color); m.accentU.value.setHex(d.accent ?? 0xff5a12) },
      update(_dt, state) {
        m.lampU.value = state.headlights ? 1 : .3
        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i], phase = arm.userData.phase as number
          const swing = (arm.userData.arm as number) + (state.animate ? Math.sin(state.time * 1.5 + phase) * .13 : 0)
          // Swings the arm, keeps the pod level and re-aims the coilover where a design has one.
          poseArm(arm, swing, state.animate ? Math.sin(state.time * 1.1 + phase * 2) * .05 : 0)
        }
      },
      dispose() {
        object.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
        for (const x of Object.values(m)) if (x instanceof THREE.Material) x.dispose()
      },
    }
  },
}

/** A generated tank as the game builds it: shared shading, three detail levels, live treads. */
function buildExpedition(d: TankBody): LabModel {
  const tank = new ExpeditionTank(d.hull(), d.color, d.accent), object = new THREE.Group()
  object.add(tank.object)
  tank.showroom(() => {})
  const beams = addHeadlightBeams(object, [tank.headlamps[0], tank.headlamps[tank.headlamps.length / 2]])
  return {
    object,
    groundY: 0,
    cockpit: { eye: new THREE.Vector3(...tank.eye) },
    lods: ['Near', 'Mid', 'Far'],
    lodDistances: [30, 120],
    setLod: index => tank.setLevel(index as 0 | 1 | 2),
    setColors: (body, accent) => tank.setColors(body, accent),
    resetColors: () => tank.setColors(d.color, d.accent),
    update(_dt, state) {
      tank.setLights(state.braking, state.headlights)
      beams.update(state)
      for (let i = 0; i < 6; i++) {
        const phase = (i >> 1) * 1.7 + (i % 2 ? 0 : .9)
        // Each tread rides its own bump, tilts to it and runs its belt.
        if (state.animate) tank.setPod(i, Math.sin(state.time * 1.5 + phase) * .14, Math.sin(state.time + phase) * .05, state.time * 2.5 * (1 + state.throttle))
        else tank.setPod(i, 0, 0, 0)
      }
      tank.pose()
    },
    dispose() { beams.dispose(); tank.dispose() },
  }
}
