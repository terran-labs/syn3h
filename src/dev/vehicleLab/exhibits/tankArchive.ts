/** Earlier tank generators, kept with their original kits so later kit edits cannot alter them. */
import * as THREE from 'three/webgpu'
import { designs as round2 } from '../archive/tank/round2/designs'
import { makeMats as mats2 } from '../archive/tank/round2/kit'
import { designs as round3 } from '../archive/tank/round3/designs'
import { makeMats as mats3 } from '../archive/tank/round3/kit'
import type { LabExhibit } from '../types'

export const tankArchive: LabExhibit = {
  id: 'tank-archive',
  title: 'Mira tank: earlier studies',
  section: 'Design studies',
  groupLabel: 'Round',
  paramGroups: [],
  heading: group => `Mira tank: archived round ${group ?? '3'}`,
  async designs() {
    return [round2, round3].flatMap((round, i) => round.map(d => ({
      id: `r${i + 2}-${d.id}`, name: d.name, notes: [d.tagline, 'Original procedural study, before the shared vehicle pattern'], group: String(i + 2),
    })))
  },
  async build(info) {
    const isRound2 = info.group === '2', list = isRound2 ? round2 : round3
    const design = list.find(d => `r${isRound2 ? 2 : 3}-${d.id}` === info.id)!
    // Round 3's kit adds tail lamps; keeping that material is harmless for round 2's builder.
    const original = isRound2 ? mats2(design.color) : mats3(design.color)
    const m = 'tail' in original ? original : { ...original, tail: original.glow }
    const object = design.build(m), pods: THREE.Object3D[] = []
    object.traverse(o => { if (o.userData.pod) pods.push(o) })
    return {
      object, groundY: -.05,
      setColors(body, accent) {
        (m.paint as THREE.MeshStandardMaterial).color.set(body);
        (m.accent as THREE.MeshStandardMaterial).color.set(accent)
      },
      resetColors() {
        (m.paint as THREE.MeshStandardMaterial).color.setHex(design.color);
        (m.accent as THREE.MeshStandardMaterial).color.setHex(isRound2 ? 0x15171a : 0xff5a12)
      },
      update(_dt, state) {
        for (const pod of pods) pod.rotation.x = state.animate ? Math.sin(state.time * 1.5 + (pod.userData.phase as number)) * .12 : 0
      },
      dispose() {
        const geometries = new Set<THREE.BufferGeometry>()
        object.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry) })
        geometries.forEach(g => g.dispose())
        new Set(Object.values(m)).forEach(material => material.dispose())
      },
    }
  },
}
