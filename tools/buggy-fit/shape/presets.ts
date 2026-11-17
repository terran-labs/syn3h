/**
 * Hand-authored shapes by handle values alone. The first is the fitted buggy; the next three are
 * deliberately not this buggy, to find where a rig over one fixed cage stops reading as a
 * designed vehicle and starts reading as a stretched buggy.
 *
 *   npx tsx tools/buggy-fit/shape/presets.ts     prints a share code and lab URL query per preset
 */
import { clampShape, encodeShape, seedShape, defaultShape } from '../../../src/vehicles/buggygen/shape'
export const PRESETS = {
  fitted: defaultShape(),
  streamliner: clampShape({ noseLength: .5, tailLength: .5, height: -.25, rideHeight: -.05, noseDroop: .1, noseWidth: -.2, tailWidth: -.15, deckCrown: -.04, shoulder: -.06, haunchHeight: -.06, spoilerHeight: -.1, spoilerRake: -6, cabinPosition: -.05, cockpitSize: -.08, lampSize: -.1 }),
  wedge: clampShape({ width: .2, noseLength: .2, noseDroop: .22, noseWidth: .15, tailHeight: .2, tailWidth: .2, deckCrown: -.08, frontFlare: .15, rearFlare: .2, haunchHeight: .15, spoilerHeight: .3, spoilerRake: 15, scoopSize: .3, lampSize: -.2, cabinPosition: -.15 }),
  crawler: clampShape({ noseLength: -.2, tailLength: -.2, height: .3, rideHeight: .08, belly: .08, shoulder: .12, deckCrown: .14, noseDroop: -.12, tailHeight: .1, frontFlare: .2, rearFlare: .2, cockpitSize: .15, cabinPosition: .1, lampSize: .25, scoopSize: .2, spoilerHeight: .25 }),
  seed7: seedShape(7),
  seed42: seedShape(42),
}
if (import.meta.url === `file://${process.argv[1]}`) for (const [k, s] of Object.entries(PRESETS)) console.log(`${k} ${encodeShape(s)} vehicle=buggy-shape&shape=${encodeShape(s)}`)
