/**
 * The push an energy impact gives to vehicles near it. World scope; free of Three.js so the
 * room server can import and clamp them.
 *
 * Each item has a radius (metres), a push (the speed change, m/s, at the centre of the
 * blast, falling smoothly to nothing at the radius) and a lift (the share of the push added
 * straight up, so things hop and tumble instead of sliding).
 */
import { defineParam } from '../../shared/params'

const group = 'Gear: Impact push'
const scope = 'world' as const

/** Off switch for the whole room. */
export const blastAllowed = defineParam({ id: 'blast.allowed', label: 'Impacts push vehicles', group, scope, default: true })

export const tagBlastRadius = defineParam({ id: 'blast.tag.radius', label: 'Plasma Tag push radius', group, scope, default: 4, min: 0, max: 15, step: 0.5 })
export const tagBlastPush = defineParam({ id: 'blast.tag.push', label: 'Plasma Tag push', group, scope, default: 2.5, min: 0, max: 10, step: 0.5 })
export const tagBlastLift = defineParam({ id: 'blast.tag.lift', label: 'Plasma Tag lift', group, scope, default: 0.3, min: 0, max: 1, step: 0.05 })

export const chaserBlastRadius = defineParam({ id: 'blast.chaser.radius', label: 'Chaser push radius', group, scope, default: 5, min: 0, max: 15, step: 0.5 })
export const chaserBlastPush = defineParam({ id: 'blast.chaser.push', label: 'Chaser push', group, scope, default: 4, min: 0, max: 12, step: 0.5 })
export const chaserBlastLift = defineParam({ id: 'blast.chaser.lift', label: 'Chaser lift', group, scope, default: 0.35, min: 0, max: 1, step: 0.05 })

export const thunderBlastRadius = defineParam({ id: 'blast.thunder.radius', label: 'Plasma Thunder push radius', group, scope, default: 14, min: 0, max: 30, step: 1 })
export const thunderBlastPush = defineParam({ id: 'blast.thunder.push', label: 'Plasma Thunder push', group, scope, default: 16, min: 0, max: 20, step: 0.5 })
export const thunderBlastLift = defineParam({ id: 'blast.thunder.lift', label: 'Plasma Thunder lift', group, scope, default: 0.8, min: 0, max: 1, step: 0.05 })

export type BlastKind = 'tag' | 'chaser' | 'thunder'

export interface BlastSpec { radius: number; push: number; lift: number }

/** The room's current numbers for one kind of impact. */
export function blastSpec(kind: BlastKind): BlastSpec {
  if (kind === 'thunder') return { radius: thunderBlastRadius.value, push: thunderBlastPush.value, lift: thunderBlastLift.value }
  if (kind === 'chaser') return { radius: chaserBlastRadius.value, push: chaserBlastPush.value, lift: chaserBlastLift.value }
  return { radius: tagBlastRadius.value, push: tagBlastPush.value, lift: tagBlastLift.value }
}

/** No single impact changes a vehicle's speed by more than this, m/s, whatever the sliders say. */
export const BLAST_MAX = 20
/** Nor do all impacts together, within BLAST_WINDOW seconds, by more than this. */
export const BLAST_BUDGET = 30
export const BLAST_WINDOW = 0.5
