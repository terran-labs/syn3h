import { defineParam } from '../../shared/params'
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01) =>
  defineParam({ id: `lava.${id}`, label, group: 'Lava', scope: 'world', default: value, min, max, step })
export const flowSpeed = number('flowSpeed', 'Flow speed', 0.6, 0, 10)
export const flowDirection = number('flowDirection', 'Flow direction', 0.7, -Math.PI, Math.PI)
export const crustAmount = number('crust', 'Cooling crust', 0.65, 0, 1)
export const glowIntensity = number('glow', 'Molten glow', 3, 0, 12)
export const glowRed = number('red', 'Molten red', 1, 0, 1)
export const glowGreen = number('green', 'Molten green', 0.16, 0, 1)
export const glowBlue = number('blue', 'Molten blue', 0.005, 0, 1)
export const noiseScale = number('scale', 'Crust scale', 0.3, 0.01, 2)
export const windX = number('windX', 'Wind east', 0.8, -10, 10)
export const windZ = number('windZ', 'Wind south', 0.3, -10, 10)
export const particleBudget = defineParam({ id: 'lava.particleBudget', label: 'Particle budget', group: 'Lava', scope: 'client', default: 2400, min: 0, max: 4800, step: 48, deferred: true })
