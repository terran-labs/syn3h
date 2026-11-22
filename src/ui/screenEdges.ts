/**
 * Which long side of a landscape phone has the camera cutout (Dynamic Island or notch), for the
 * HUD's side edges (--safe-left and --safe-right, src/ui/exploration.css).
 *
 * In landscape iOS reports the same safe-area inset on both long sides, though only one has the
 * cutout; the other is plain screen. Honouring both left the right-hand thumb buttons as far in
 * as the left-hand ones (the owner, 22 November 2026, on an iPhone: "On the right edge, I think
 * we should position the buttons identically from the right side of the screen"). Where the two
 * insets are equal and non-zero in landscape, the cutout is on the side the top of the device
 * points to: screen angle 90 puts it on the left, 270 on the right. Insets that already differ
 * (Android punch holes and notches report only the cutout side) or are zero (iPad, desktop, any
 * portrait) are left to env() as they are. The bottom inset, the home indicator, is never touched.
 *
 * Sets html[data-cutout-side] to "left" or "right", or removes it. Returns a stop function.
 */
export type CutoutSide = 'left' | 'right' | null

/** The pure rule, for tests: insets in CSS px, the screen angle in degrees. */
export function cutoutSide(left: number, right: number, landscape: boolean, angle: number | null): CutoutSide {
  if (!landscape || !(left > 0) || Math.abs(left - right) >= 1 || angle === null) return null
  const a = ((Math.round(angle) % 360) + 360) % 360
  return a === 90 ? 'left' : a === 270 ? 'right' : null
}

function screenAngle(): number | null {
  const angle = screen.orientation?.angle
  if (typeof angle === 'number') return angle
  // Older iOS: window.orientation, where -90 is the same as 270.
  const legacy = (window as { orientation?: unknown }).orientation
  return typeof legacy === 'number' ? legacy : null
}

/** The four reported safe-area insets, CSS px, read through a throwaway element. */
function readInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const px = (v: string) => Math.round((parseFloat(v) || 0) * 10) / 10
  const insets = { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) }
  probe.remove()
  return insets
}

/**
 * One line for the copied diagnostics: the insets the browser reports, the screen angle and the
 * side the HUD treats as the cutout's, so a player can check both landscape directions at once.
 */
export function screenEdgesLine(): string {
  const i = readInsets(), angle = screenAngle(), landscape = innerWidth > innerHeight
  const side = document.documentElement.dataset.cutoutSide ?? cutoutSide(i.left, i.right, landscape, angle) ?? 'none'
  return `Screen edges: insets top ${i.top}, right ${i.right}, bottom ${i.bottom}, left ${i.left} px; ${landscape ? 'landscape' : 'portrait'} ${innerWidth}x${innerHeight}, screen angle ${angle ?? 'unknown'}; cutout side ${side}`
}

export function watchScreenEdges(root: HTMLElement = document.documentElement): () => void {
  // One invisible probe reads the reported insets as lengths.
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)'
  document.body.append(probe)
  const apply = () => {
    const style = getComputedStyle(probe)
    const side = cutoutSide(parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0, innerWidth > innerHeight, screenAngle())
    if (side) { if (root.dataset.cutoutSide !== side) root.dataset.cutoutSide = side }
    else if (root.dataset.cutoutSide) delete root.dataset.cutoutSide
  }
  apply()
  const abort = new AbortController()
  const options = { signal: abort.signal }
  addEventListener('resize', apply, options)
  addEventListener('orientationchange', apply, options)
  screen.orientation?.addEventListener?.('change', apply, options)
  // Insets can settle a frame after a rotation.
  addEventListener('orientationchange', () => setTimeout(apply, 250), options)
  return () => { abort.abort(); probe.remove(); delete root.dataset.cutoutSide }
}
