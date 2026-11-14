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
