export interface HostControls { readonly isHost: boolean; readonly locked: boolean; readonly canEditWorld: boolean; setLocked(value: boolean): boolean | void }
export function hostControls(): HostControls | undefined {
  return (window as unknown as { syn3hNet?: HostControls }).syn3hNet
}
export function canEditWorld(): boolean { return hostControls()?.canEditWorld ?? true }
