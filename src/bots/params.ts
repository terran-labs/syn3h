import { defineParam } from '../../shared/params'
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.1) => defineParam({ id: `bots.${id}`, label, group: 'Bots', scope: 'world', default: value, min, max, step })
export const botCount = number('count', 'Bot count', 4, 0, 16, 1)
export const aggression = number('aggression', 'Aggression', 1, 0, 2)
export const topThrottle = number('topThrottle', 'Top throttle', 1, 0, 1)
/**
 * Whether bots use their gear on other vehicles: tag beams, and the bungee, yoink and big red
 * when the room allows them. Off by default: bots are playful company, and dropping into a
 * world where they open fire at once felt hostile.
 *
 * The id was 'bots.canFire' while the default was true. The registry keeps no record of
 * whether a value was chosen or merely the default, so saved worlds, room snapshots and a
 * host's hello all carry 'bots.canFire: true' explicitly, and applying them would turn firing
 * back on. Under a new id those old values are unknown and ignored (params.set returns false
 * for an unknown id), so only a deliberate choice made from now on enables it.
 */
export const canFire = defineParam({ id: 'bots.tagBeams', label: 'Bots use tag beams', group: 'Bots', scope: 'world', default: false })
export const canDrive = defineParam({ id: 'bots.canDrive', label: 'Can drive', group: 'Bots', scope: 'world', default: true })
/** Registry has no enum type: 0 is local player, 1 is nearest supplied vehicle. */
export const targetMode = number('targetMode', 'Target: 0 player, 1 nearest', 0, 0, 1, 1)
export const strategyInterval = number('strategyInterval', 'Stuck check interval', 1.5, 0.5, 5)
export const stuckDistance = number('stuckDistance', 'Stuck minimum movement', 1, 0.1, 5)
export const recoveryTime = number('recoveryTime', 'Rescue after seconds', 8, 3, 30)
export const fireInterval = number('fireInterval', 'Tag beam interval', 1, 0.1, 5)
export const spawnRadius = number('spawnRadius', 'Spawn radius', 24, 10, 100)

export const approachSpread = number('approachSpread', 'Approach spread', 8, 0, 20)
export const cornerSpeed = number('cornerSpeed', 'Corner speed', 12, 4, 30)

export const roadSpeed = number('roadSpeed', 'Road speed (m/s)', 10, 6, 25)
export const reverseBrakeTime = number('reverseBrakeTime', 'Brake before reverse (s)', 0.35, 0, 2, 0.05)
export const roadCornerSpeed = number('roadCornerSpeed', 'Road corner speed (m/s)', 6, 2, 20)

/**
 * How much of the time a bot follows its own agenda (exploring, cruising roads, climbing,
 * tailing, showing off) instead of chasing. 0 is the original relentless pursuit.
 */
export const freeSpirit = number('freeSpirit', 'Own agenda (0 always chases)', 0.6, 0, 1, 0.05)

/**
 * Which vehicles bots drive. 0: buggies only. 1: mixed, every fourth bot a hovercraft and
 * every fourth a jet. Guests receive each bot's type, including after host takeover.
 */
export const fleet = number('fleet', 'Fleet: 0 buggies, 1 mixed', 1, 0, 1, 1)

/**
 * Let a self-flying jet open its wings on long straight legs. The pilot keeps hover mode
 * for nearby turns and obstacles.
 */
export const jetForwardFlight = defineParam({ id: 'bots.jetForwardFlight', label: 'Self-flying jets use forward flight', group: 'Bots', scope: 'world', default: true })

/**
 * Daydream: seconds without touching the controls before the player's own vehicle starts
 * driving itself. 0 turns it off. Personal, never sent to the room. The settings slider maps
 * its travel onto 10 seconds to 5 minutes with "off" at the far right (see daydreamControl.ts).
 */
export const daydreamSeconds = defineParam({ id: 'daydream.seconds', label: 'Daydream after idle (s, 0 is off)', group: 'Daydream', scope: 'client', default: 300, min: 0, max: 300, step: 1 })
