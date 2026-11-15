import { DUCT_BASE, LOWWING, buildDuctHover, ductHoverFar, type DuctDesign } from '../hover/lowwing'

export { buildDuctHover as buildRound4, ductHoverFar as round4Far } from '../hover/lowwing'
export type Round4Design = DuctDesign

/**
 * Round four: five variations on what the owner picked out of round three (15 Nov 2026).
 *
 * Kept, in his words: the red one's air intakes and its thrust duct (Ducktail: flank ducts
 * on a faired base, and a thruster that leaves through the stern), and the silver and blue
 * one's fins (Arrow: a wing whose tips dip down on the outside).
 *
 * Asked for: thrust pads, headlights and motor flares "much better integrated into the
 * body", and the body curving up at the edges of the cockpit so the canopy is part of the
 * body's shape and not set on top. And a thruster you cannot see into from behind.
 *
 * So, for every design here:
 * - the deck rises in a coaming round the cockpit opening, and the canopy stands inside it;
 * - headlamps are bands on the nose's own outline, a few millimetres proud, either wrapped
 *   round each nose corner or run right across;
 * - each lift port sits in a blister of the belly, with its ring 8 mm proud of the blister;
 * - the thruster is the end of a cowl that grows out of the deck: the cowl's own skin is the
 *   nozzle lip, with no separate collar, and a solid plug closes the throat behind the glow.
 *
 * The five differ in hull, nose lamps, duct section and how the wing is carried. The
 * generator itself lives in src/vehicles/hover/lowwing.ts, because the owner approved
 * Lowwing and the game may load nothing from this folder.
 */
const base = DUCT_BASE
export const R4_DESIGNS: Round4Design[] = [
  { ...base, id: 'h4-ember', name: 'Ember', notes: 'The red one carried forward: its intakes and stern duct, now with the silver one\'s wing on a single pylon and lamps wrapped round the nose corners.', paint: 0xb8321f, accent: 0xf2e6c8, head: 'wrap', duct: 'round', wing: 'tee', stripe: true, chine: 'none' },
  { ...base, id: 'h4-gull', name: 'Gull', notes: 'The silver one\'s sharper nose with the red one\'s duct. The wing lifts away from its pylon before the tips dip, and a light bar runs across the nose.', paint: 0xe9edf2, accent: 0x1e6bff, nose: .36, reach: .1, waist: .94, tail: .82, head: 'visor', duct: 'round', wing: 'gull', stripe: true, chine: 'accent', canopy: { z0: -1.40, z1: .40, width: .52, bulge: .43 } },
  { ...base, id: 'h4-vee', name: 'Vee', notes: 'A wide, flat vectoring duct, with the wing carried on two splayed struts that rise from either side of it. Larger intakes.', paint: 0x2f55c8, accent: 0xf6a623, vent: 1.2, head: 'wrap', duct: 'slot', wing: 'vee', stripe: false, chine: 'chrome' },
  // Lowwing is the design the game ships; its numbers live with the game's code.
  LOWWING,
  { ...base, id: 'h4-kite', name: 'Kite', notes: 'Fuller shoulders and a taller pylon, with longer tips that dip further. The most wing of the five.', paint: 0x1d6f7a, accent: 0xffd166, shoulder: 1.03, blade: 1.1, coaming: .11, head: 'wrap', duct: 'round', wing: 'tee', stripe: false, chine: 'chrome' },
]
