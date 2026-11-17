/**
 * The lines on the loading veil. New browser-edition writing; the original GameSparks list
 * was not recovered. The voice: dry, short, a little absurd, about space, terrain, vehicles,
 * physics and software. One sentence or two very short ones, under about 60 characters.
 * Never weapons, harm or combat (this is an exploration game), never a quote or a brand,
 * and never anything that could be mistaken for an error. Failures get plain words.
 *
 * The first line comes from a short copy of the best of the general list inline in
 * index.html, so it shows before any script module has loaded.
 */

/** The general list: shown when a phase has used up its own lines, or has none. */
const generalMessages = [
  'Checking which way is down.',
  'Tightening the imaginary bolts.',
  'Waiting for the dust to compile.',
  'Giving the moon some personal space.',
  'Counting wheels. Recounting wheels.',
  'Teaching the ground to stay put.',
  'Filing a noise complaint against the vacuum.',
  'Adding a sensible number of craters.',
  'Removing the sensible limit on craters.',
  'Polishing the spare horizon.',
  'Asking gravity to hold this for a moment.',
  'Finding a level surface. Lowering expectations.',
  'Installing the optional sense of direction.',
  'The landing gear has requested a meeting.',
  'Inflating the confidence reserve.',
  'Moving the mountain slightly to the left.',
  'Checking the warranty on spacetime.',
  'Untangling the flight plan.',
  'Measuring twice. Launching once.',
  'Testing the brakes somewhere inexpensive.',
  'Letting the reactor finish its thought.',
  'Packing a spare atmosphere.',
  'Sorting rocks by aerodynamic regret.',
  'The autopilot is reading the instructions.',
  'Updating the map with more outdoors.',
  'Making room for a very small adventure.',
  'Reserving a crater in your name.',
  'Checking the fuel gauge for optimism.',
  'Waiting for the orbital paperwork.',
  'Applying a second coat of vacuum.',
  'Turning geological time up a little.',
  'Bribing the suspension with fresh grease.',
  'Confirming that the sky is attached.',
  'The spare wheel would like a window seat.',
  'Sweeping yesterday out of the airlock.',
  'Consulting the department of improbable jumps.',
  'Warming up the cold start procedure.',
  'All systems nominal. Nominal is a broad term.',
  'Putting the fun back where we found it.',
] as const

/** Lines written for what each loading phase is actually doing. */
export const phaseMessages: Readonly<Record<string, readonly string[]>> = {
  device: [
    'Asking your device how it feels today.',
    'Counting your pixels. There are a lot.',
    'Checking the graphics chip for enthusiasm.',
    'Measuring the screen for a horizon.',
    'Finding out how many cores want to help.',
    'Introducing your browser to a planet.',
    'Reading the small print on the graphics chip.',
    'Checking that this screen is right side up.',
  ],
  physics: [
    'Reminding every object that it has mass.',
    'Teaching the wheels which way is forward.',
    'Loading friction. Then a little more friction.',
    'Tuning the suspension to a polite bounce.',
    'Explaining momentum to the boulders.',
    'Setting gravity to roughly one gravity.',
    'Greasing the axles of the simulation.',
    'Agreeing on how bouncy a rock should be.',
  ],
  renderer: [
    'Compiling shaders. They like to take their time.',
    'Mixing this planet a sky in its own colour.',
    'Scattering sunlight the long way round.',
    'Lowering the sun to a more flattering angle.',
    'Showing the shadows where to stand.',
    'Sharpening the distant mountains.',
    'Rounding off the edges of the atmosphere.',
    'Warming up the colours before they go on.',
  ],
  world: [
    'Raising mountains to a comfortable height.',
    'Laying roads where the hills allow.',
    'Rolling boulders into scenic positions.',
    'Growing a whole planet from one number.',
    'Filling the valleys with fresh scenery.',
    'Checking the ground goes all the way round.',
    'Letting the lava cool to a sticky glow.',
    'Putting the craters where they will be enjoyed.',
  ],
  ready: [
    'Sky attached. Ground attached. Off you go.',
    'Parking every vehicle nose out.',
    'One last check that the ground is still there.',
    'Holding the atmosphere open for you.',
    'Unrolling the horizon.',
    'Handing you the keys to a small planet.',
  ],
}


/**
 * Chooses the next line. Never the line already showing (when there is any other choice).
 * Phase lines come first, until each has been shown once this visit; then the general list.
 */
export function pickLoadingLine(options: { phase?: string; general: readonly string[]; previous?: string; shown?: ReadonlySet<string>; random?: () => number; phasePools?: Readonly<Record<string, readonly string[]>> }): string {
  const { phase, general, previous, shown, random = Math.random, phasePools = phaseMessages } = options
  const own = (phase && Object.hasOwn(phasePools, phase) ? phasePools[phase] : []).filter(line => !shown?.has(line) && line !== previous)
  const pool = own.length ? own : general.filter(line => line !== previous)
  if (!pool.length) return general[0] ?? previous ?? ''
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

/**
 * Once the bundle runs, every phase passes in well under a second on most devices (Game.ts
 * reports physics and the renderer back to back, world building blocks painting, and ready
 * lifts the veil), so phase lines would hardly ever be read. They all join the general
 * rotation, which is what players read while the bundle downloads, and still lead in their
 * own phase on a device slow enough to linger there. Lines that say loading has finished
 * stay in the ready phase only.
 */
const READY_ONLY = new Set(['Sky attached. Ground attached. Off you go.', 'Handing you the keys to a small planet.'])

/** Everything the general rotation draws on. */
export const loadingMessages: readonly string[] = [...generalMessages, ...Object.values(phaseMessages).flat().filter(line => !READY_ONLY.has(line))]
