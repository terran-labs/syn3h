/**
 * Device gates, as the Field switches rows show them (ui/PerformancePanel.ts): something the game
 * turns off on a kind of device where it is not yet proven, and the switch that forces it on for
 * this visit, so a fix can be tried on the device itself (the owner's iPhone).
 *
 * A gate appears only where it has turned something off. Forcing one on goes through the same
 * setting the game already reads, a client setting, which is not kept between visits.
 */
import { params } from '../../shared/params'
import { depthEffectsUnproven, midPassCopyProven } from './midPassCopy'
import { flashSwitches, sunShadowsUnproven } from './flashSwitches'
import { onFieldSwitches, setFieldSwitch } from './fieldSwitches'

export interface DeviceGate {
  id: string
  /** What the gate turns off, in plain words. */
  label: string
  /** True where the gate has turned it off on this device. */
  gated(): boolean
  /** True while the player has forced it on for this visit. */
  forced(): boolean
  force(on: boolean): void
  /** Hear a change to forced(); returns the unsubscribe. */
  watch(fn: () => void): () => void
}

const watchParam = (id: string) => (fn: () => void) => params.onChange(changed => { if (changed === id) fn() })

export function deviceGates(): DeviceGate[] {
  return [
    {
      // core/flashSwitches.ts gateSunShadows: WebGPU on WebKit or touch. Forced on is ?shadows=1,
      // live: the gate is worked out again and the shadow pin written again at once.
      id: 'sun-shadows', label: 'Sun shadows',
      gated: () => sunShadowsUnproven(), forced: () => flashSwitches.shadows1,
      force: on => setFieldSwitch('shadows1', on), watch: onFieldSwitches,
    },
    {
      // core/midPassCopy.ts: copies taken in the middle of the scene pass, off on WebKit and touch.
      id: 'depth-effects', label: 'Water refraction, force field contact glow, headlight soft edge',
      gated: () => !midPassCopyProven(), forced: () => depthEffectsUnproven.value,
      force: on => params.set(depthEffectsUnproven.def.id, on), watch: watchParam(depthEffectsUnproven.def.id),
    },
  ]
}
