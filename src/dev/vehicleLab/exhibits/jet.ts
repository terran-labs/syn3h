/**
 * Jet exhibit: the generated next-generation jet designs from src/vehicles/jetgen, in six
 * review rounds. Each design is built twice, at full and reduced polygon count, as its two
 * detail levels. They render through the shared vehicle shading, like every other vehicle.
 */
import * as THREE from 'three/webgpu'
import { JET_DESIGNS } from '../../../vehicles/jetgen/designs'
import { GameJet } from '../../../vehicles/jetgen/GameJet'
import { NextJet } from '../../../vehicles/jetgen/NextJet'
import { GROUND_Y } from '../../../vehicles/jetgen/shapes'
import type { LabExhibit } from '../types'

const ROUNDS = ['1', '2', '3', '4', '5', '6']
const ROUND_TITLES = ['first designs after the red reference', 'forward-swept wings with arch tails', 'military hybrids of Scimitar and Halo', 'Vanguard with intakes around the fuselage', 'variations on the Vanguard Quad', 'the Hexring as one lofted body']

export const jet: LabExhibit = {
  // Listed with the other design studies in the lab's sidebar.
  section: 'Design studies',
  id: 'jet',
  title: 'Mira jet',
  groupLabel: 'Round',
  heading: group => `Mira jet: round ${group ?? 6}, ${ROUND_TITLES[Number(group ?? 6) - 1] ?? ''}`,
  async designs() {
    return JET_DESIGNS.map((d, i) => ({ id: d.id, name: d.name, notes: [d.blurb], group: ROUNDS[i < 20 ? Math.floor(i / 5) : i < 24 ? 4 : 5] }))
  },
  async build(info) {
    const design = JET_DESIGNS.find(d => d.id === info.id)!
    if (design.id === 'hex-mk2') {
      // The lab measures a model when it is built, so the close level must exist by then.
      const jet = new GameJet(); jet.attach(); jet.setLevel(0)
      let gearDown = true, gear = 1
      const controls = new THREE.Vector3()
      return {
        object: jet.object,
        groundY: GROUND_Y,
        lods: ['Close', 'Medium', 'Silhouette'],
        lodDistances: [30, 120],
        setLod(index) { jet.setLevel(Math.max(0, Math.min(2, index)) as 0 | 1 | 2) },
        setColors(body, accent) { jet.setColors(body, accent) },
        resetColors() { jet.setColors(design.paint, design.accent) },
        update(dt, state) {
          const target = state.animate ? (Math.floor(state.time / 5) % 2 === 0 ? 1 : 0) : gearDown ? 1 : 0
          gear += Math.sign(target - gear) * Math.min(Math.abs(target - gear), dt * .7)
          // Stick back is nose up: the exhausts turn up and the ring's surfaces rise (GameJet.articulate).
          controls.set(-state.pitch, state.steer, state.yaw)
          jet.update(gear, state.animate ? Math.max(0, state.throttle) : .4, controls, gear >= .5)
        },
        cockpit: { eye: jet.eye.clone() },
        controls: [{ kind: 'toggle', id: 'jet.gear', label: 'Landing gear', value: true, onChange: on => { gearDown = on } }],
        dispose() { jet.dispose() },
      }
    }
    const levels = [new NextJet(design, 1), new NextJet(design, .5)]
    const object = new THREE.Group()
    levels.forEach((j, i) => { j.object.visible = i === 0; object.add(j.object); j.showroom() })
    let gearDown = true, gear = 1
    return {
      object,
      groundY: GROUND_Y,
      lods: ['Full', 'Reduced'],
      lodDistances: [40],
      setLod(index) { levels.forEach((j, i) => { j.object.visible = i === index }) },
      setColors(body, accent) { levels.forEach(j => j.setColors(body, accent)) },
      resetColors() { levels.forEach(j => j.setColors(design.paint, design.accent)) },
      update(dt, state) {
        // With Motion on the gear cycles and the main nozzle follows the steering and throttle.
        const target = state.animate ? (Math.floor(state.time / 5) % 2 === 0 ? 1 : 0) : gearDown ? 1 : 0
        gear += Math.sign(target - gear) * Math.min(Math.abs(target - gear), dt * .7)
        for (const j of levels) {
          j.setGear(gear); j.setThrottle(state.animate ? state.throttle : .4)
          j.setVector(-state.pitch * .3, state.steer * .06 + state.yaw * .26)
          j.setControls(-state.pitch, state.steer, state.yaw)
        }
      },
      cockpit: levels[0].ridePosition ? { eye: levels[0].ridePosition.position.clone() } : undefined,
      controls: [{ kind: 'toggle', id: 'jet.gear', label: 'Landing gear', value: true, onChange: on => { gearDown = on } }],
      dispose() { levels.forEach(j => j.dispose()) },
    }
  },
}
