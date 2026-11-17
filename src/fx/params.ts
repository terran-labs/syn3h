import { defineParam } from '../../shared/params'
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01) =>
  defineParam({ id: `lava.${id}`, label, group: 'Lava', scope: 'world', default: value, min, max, step })
export const flowSpeed = number('flowSpeed', 'Flow speed', 0.6, 0, 10)
export const flowDirection = number('flowDirection', 'Flow direction', 0.7, -Math.PI, Math.PI)
export const crustAmount = number('crust', 'Cooling crust', 0.4, 0, 1)
export const glowIntensity = number('glow', 'Molten glow', 4, 0, 12)
export const glowRed = number('red', 'Molten red', 1, 0, 1)
export const glowGreen = number('green', 'Molten green', 0.16, 0, 1)
export const glowBlue = number('blue', 'Molten blue', 0.005, 0, 1)
export const noiseScale = number('scale', 'Crust scale', 0.3, 0.01, 2)
export const windX = number('windX', 'Wind east', 0.8, -10, 10)
export const windZ = number('windZ', 'Wind south', 0.3, -10, 10)
export const particleBudget = defineParam({ id: 'lava.particleBudget', label: 'Particle budget', group: 'Lava', scope: 'client', default: 2400, min: 0, max: 4800, step: 48, deferred: true })
/** Flames licking up from open lava in drifting patches: how many and how tall. 0 turns them off. */
export const lavaFire = defineParam({ id: 'lava.fire', label: 'Flames on lava', group: 'Lava', scope: 'world', default: 1, min: 0, max: 2, step: 0.05 })
/** Embers and sparks rising from lava and its shore. 0 turns them off. */
export const lavaEmbers = defineParam({ id: 'lava.embers', label: 'Embers and sparks', group: 'Lava', scope: 'world', default: 1, min: 0, max: 2, step: 0.05 })

/**
 * How the lava particle budget (the smaller of lava.particleBudget and the quality level's
 * particles) is shared. Vents keep the larger part; the flames, embers and shore sparks over
 * open lava take the rest. Shares sum to at most one, so together they never exceed the budget.
 */
export const PARTICLE_SHARES = { vents: 0.6, ambient: 0.4 } as const
