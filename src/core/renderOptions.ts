/** Detection is ready for a guarded fallback, but does not change backend defaults. */
export function isIOSOrIPadSafari(userAgent: string, touchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || /Macintosh/.test(userAgent) && touchPoints > 1
  return ios && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
}
export function graphicsOverride(search: string): 0 | 1 | 2 | undefined {
  const value = new URLSearchParams(search).get('gfx')
  return value === '0' || value === '1' || value === '2' ? Number(value) as 0 | 1 | 2 : undefined
}
