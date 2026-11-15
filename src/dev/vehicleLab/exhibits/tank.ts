/**
 * Next-gen tank design studies (src/vehicles/tankDesigns). Appearance only: the game's tank is
 * still the Mars Explorer port in src/vehicles/Tank.ts. Earlier rounds are in git history.
 */
import * as THREE from 'three/webgpu'
import { designs as round4 } from '../../../vehicles/tankDesigns/designs'
import { round5 } from '../../../vehicles/tankDesigns/round5'
import { poseArm, round6 } from '../../../vehicles/tankDesigns/round6'
import { round7 } from '../../../vehicles/tankDesigns/round7'
import { buildExpedition, poseExpeditionArm } from '../../../vehicles/tankDesigns/expeditionKit'
import { makeMats, withDetail } from '../../../vehicles/tankDesigns/kit'
import { addHeadlightBeams } from '../materials'
import type { LabExhibit } from '../types'

const ROUNDS = [{ group: '4', designs: round4, hinge: 'Six treads, each on one trailing arm from a single boss on the body' }, { group: '5', designs: round5, hinge: 'Tall cockpit, six big headlamps, a solid rear bumper beam' },
  { group: '6', designs: round6, hinge: 'Each tread on one heavy swing arm that is also its fender, with one coilover to a tower on the hull' },
  { group: '7', designs: round7, hinge: 'One continuous body and cockpit; six independent tread and fender assemblies on fixed hull pivots' }]
const all = ROUNDS.flatMap(r => r.designs)

export const tank: LabExhibit = {
  // Listed with the other design studies in the lab's sidebar.
  section: 'Design studies',
  id: 'tank',
  title: 'Syn3h next-gen tank',
  groupLabel: 'Round',
  heading: group => group === '7' ? 'Ten exploration tanks: industrial, lunar and extreme environments' : group === '6' ? 'Round 6: rejected body studies' : group === '4' ? 'Syn3h next-gen tank: round 4, aerospace bodies on trailing arm treads' : 'Syn3h next-gen tank: round 5, tall cockpits, big lamps, solid bumpers',
  async designs() {
    return ROUNDS.flatMap(r => r.designs.map(d => ({ id: d.id, name: d.name, notes: [d.tagline, r.hinge], group: r.group })))
  },
  async build(info) {
    const d = all.find(x => x.id === info.id)!, m = makeMats(d.color, d.accent), object = new THREE.Group()
    const expedition = round7.find(x => x.id === info.id)
    // The new shell keeps its authored silhouette at both levels. Only tread tessellation varies.
    const levels = expedition
      ? [.34, 1].map(detail => buildExpedition(m, expedition.spec, detail))
      : [withDetail(.34, () => d.build(m)), d.build(m)]
    levels[1].visible = false; object.add(...levels)
    // Each arm swings on its boss; the pod on its end counter-rotates to stay flat (designs.ts tread()).
    const arms: THREE.Object3D[] = []
    object.traverse(o => { if (o.userData.arm || o.userData.expeditionArm) arms.push(o) })
    const front = expedition?.spec.sections[0]
    const beams = front ? addHeadlightBeams(object, [-.8, .8].map(x => new THREE.Vector3(x, (front[2] + front[3]) * .5 + .12, front[0] - .14))) : undefined
    return {
      object,
      // Tread lugs stand 0.05 m below the model's y = 0.
      groundY: expedition ? 0 : -.05,
      cockpit: expedition ? { eye: new THREE.Vector3(...levels[0].userData.eye as [number, number, number]) } : undefined,
      lods: expedition ? ['Design', 'Fine treads'] : ['Budget', 'Study'],
      lodDistances: [1e6],
      setLod: index => levels.forEach((l, i) => { l.visible = i === index }),
      setColors: (body, accent) => { m.paintU.value.set(body); m.accentU.value.set(accent) },
      resetColors: () => { m.paintU.value.setHex(d.color); m.accentU.value.setHex(d.accent ?? 0xff5a12) },
      update(_dt, state) {
        m.lampU.value = state.headlights ? 1 : .3
        beams?.update(state)
        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i], phase = arm.userData.phase as number
          if (arm.userData.expeditionArm) {
            poseExpeditionArm(arm, state.animate ? Math.sin(state.time * 1.5 + phase) * .16 : 0, state.animate ? Math.sin(state.time + phase) * .035 : 0)
            continue
          }
          const swing = (arm.userData.arm as number) + (state.animate ? Math.sin(state.time * 1.5 + phase) * .13 : 0)
          // Swings the arm, keeps the pod level and re-aims the coilover where a design has one.
          poseArm(arm, swing, state.animate ? Math.sin(state.time * 1.1 + phase * 2) * .05 : 0)
        }
      },
      dispose() {
        beams?.dispose()
        object.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
        for (const x of Object.values(m)) if (x instanceof THREE.Material) x.dispose()
      },
    }
  },
}
