import type { WireInput } from '../../shared/protocol'

export function emptyInputLike(): WireInput {
  return { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false }
}
