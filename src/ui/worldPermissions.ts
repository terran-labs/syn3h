import { params } from '../../shared/params'
export interface HostControls { readonly connected?: boolean; readonly isHost: boolean; readonly locked: boolean; readonly canEditWorld: boolean; setLocked(value: boolean): boolean | void; resetWorld?(): boolean }
export function hostControls(): HostControls | undefined {
  return (window as unknown as { miraNet?: HostControls }).miraNet
}
export function canManageBots(): boolean {
  const net = hostControls()
  return !net || net.connected === false || net.isHost
}
export function canEditWorld(): boolean { return hostControls()?.canEditWorld ?? true }
/**
 * Put every shared slider, the seed included, back to its default. In a room the server does
 * it for everyone and starts a fresh round; before joining it resets this device's world.
 */
export function resetWorld(): boolean {
  const net = hostControls()
  if (net?.resetWorld) return net.resetWorld()
  if (!canEditWorld()) return false
  for (const p of params.all()) if (p.def.scope === 'world') params.set(p.def.id, p.def.default, 'local')
  return true
}
