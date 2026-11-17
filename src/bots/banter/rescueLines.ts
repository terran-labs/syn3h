/**
 * Which rescue lines a player needs to follow a rescue, and so are never cut by the chatter
 * budget: someone is stuck, someone is coming, a rescuer got stuck itself, a person is asked or
 * has hooked on, and how it ended. ('rescue.start' and 'rescue.handoff' are essential the first time in a rescue only.) Every other rescue line is colour: it counts against the
 * room's chatter budget, and the director lets at most one through per rescue every
 * RESCUE_COLOUR_S seconds, so a five-minute rescue does not fill the log.
 */
export const RESCUE_ESSENTIAL: ReadonlySet<string> = new Set([
  'stuck.call', 'rescue.start', 'rescue.handoff', 'rescue.player.ask', 'rescue.player.hooked', 'rescue.player.drive',
  'rescue.success.thanks', 'rescue.success.ingrate', 'rescue.selffree', 'rescue.calloff', 'rescue.giveup', 'rescue.giveup.tried', 'rescue.player.thanks',
])

/** Seconds between colour lines (anything not essential) within one rescue. */
export const RESCUE_COLOUR_S = 30
