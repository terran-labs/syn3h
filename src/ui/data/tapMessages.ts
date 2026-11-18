/**
 * The lines on the tap-to-begin prompt (src/ui/TapToBegin.ts): shown once loading is done,
 * only where the browser will not start sound without a gesture. The voice is the loading
 * veil's (loadingMessages.ts): dry, short, a little absurd, no exclamation marks. Each line
 * must say plainly that a tap, click or key press begins.
 *
 * `{Tap}` and `{tap}` are filled for the device: "Tap" and "tap" on a touch screen, "Click or
 * press a key" and "click or press a key" otherwise.
 */
export const tapMessages = [
  'The universe is packed into one point. {Tap} to let it out.',
  'Everything is ready to happen. {Tap} to make it happen.',
  'Nothing has happened yet. {Tap} to change that.',
  'Spacetime is wound up tight. {Tap} to let go.',
  'All the planets are in one place. {Tap} to scatter them.',
  'The music is holding its breath. {Tap} to begin.',
  'One small point, holding everything. {Tap} to pop it.',
  'The worlds are rolled up small. {Tap} to unroll them.',
  'Gravity is on standby. {Tap} to switch it on.',
  'Before the beginning. {Tap} to skip ahead to the beginning.',
  'The countdown reached zero a while ago. {Tap} to go.',
  'Thirteen billion years, starting when you {tap}.',
  'The Big Bang is ready when you are. {Tap} to light it.',
  'Every rock is waiting for a push. {Tap} to give it one.',
  'Sound check done. {Tap} to start the universe, with sound.',
] as const

/** Local storage key: the index of the next line to show. */
export const TAP_MESSAGE_KEY = 'syn3h.tapMessage'

/** Fill a line's `{Tap}` and `{tap}` for a touch screen or for a mouse and keyboard. */
export function tapLine(template: string, touch: boolean): string {
  return template.replaceAll('{Tap}', touch ? 'Tap' : 'Click or press a key').replaceAll('{tap}', touch ? 'tap' : 'click or press a key')
}

/**
 * The one line for this load, rotating through the set across loads: each load shows the
 * next, so a returning player sees a different one each time. A first visit starts at a
 * random place. Storage is optional; without it every load is a random line.
 */
export function pickTapMessage(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, touch: boolean, random: () => number = Math.random): string {
  const count = tapMessages.length
  let index = Math.floor(random() * count)
  try {
    const saved = Number.parseInt(storage?.getItem(TAP_MESSAGE_KEY) ?? '', 10)
    if (Number.isFinite(saved)) index = ((saved % count) + count) % count
    storage?.setItem(TAP_MESSAGE_KEY, String((index + 1) % count))
  } catch { /* Storage is optional. */ }
  return tapLine(tapMessages[index], touch)
}
