import body from '../cage/cage250'
import { buildParts, PARTS_NUMBERS, type PartsCandidate } from './index'

/**
 * The parts fitted to the control-cage body (cage250): the swellings' rims are cast onto that
 * body's surface at build time. A candidate for the buggy-fit harness; a skin would pass the
 * body geometry it already built to buildParts instead of building it twice.
 */
const candidate: PartsCandidate = {
  id: 'buggygen-parts-cage250',
  build: detail => buildParts(detail, body.build(detail).map(p => p.geometry)).pieces,
  numbers: PARTS_NUMBERS,
}
export default candidate
