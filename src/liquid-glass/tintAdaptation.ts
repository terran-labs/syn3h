// Exponential response sampled at presentation time. Cap a single step after
// a long frame so the next visible frame cannot jump straight to its target.
export function tintAdaptation(elapsedMs: number): number {
  return -Math.expm1(-Math.min(50, Math.max(0, elapsedMs)) / 240)
}
