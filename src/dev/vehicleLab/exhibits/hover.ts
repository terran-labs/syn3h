/**
 * Hovercraft exhibit: the generated next-generation hovercraft studies from
 * src/vehicles/hovergen. Each design is generated twice, to the vehicle pattern's near and mid
 * triangle budgets (12,000 and 2,500), as its two detail levels. The materials are the designs'
 * own (candy, military or aerospace finish).
 *
 * The craft has no ground contact, so the exhibit floats it over the studio floor: the Hover
 * slider sets the gap under the hull (the game rides at 2.5 m, which is too high to judge a
 * body in a studio). With Motion on it bobs on its cushion, banks into the steering as the
 * assisted glide does (hover.bank, 12 degrees), and swivels its thruster.
 */
import * as THREE from 'three/webgpu'
import { EYE, HOVER_DESIGNS } from '../../../vehicles/hovergen/designs'
import { hoverLevels } from '../../../vehicles/hovergen/NextHover'
import { addHeadlightBeams } from '../materials'
import type { LabExhibit } from '../types'

const BANK = 12 * Math.PI / 180

export const hover: LabExhibit = {
  id: 'hover',
  title: 'Syn3h hovercraft',
  section: 'Design studies',
  groupLabel: 'Round',
  heading: () => 'Syn3h hovercraft: round 1, five bodies on the current hull\'s footprint',
  async designs() {
    return HOVER_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.blurb, 'Fits the current collision hull; four lift ports, one swivelling thruster, glass over the ride camera'], group: '1' }))
  },
  async build(info) {
    const design = HOVER_DESIGNS.find(d => d.id === info.id)!
    const levels = hoverLevels(design)
    // The lab owns `object`'s position (it lifts it by groundY), so the craft floats in `craft`.
    const object = new THREE.Group(), craft = new THREE.Group()
    object.add(craft)
    levels.forEach((h, i) => { h.object.visible = i === 0; craft.add(h.object) })
    const beams = addHeadlightBeams(craft, design.lamps.head.flatMap(([x, y, z]) => [new THREE.Vector3(x, y, z), new THREE.Vector3(-x, y, z)]))
    let gap = .45
    return {
      object,
      groundY: 0,
      lods: ['Near', 'Mid'],
      lodDistances: [30],
      setLod(index) { levels.forEach((h, i) => { h.object.visible = i === index }) },
      setColors(body, accent) { levels.forEach(h => h.setColors(body, accent)) },
      resetColors() { levels.forEach(h => h.setColors(design.paint, design.accent)) },
      update(_dt, state) {
        const live = state.animate
        craft.position.y = gap + (live ? Math.sin(state.time * 1.7) * .035 : 0)
        // Bank into the turn and lift the nose a little under thrust, as the glide does.
        craft.rotation.z = live ? -state.steer * BANK : 0
        craft.rotation.x = live ? state.throttle * .04 + Math.sin(state.time * 1.1) * .012 : 0
        for (const h of levels) {
          h.setThrottle(live ? state.throttle : .45)
          h.setVector(live ? state.steer * .45 : 0)
          h.setLights(state.headlights, state.braking)
        }
        beams.update(state)
      },
      cockpit: { eye: new THREE.Vector3(...EYE).setY(EYE[1] + gap), hide: levels.flatMap(h => h.object.children.filter(o => o.name === 'hover-glass')) },
      controls: [{ kind: 'slider', id: 'hover.gap', label: 'Hover', min: .05, max: 2.5, step: .05, value: gap, onChange: v => { gap = v } }],
      dispose() { beams.dispose(); levels.forEach(h => h.dispose()) },
    }
  },
}
