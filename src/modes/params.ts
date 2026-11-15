/**
 * Tag game parameters. Free of Three.js so the room server can import them: the server runs
 * the tag rules and reads these from the room's own parameter values.
 */
import { defineParam } from '../../shared/params'

/** Seconds after a tag during which neither player can be tagged again (Vehicle.js 260). */
export const tagCooldown = defineParam({
  id: 'tag.cooldown', label: 'Tag cooldown', group: 'Tag', scope: 'world',
  default: 3, min: 0.5, max: 10, step: 0.5,
})

/** Server side sanity limit on how far apart two vehicles may be for a ram to count. */
export const tagRamReach = defineParam({
  id: 'tag.ramReach', label: 'Ram reach', group: 'Tag', scope: 'world',
  default: 10, min: 4, max: 40, step: 1,
})

/** 0 tag, 1 King of the Hill. Changing it resets the scores. */
export const gameMode = defineParam({
  id: 'game.mode', label: 'Mode (0 tag, 1 hill)', group: 'Game', scope: 'world',
  default: 0, min: 0, max: 1, step: 1,
})

/** Seconds alone on the hill needed to win a round. */
export const kothTargetScore = defineParam({
  id: 'koth.targetScore', label: 'Hill: points to win', group: 'Game', scope: 'world',
  default: 60, min: 5, max: 600, step: 5,
})

/** Scales the width of the zone around the rim road. */
export const kothZoneRadius = defineParam({
  id: 'koth.zoneRadius', label: 'Hill: zone size', group: 'Game', scope: 'world',
  default: 1, min: 0.25, max: 3, step: 0.05,
})

/** Seconds a vehicle stuck in the lava has to crawl out before it is lifted back to its pad.
 * The id predates the sticky lava rule and stays, so saved rooms keep their value. */
export const kothRespawnDelay = defineParam({
  id: 'koth.respawnDelay', label: 'Hill: seconds stuck before return', group: 'Game', scope: 'world',
  default: 3, min: 0, max: 15, step: 0.5,
})

/** Points for the last player to touch someone who then got stuck in the lava, within
 * KNOCK_WINDOW: a dunk. The id predates the name. */
export const kothKnockBonus = defineParam({
  id: 'koth.knockBonus', label: 'Hill: dunk bonus', group: 'Game', scope: 'world',
  default: 10, min: 0, max: 60, step: 1,
})

/** Velocity change a laser hit gives its victim in King of the Hill, m/s. */
export const kothLaserPush = defineParam({
  id: 'koth.laserPush', label: 'Hill: tag beam push', group: 'Game', scope: 'world',
  default: 4, min: 0, max: 20, step: 0.5,
})

/** Seconds after the last contact during which getting stuck still counts as a dunk. */
export const KNOCK_WINDOW = 5
/** Seconds the winner is shown before the next round starts. */
export const WIN_PAUSE = 6
