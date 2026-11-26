import { defineParam } from '../../../shared/params'

const P = { group: 'Graphics', scope: 'client' } as const

/** Requested inner lane radius, capped by the physical space available inside the outer orbit. */
export const orbitInnerRadius = defineParam({
  ...P, id: 'lobby.orbitInnerRadius', label: 'Lobby orbits: inner radius',
  default: 4.02, min: 1.4, max: 4.02, step: 0.01,
})

/** Fraction by which the outermost gap is smaller than the innermost gap. */
export const orbitGapTaper = defineParam({
  ...P, id: 'lobby.orbitGapTaper', label: 'Lobby orbits: outer gap compression',
  default: 0.25, min: 0.05, max: 0.35, step: 0.01,
})

/** Physical gap between neighboring lane envelopes, including their moons. */
export const orbitMinGap = defineParam({
  ...P, id: 'lobby.orbitMinGap', label: 'Lobby orbits: minimum physical gap',
  default: 0.02, min: 0.005, max: 0.05, step: 0.001,
})
