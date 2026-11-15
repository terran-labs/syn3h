/**
 * Hovercraft exhibit: the generated next-generation hovercraft studies from
 * src/vehicles/hovergen. Round one retains its two detail levels and original materials.
 * Round two follows the original proportions with shared materials and three detail levels.
 *
 * The craft has no ground contact, so the exhibit floats it over the studio floor: the Hover
 * slider sets the gap under the hull (the game rides at 2.5 m, which is too high to judge a
 * body in a studio). With Motion on it bobs on its cushion, banks into the steering as the
 * assisted glide does (hover.bank, 12 degrees), and swivels its thruster.
 */
import * as THREE from 'three/webgpu'
import { EYE, HOVER_DESIGNS } from '../../../vehicles/hovergen/designs'
import { hoverLevels } from '../../../vehicles/hovergen/NextHover'
import { HERITAGE_DESIGNS, HERITAGE_EYE } from '../../../vehicles/hovergen/heritage'
import { HeritageHover } from '../../../vehicles/hovergen/HeritageHover'
import { addHeadlightBeams } from '../materials'
import type { LabExhibit, LabModel } from '../types'

const BANK = 12 * Math.PI / 180

export const hover: LabExhibit = {
  id: 'hover',
  title: 'Syn3h hovercraft',
  section: 'Design studies',
  groupLabel: 'Round',
  heading: group => group === '2' ? 'Syn3h hovercraft: round 2, original proportions and buggy details' : 'Syn3h hovercraft: round 1, five bodies on the current hull\'s footprint',
  async designs() {
    return [
      ...HOVER_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.blurb, 'Fits the current collision hull; four lift ports, one swivelling thruster, glass over the ride camera'], group: '1' })),
      ...HERITAGE_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.notes, 'Sized alongside the 4.01 m long, 2.69 m wide buggy. Shared materials, cockpit and three detail levels.'], group: '2' })),
    ]
  },
  async build(info) {
    if (info.group === '2') return buildRoundTwo(info.id)
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

function buildRoundTwo(id: string): LabModel {
  const design = HERITAGE_DESIGNS.find(d => d.id === id)!
  const levels = ([0, 1, 2] as const).map(level => new HeritageHover(design, level))
  const object = new THREE.Group(), craft = new THREE.Group()
  object.add(craft)
  levels.forEach((h, i) => { h.object.visible = i === 0; craft.add(h.object) })
  const beams = addHeadlightBeams(craft, [-.76, .76].map(x => new THREE.Vector3(x, .30, -1.79)))
  let gap = .30
  const eye = new THREE.Vector3(...HERITAGE_EYE).add(new THREE.Vector3(0, gap, 0))
  return {
    object, groundY: 0, lods: ['Near', 'Mid', 'Far'], lodDistances: [30, 120],
    setLod(index) { levels.forEach((h, i) => { h.object.visible = i === index }) },
    setColors(body, accent) { levels.forEach(h => h.setColors(body, accent)) },
    resetColors() { levels.forEach(h => h.setColors(design.paint, design.accent)) },
    update(_dt, state) {
      craft.position.y = gap + (state.animate ? Math.sin(state.time * 1.7) * .035 : 0)
      craft.rotation.z = state.animate ? -state.steer * BANK : 0
      craft.rotation.x = state.animate ? state.throttle * .04 : 0
      for (const h of levels) {
        h.setVector(state.animate ? state.steer * .35 : 0)
        h.setThrottle(state.animate ? state.throttle : .45)
        h.setLights(state.headlights, state.braking)
      }
      beams.update(state)
    },
    cockpit: { eye },
    controls: [{ kind: 'slider', id: 'hover.gap', label: 'Hover', min: .05, max: 2.5, step: .05, value: gap, onChange: v => { gap = v; eye.y = HERITAGE_EYE[1] + gap } }],
    dispose() { beams.dispose(); levels.forEach(h => h.dispose()) },
  }
}
