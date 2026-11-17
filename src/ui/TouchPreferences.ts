/**
 * Touch control preferences and the rule for which finger does what (src/ui/TouchControls.ts).
 * Handedness is a personal setting: it shows in the sidebar's Me card (group Input, client
 * scope) and is kept on this device, like the saved vehicle and player name.
 */
import { defineParam, params } from '../../shared/params'

export const touchLeftHanded = defineParam({
  id: 'touch.leftHanded', label: 'Left-handed touch: drive on the right', group: 'Input', scope: 'client', default: false,
})

const KEY = 'syn3h.touch.leftHanded'
/** Restore the saved hand, then keep saving it whenever it changes. Returns the unsubscribe. */
export function persistHandedness(): () => void {
  try { const saved = localStorage.getItem(KEY); if (saved !== null) params.set(touchLeftHanded.def.id, saved === '1') } catch { /* Storage is optional. */ }
  return params.onChange((id) => {
    if (id !== touchLeftHanded.def.id) return
    try { localStorage.setItem(KEY, touchLeftHanded.value ? '1' : '0') } catch { /* Storage is optional. */ }
  })
}

/** Fraction of the screen width, from the driving hand's edge, where a drag drives. */
export const STICK_REGION = 0.55

export interface TouchDown {
  /** Where the touch went down, in CSS px, and the viewport width. */
  x: number; width: number
  leftHanded: boolean
  /** True when it went down on the game view itself, not on a button, panel or HUD element. */
  onGameView: boolean
  /** True when it went down inside the minimap or the action buttons' block. */
  onMinimap: boolean; onActions: boolean
}

/**
 * Which job a new touch gets. The driving hand's side (the left 55% for a right-handed player,
 * the right 55% for a left-handed one) steers; the rest of the game view aims the camera.
 * A touch that starts on a button, a panel, the minimap or between the action buttons does
 * neither, so a finger that starts on a button never aims.
 */
export function touchRole(t: TouchDown): 'drive' | 'aim' | null {
  if (!t.onGameView || t.onMinimap || t.onActions) return null
  const fromDriveEdge = t.leftHanded ? t.width - t.x : t.x
  return fromDriveEdge < t.width * STICK_REGION ? 'drive' : 'aim'
}

/*
 * The Tag aim stick (src/ui/tagStick.ts). Turn rate is set by how far the thumb is from where it
 * pressed Tag, like a gamepad stick, and passes through the camera's look sensitivity
 * (camera.sensitivity) as finger travel does, so the look setting still applies. Tuned by feel:
 * no test pins these numbers.
 */
export const touchAimSpeed = defineParam({
  id: 'touch.aimSpeed', label: 'Tag stick turn speed (px of look per second at full tilt)', group: 'Input', scope: 'client',
  default: 450, min: 100, max: 1500, step: 10,
})
export const touchAimRadius = defineParam({
  id: 'touch.aimRadius', label: 'Tag stick travel to full tilt (px)', group: 'Input', scope: 'client',
  default: 56, min: 24, max: 140, step: 2,
})
export const touchAimCurve = defineParam({
  id: 'touch.aimCurve', label: 'Tag stick response curve (1 linear, higher finer near centre)', group: 'Input', scope: 'client',
  default: 1.8, min: 1, max: 3, step: 0.1,
})
/** Finger spread to zoom: wheel pixels per pixel of change in the distance between two fingers. */
export const touchPinchSpeed = defineParam({
  id: 'touch.pinchSpeed', label: 'Pinch zoom speed', group: 'Input', scope: 'client',
  default: 3, min: 0.5, max: 10, step: 0.5,
})
