import { defineParam, params } from '../../../shared/params'

export const nameplateMode = defineParam<number>({ id: 'hud.nameplates', label: 'Vehicle labels: 0 All, 1 People, 2 Off', group: 'Interface', scope: 'client', default: 0, min: 0, max: 2, step: 1 })
export const PREFERENCE_KEY = 'mira.nameplates.preferences'
export function validMode(value: unknown): value is 0 | 1 | 2 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2
}
/** Persist this preference only. Storage failures must never prevent joining a world. */
export function restoreNameplatePreference(storage?: Pick<Storage, 'getItem' | 'setItem'>): () => void {
  try {
    storage ??= globalThis.localStorage
    const value: unknown = JSON.parse(storage.getItem(PREFERENCE_KEY) ?? 'null')
    if (validMode(value)) params.set(nameplateMode.def.id, value)
  } catch { /* Private browsing or old malformed preferences: use the current default. */ }
  return params.onChange((id, value) => {
    if (id !== nameplateMode.def.id || !validMode(value)) return
    try { storage?.setItem(PREFERENCE_KEY, JSON.stringify(value)) } catch { /* Optional persistence. */ }
  })
}
