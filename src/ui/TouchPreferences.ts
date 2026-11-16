import { defineParam, params } from '../../shared/params'

export const touchHandedness = defineParam({ id: 'touch.handedness', label: 'Handedness: 0 Right handed, 1 Left handed', group: 'Input', scope: 'client', default: 0, min: 0, max: 1, step: 1 })
export const touchAimFires = defineParam({ id: 'touch.aimFires', label: 'Aim touch fires', group: 'Input', scope: 'client', default: true })
export const touchSensitivity = defineParam({ id: 'touch.sensitivity', label: 'Touch look sensitivity', group: 'Input', scope: 'client', default: 1, min: .25, max: 3, step: .05 })
const ids = [touchHandedness.def.id, touchAimFires.def.id, touchSensitivity.def.id]
const KEY = 'syn3h.touch.preferences'
/** Personal settings stay on this device, like the saved vehicle and player name. */
export function restoreTouchPreferences(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    for (const id of ids) if (typeof saved[id] === typeof params.get(id)!.def.default) params.set(id, saved[id])
  } catch { /* Storage is optional. */ }
}
export function saveTouchPreferences(): void {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(ids.map(id => [id, params.get(id)!.value])))) } catch { /* Storage is optional. */ }
}
/** Two disjoint halves; the boundary belongs to aim for a right-handed player. */
export function touchSide(x: number, width: number, leftHanded: boolean): 'drive' | 'aim' {
  const left = x < width / 2
  return left !== leftHanded ? 'drive' : 'aim'
}
/** Every fire source contributes a hold; releasing one cannot release another. */
export class TouchFireHolds {
  private readonly owners = new Set<number>()
  set(pointer: number, held: boolean): boolean { if (held) this.owners.add(pointer); else this.owners.delete(pointer); return this.active }
  clear(): void { this.owners.clear() }
  get active(): boolean { return this.owners.size > 0 }
}
