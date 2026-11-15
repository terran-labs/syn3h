/**
 * Next-gen tank design studies (src/vehicles/tankDesigns). Appearance only: the game's tank is
 * still the Mars Explorer port in src/vehicles/Tank.ts. Earlier rounds are in git history.
 */
import * as THREE from 'three/webgpu'
import { designs } from '../../../vehicles/tankDesigns/designs'
import { makeMats } from '../../../vehicles/tankDesigns/kit'
import type { LabExhibit } from '../types'

const ROUND = '4'

export const tank: LabExhibit = {
  // Listed with the other design studies in the lab's sidebar.
  section: 'Design studies',
  id: 'tank',
  title: 'Syn3h next-gen tank',
  groupLabel: 'Round',
  heading: () => 'Syn3h next-gen tank: round 4, aerospace bodies on trailing arm treads',
  async designs() {
    return designs.map(d => ({ id: d.id, name: d.name, notes: [d.tagline, 'Six treads, each on one trailing arm from a single boss on the body'], group: ROUND }))
  },
  async build(info) {
    const d = designs.find(x => x.id === info.id)!, m = makeMats(d.color), object = d.build(m)
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
