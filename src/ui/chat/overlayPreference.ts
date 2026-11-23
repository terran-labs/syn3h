/**
 * "Show new chat over the game" (shared/chat.ts chat.overlay): remembered on this device,
 * and off by default on touch-first devices, where a line popping up mid-screen covers half
 * the view. A player's own choice, once made, wins over the default.
 */
import { params } from '../../../shared/params'
import { chatOverlay } from '../../../shared/chat'

const KEY = 'mira.chat.overlay'

/** Touch is the main pointer and there is no mouse or trackpad. */
export function touchFirst(): boolean {
  if (typeof matchMedia !== 'function') return false
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches
}

/** Apply the saved choice or the device's default, then save every change. Returns the unsubscribe. */
export function restoreChatOverlay(): () => void {
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch { /* Storage is optional. */ }
  params.set(chatOverlay.def.id, saved !== null ? saved === '1' : !touchFirst())
  return params.onChange((id, value) => {
    if (id !== chatOverlay.def.id) return
    try { localStorage.setItem(KEY, value ? '1' : '0') } catch { /* Storage is optional. */ }
  })
}
