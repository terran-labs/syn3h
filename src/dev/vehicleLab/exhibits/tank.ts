/**
 * Next-gen tank design studies (src/vehicles/tankDesigns). Appearance only: the game's tank is
 * still the Mars Explorer port in src/vehicles/Tank.ts. Earlier rounds are in git history.
 */
import * as THREE from 'three/webgpu'
import { designs as round4 } from '../../../vehicles/tankDesigns/designs'
import { round5 } from '../../../vehicles/tankDesigns/round5'
import { makeMats } from '../../../vehicles/tankDesigns/kit'
import type { LabExhibit } from '../types'

const ROUNDS = [{ group: '4', designs: round4, hinge: 'Six treads, each on one trailing arm from a single boss on the body' }, { group: '5', designs: round5, hinge: 'Tall cockpit, six big headlamps, a solid rear bumper beam' }]
const all = ROUNDS.flatMap(r => r.designs)

export const tank: LabExhibit = {
  id: 'tank',
  title: 'Syn3h next-gen tank',
  groupLabel: 'Round',
  heading: group => group === '4' ? 'Syn3h next-gen tank: round 4, aerospace bodies on trailing arm treads' : 'Syn3h next-gen tank: round 5, tall cockpits, big lamps, solid bumpers',
  async designs() {
    return ROUNDS.flatMap(r => r.designs.map(d => ({ id: d.id, name: d.name, notes: [d.tagline, r.hinge], group: r.group })))
  },
  async build(info) {
    const d = all.find(x => x.id === info.id)!, m = makeMats(d.color), object = d.build(m)
    // Each arm swings on its boss; the pod on its end counter-rotates to stay flat (designs.ts tread()).
    const arms: THREE.Object3D[] = [], pods: THREE.Object3D[] = []
    object.traverse(o => { if (o.userData.arm) { arms.push(o); pods.push(o.children.find(c => c.userData.pod)!) } })
    return {
      object,
      // Tread lugs stand 0.05 m below the model's y = 0.
      groundY: -.05,
      setColors: body => { m.paintU.value.set(body) },
      resetColors: () => { m.paintU.value.setHex(d.color) },
      update(_dt, state) {
        m.lampU.value = state.headlights ? 1 : .3
        for (let i = 0; i < arms.length; i++) {
          const arm = arms[i], phase = arm.userData.phase as number
          const swing = (arm.userData.arm as number) + (state.animate ? Math.sin(state.time * 1.5 + phase) * .13 : 0)
          arm.rotation.x = swing
          pods[i].rotation.x = -swing + (state.animate ? Math.sin(state.time * 1.1 + phase * 2) * .05 : 0)
        }
      },
      dispose() {
        object.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
        for (const x of Object.values(m)) if (x instanceof THREE.Material) x.dispose()
      },
    }
  },
}
