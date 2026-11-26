/**
 * The jet's size (the owner, 26 November 2026: "Size the jet to be 6 meters long"). The
 * generated Mk2 is drawn at its design size; everything about the jet is scaled by
 * jetScale(): the model at every detail level, its plumes and lights, the collider, gear,
 * nozzle, eye, camera distance and effect points (Jet.ts, effects/index.ts). Mass and inertia
 * are not: they stay the original's, so the jet handles the same at any size.
 *
 * The factor comes from the generated model's own length, measured once from its geometry,
 * so the jet stays jet.length long if the design changes.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../../shared/params'
import { NextJet } from './NextJet'
import { SHIPPED_JET } from './shipped'

/** Overall length, nose tip to rearmost point with the gear up, metres. Applies to jets built after a change. */
export const jetLength = defineParam<number>({ id: 'jet.length', label: 'Jet length (m)', group: 'Jet', scope: 'world', default: 6, min: 4, max: 9, step: .1 })

let designLength: number | null = null
/** The generated design's own length (gear up), metres, measured from its geometry once. */
export function measuredJetLength(): number {
  if (designLength === null) {
    const jet = new NextJet(SHIPPED_JET, .1)
    jet.setGear(0)
    jet.object.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(jet.object, true)
    designLength = box.max.z - box.min.z
    jet.object.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.() })
  }
  return designLength
}

/** The uniform scale that makes the jet jet.length long. */
export function jetScale(): number {
  return jetLength.value / measuredJetLength()
}
