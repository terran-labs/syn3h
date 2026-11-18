/**
 * Whether a touch player is aiming with the Tag stick right now (src/ui/TouchControls.ts).
 *
 * While it is true, gear aims the way it does on desktop with the cursor captured: along a ray
 * from the camera through the centre of the screen, where the touch reticle is drawn
 * (src/weapons/aim.ts `cursorAims`). It stays true for the short fade after Tag lifts, so a shot
 * sent on release still goes where the reticle pointed. A plain flag in its own module so the
 * UI can set it without importing the physics that aim.ts needs.
 */
let aiming = false
export function touchAiming(): boolean { return aiming }
export function setTouchAiming(on: boolean): void { aiming = on }
