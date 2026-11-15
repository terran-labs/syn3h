/**
 * Hovercraft exhibit: the generated next-generation hovercraft studies from
 * src/vehicles/hovergen. Round one retains its two detail levels and original materials.
 * Round two follows the original proportions with shared materials and three detail levels.
 * Round three keeps those proportions and builds every fitting into the hull (round3.ts).
 * Round four is five variations on the owner's picks from round three (round4.ts).
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
import { R3_DESIGNS, R3_EYE } from '../../../vehicles/hovergen/round3'
import { Round3Hover, type HoverSpec } from '../../../vehicles/hovergen/Round3Hover'
import { R4_DESIGNS, buildRound4, round4Far } from '../../../vehicles/hovergen/round4'
import type { LabExhibit, LabModel } from '../types'

const BANK = 12 * Math.PI / 180

export const hover: LabExhibit = {
  id: 'hover',
  title: 'Syn3h hovercraft',
  section: 'Design studies',
  groupLabel: 'Round',
  heading: group => group === '4' ? 'Syn3h hovercraft: round 4, five variations on the red one\'s duct and intakes with the silver one\'s wing' : group === '3' ? 'Syn3h hovercraft: round 3, ten explorations with every fitting built into the hull' : group === '2' ? 'Syn3h hovercraft: round 2, original proportions and buggy details' : 'Syn3h hovercraft: round 1, five bodies on the current hull\'s footprint',
  async designs() {
    return [
      ...HOVER_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.blurb, 'Fits the current collision hull; four lift ports, one swivelling thruster, glass over the ride camera'], group: '1' })),
      ...HERITAGE_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.notes, 'Sized alongside the 4.01 m long, 2.69 m wide buggy. Shared materials, cockpit and three detail levels.'], group: '2' })),
      ...R3_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.notes, 'Original proportions at buggy size. Lamps, vents and wing supports are part of the hull. Cockpit and three detail levels.'], group: '3' })),
      ...R4_DESIGNS.map(d => ({ id: d.id, name: d.name, notes: [d.notes, 'The deck rises in a coaming round the cockpit. Lamps follow the nose outline, lift ports sit in belly blisters, and the thruster is the end of its cowl, closed behind the glow.'], group: '4' })),
    ]
  },
  async build(info) {
    if (info.group === '4') {
      const d = R4_DESIGNS.find(x => x.id === info.id)!
      const spec: HoverSpec = { id: d.id, paint: d.paint, accent: d.accent, build: detail => buildRound4(d, detail), far: () => round4Far(d) }
      return buildStudy(spec, R3_EYE, (x, level) => new Round3Hover(x, level), h => h.beams.map(p => new THREE.Vector3(...p)))
    }
    if (info.group === '3') return buildStudy(R3_DESIGNS.find(d => d.id === info.id)!, R3_EYE, (d, level) => new Round3Hover(d, level), h => h.beams.map(p => new THREE.Vector3(...p)))
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
  return buildStudy(HERITAGE_DESIGNS.find(d => d.id === id)!, HERITAGE_EYE, (d, level) => new HeritageHover(d, level), () => [-.76, .76].map(x => new THREE.Vector3(x, .30, -1.79)))
}

/** What the lab needs from a study at one detail level. Rounds two and three both provide it. */
interface StudyLevel {
  object: THREE.Object3D
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void
  setVector(yaw: number): void; setThrottle(amount: number): void; setLights(on: boolean, braking: boolean): void
  dispose(): void
}

function buildStudy<D extends { paint: number; accent: number }, H extends StudyLevel>(design: D, eyeAt: readonly [number, number, number], make: (design: D, level: 0 | 1 | 2) => H, lamps: (near: H) => THREE.Vector3[]): LabModel {
  const levels = ([0, 1, 2] as const).map(level => make(design, level))
  const object = new THREE.Group(), craft = new THREE.Group()
  object.add(craft)
  levels.forEach((h, i) => { h.object.visible = i === 0; craft.add(h.object) })
  const beams = addHeadlightBeams(craft, lamps(levels[0]))
  let gap = .30
  const eye = new THREE.Vector3(...eyeAt).add(new THREE.Vector3(0, gap, 0))
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
    controls: [{ kind: 'slider', id: 'hover.gap', label: 'Hover', min: .05, max: 2.5, step: .05, value: gap, onChange: v => { gap = v; eye.y = eyeAt[1] + gap } }],
    dispose() { beams.dispose(); levels.forEach(h => h.dispose()) },
  }
}
