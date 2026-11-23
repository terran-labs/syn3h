import * as THREE from 'three/webgpu'
import { renderGroup, uniform } from 'three/tsl'
import { defineParam } from '../../shared/params'

/**
 * Effects that read the frame as it is being drawn: water refraction (world/water/refraction.ts),
 * the force field's contact glow (vehicles/skins/forceField.ts) and the headlight cones' soft
 * edge (vehicles/effects/cones.ts). Each read is a copy taken in the middle of the scene pass:
 * three ends the pass, copies the colour or the depth (from the multisampled pass at Medium and
 * above, a 4-sample depth texture), and begins the pass again loading every attachment.
 *
 * By the WebGPU rules that is correct, and in Chrome on a Mac it draws cleanly (22 and 23
 * November 2026, no blank frames, cost within noise). It is exactly where an implementation on a
 * tile-based phone GPU could lose a frame: a copy of multisampled depth that fails validation
 * drops the whole frame's command buffer, and an attachment reloaded after the break could come
 * back cleared. The owner saw dozens of black frames a minute on an iPhone on v26.11.2301, and
 * his first black flashes, before refraction, came "more often in complex scenes: bots on
 * screen, lasers", when force fields and headlight cones are on screen. three #34932 (a
 * viewport texture's copy range after a pixel-ratio change failing validation) is a third way
 * these copies can black a frame on a phone whose governor steps the resolution; whether r187
 * carries its fix is recorded beside the commit that added this gate.
 *
 * So until it is proven there, no such copy is made on a WebKit browser or a touch device. The
 * graphs are the same everywhere: a gated node skips its copy and a uniform zeroes what the copy
 * would have fed, so turning this on or off, or a quality change, builds nothing.
 */

/**
 * The player's own switch: make these copies on a device where they are not yet proven, to try
 * a later fix on a phone. Off by default. Client settings are not kept between visits, so no
 * value saved before this existed can turn it on.
 */
export const depthEffectsUnproven = defineParam<boolean>({
  id: 'gfx.depthEffectsUnproven', label: 'Depth effects where not yet proven (phones, tablets, Safari): refraction, force field contact, soft headlight beams', group: 'Graphics', scope: 'client', default: false,
})

/** What decides whether mid-pass copies are proven here. */
export interface CopyDevice { webkit: boolean; touch: boolean }

/**
 * The device, read once. Engine and capability tests, not the user agent string:
 * - WebKit: `GestureEvent` is a WebKit interface, present in Safari on macOS and in every
 *   browser on iOS and iPadOS (all WebKit), absent from Chromium and Gecko.
 * - Touch: the primary pointer is coarse (`(pointer: coarse)`): phones and tablets of any
 *   vendor. A touchscreen laptop keeps a fine primary pointer and counts as desktop.
 */
let device: CopyDevice | undefined
export function copyDevice(): CopyDevice {
  if (device) return device
  const w = typeof window === 'undefined' ? undefined : window
  return device = {
    webkit: !!w && 'GestureEvent' in w,
    touch: !!w && typeof w.matchMedia === 'function' && w.matchMedia('(pointer: coarse)').matches,
  }
}

/**
 * Whether a copy in the middle of the scene pass is proven safe on this kind of device: desktop
 * Chromium-family WebGPU, where it was measured. Lifting this for WebKit or for touch devices
 * needs a run on a real such device with the blank-frame probe showing no blank frame over
 * minutes of Mire (water, force fields and headlights on screen), and its frame cost measured.
 */
export function midPassCopyProven(d: CopyDevice = copyDevice()): boolean {
  return !d.webkit && !d.touch
}

/** Whether these copies are made: proven here, or turned on by the player. */
export function midPassCopyAllowed(d: CopyDevice = copyDevice()): boolean {
  return midPassCopyProven(d) || depthEffectsUnproven.value
}

/** For diagnostics: whether the vehicles' depth effects (contact glow, soft beams) are on. */
export function depthEffectsState(d: CopyDevice = copyDevice()): 'on' | 'off: not yet proven on this device' {
  return midPassCopyAllowed(d) ? 'on' : 'off: not yet proven on this device'
}

/** 1 while the copies are made, 0 while they are skipped: multiplies whatever they feed. */
export const midPassCopyNode = uniform(1).setGroup(renderGroup).onRenderUpdate(() => midPassCopyAllowed() ? 1 : 0)

type Gate = (renderer: THREE.Renderer) => boolean
const allowed: Gate = () => midPassCopyAllowed()

/** The frame's colour, copied only when `gate` says so. The gate survives a clone. */
export class GatedViewportTexture extends THREE.ViewportTextureNode {
  gate: Gate = allowed
  updateBefore(frame: THREE.NodeFrame): boolean | undefined { return this.gate(frame.renderer!) ? super.updateBefore(frame) : undefined }
  clone(): this { const c = super.clone() as this; c.gate = this.gate; return c }
}
/** The frame's depth, likewise. */
export class GatedViewportDepthTexture extends THREE.ViewportDepthTextureNode {
  gate: Gate = allowed
  updateBefore(frame: THREE.NodeFrame): boolean | undefined { return this.gate(frame.renderer!) ? super.updateBefore(frame) : undefined }
  clone(): this { const c = super.clone() as this; c.gate = this.gate; return c }
}
