/**
 * Tag beam parameters. Players see "tag beams": a harmless beam that tags whoever it touches.
 * The ids, file names and protocol keep the older word "laser"; only labels changed.
 * Kept free of Three.js so the room server can import and validate them.
 * Defaults and ranges are the original's (Settings.js 71-73, sliders 804-822).
 */
import { defineParam } from '../../shared/params'

export const laserSpeed = defineParam({
  id: 'laser.speed', label: 'Plasma Tag speed', group: 'Tag beams', scope: 'world',
  default: 180, min: 20, max: 340, step: 1,
})

/** Original applied `laserGrav * 20` m/s^2 of drop, so 1 is a steep lob. */
export const laserGravity = defineParam({
  id: 'laser.gravity', label: 'Plasma Tag arc', group: 'Tag beams', scope: 'world',
  default: 0, min: 0, max: 1, step: 0.01,
})

/** 0 dies on impact, 1 bounces off the ground at full speed. */
export const laserRicochet = defineParam({
  id: 'laser.ricochet', label: 'Plasma Tag bounce', group: 'Tag beams', scope: 'world',
  default: 0, min: 0, max: 1, step: 0.01,
})

/** Seconds between shots. The original laser fired every 0.25 s (VehicleMe.js 66). */
export const laserInterval = defineParam({
  id: 'laser.interval', label: 'Plasma Tag interval', group: 'Tag beams', scope: 'world',
  default: 0.25, min: 0.1, max: 2, step: 0.05,
})

export const lasersAllowed = defineParam({
  id: 'laser.allowed', label: 'Plasma Tag allowed', group: 'Tag beams', scope: 'world',
  default: true,
})

/** Lifetime in seconds, from the original Rocket.js 65: faster lasers live shorter. */
export function laserLifetime(speed: number): number {
  const t = Math.min(1, Math.max(0, speed * 0.003))
  return 13 + (5 - 13) * t
}
