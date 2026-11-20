/**
 * The pixel ratio for a full-size screenshot (Game.snapshot): the device's own, never below
 * what play already uses, and with the picture's long side no more than `maxSide` pixels, so a
 * phone is not asked for a frame larger than its memory allows.
 */
export function snapshotPixelRatio(current: number, device: number, longSideCss: number, maxSide: number): number {
  const cap = longSideCss > 0 ? maxSide / longSideCss : device
  return Math.max(current, Math.min(device, cap))
}
