/** Share codes of the hand-picked extremes used for the lab screenshots. */
import { clampShape, encodeShape, seedShape, defaultShape } from '../../../src/vehicles/buggygen/shape'
export const PRESETS = {
  fitted: defaultShape(),
  longLow: clampShape({ noseLength: .25, tailLength: .2, height: -.1, noseDroop: .14, spoilerHeight: -.07, cockpitLength: .1 }),
  muscle: clampShape({ width: .1, frontFlare: .12, rearFlare: .12, haunchHeight: .14, spoilerHeight: .25, scoopSize: .2 }),
  compact: clampShape({ noseLength: -.15, tailLength: -.12, height: .12, cockpitLength: .18, cockpitWidth: .12, belly: .05 }),
  ducktail: clampShape({ tailHeight: .14, spoilerRake: 14, spoilerHeight: .1, noseDroop: -.08, cockpitLength: -.12, rearFlare: .06 }),
  seed7: seedShape(7),
  seed42: seedShape(42),
}
if (import.meta.url === `file://${process.argv[1]}`) for (const [k, s] of Object.entries(PRESETS)) console.log(`${k}=vehicle=buggy-shape&shape=${encodeShape(s)}@-35,22,7`)
