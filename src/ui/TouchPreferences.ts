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
 * A touch that starts on a button, a panel or between the action buttons does neither, so a
 * finger that starts on a button never aims. The minimap sits in the driving corner and the
 * stick may land on it (the owner, 17 November 2026): a touch there drives, but never aims.
 */
export function touchRole(t: TouchDown): 'drive' | 'aim' | null {
  if (!t.onGameView || t.onActions) return null
  const fromDriveEdge = t.leftHanded ? t.width - t.x : t.x
  const role = fromDriveEdge < t.width * STICK_REGION ? 'drive' : 'aim'
  return t.onMinimap && role === 'aim' ? null : role
}
