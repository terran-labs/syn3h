/**
 * Link switches for finding the black flashes on the owner's iPhone (Safari WebGPU, November 2026).
 *
 * His tests: flashes at Medium and High, none at Low set by hand, none at ?webgl=1, the same with
 * Liquid glass on or off. So something on at Medium and off at Low, on WebGPU only. Each switch
 * below turns one Medium difference back to its Low value (or removes a suspect outright) so he
 * can change one thing at a time from a link, and ?blank=1 puts the blank-frame recorder on
 * screen with a Test flash control that shows whether the recorder can see on his Safari.
 *
 * Read once at start from the address. Absent, nothing here changes anything. Every switch that
 * is on is named in the copied Diagnostics report (flashSwitchLine), with ?gfx=N, ?diag=1 and
 * ?webgl=1, which are read elsewhere. They combine freely.
 *
 *   ?blank=1      the recorder on, its counter on screen, and a Test flash control
 *   ?shadows=0    no sun shadows (gfx.shadowQuality 0, as at Low)
 *   ?shadows=1    sun shadows on where they are not yet proven (see gateSunShadows below)
 *   ?shading=0    plain vehicle materials (gfx.vehicleShading 0, as at Low)
 *   ?post=base    the post chain's base tier (the look pass only, as at Low): no sun shaft passes
 *   ?post=off     no post chain: the scene straight to the canvas (implies flat interface glass)
 *   ?samples=1    the scene without multisampling (antialias off: one sample)
 *   ?lowrest=1    the other Medium differences at their Low values: water ripple size, fog
 *                 bank samples, ground cover, tyre mark life
 *   ?freeze=1     the quality governor frozen: no rung, level or bot steps, render scale fixed
 *   ?ui=flat      Flat interface glass for this visit; the saved choice is kept
 *
 * The value of a pinned parameter is applied after every level change too (QualityController
 * write), and never saved.
 */
import type { ParamValue } from '../../shared/params'
import { graphicsOverride } from './renderOptions'

export interface FlashSwitches {
  blank: boolean
  shadows0: boolean
  shadows1: boolean
  shading0: boolean
  post: 'base' | 'off' | null
  samples1: boolean
  lowRest: boolean
  freeze: boolean
  uiFlat: boolean
  /** Not flash switches, but named in the same report line so every switch that is on is named. */
  gfx: number | undefined
  diag: boolean
  webgl: boolean
}

/** Low's values for the level-owned parameters ?lowrest=1 holds (quality.ts PRESET_TABLE, column 1). */
export const LOW_REST: Readonly<Record<string, ParamValue>> = {
  'water.rippleSize': 64,
  'gfx.fogBanks': 1,
  'cover.density': 0.3,
  'cover.reach': 0.45,
  'cover.detail': 12,
  'cover.flowers': 0.5,
  'cover.bend': false,
  'cover.nightLife': 0,
  'gfx.tyreMarks.life': 0.6,
}

const on = (q: URLSearchParams, name: string, value = '1') => q.get(name) === value

export function readFlashSwitches(search: string): FlashSwitches {
  const q = new URLSearchParams(search)
  const post = q.get('post')
  return {
    blank: on(q, 'blank'),
    shadows0: on(q, 'shadows', '0'),
    shadows1: on(q, 'shadows', '1'),
    shading0: on(q, 'shading', '0'),
    post: post === 'base' || post === 'off' ? post : null,
    samples1: on(q, 'samples'),
    lowRest: on(q, 'lowrest'),
    freeze: on(q, 'freeze'),
    // The post chain draws the Liquid glass; without it the interface takes Flat glass.
    uiFlat: q.get('ui') === 'flat' || post === 'off',
    gfx: graphicsOverride(search),
    diag: on(q, 'diag'),
    // Game.ts starts WebGL 2 on any ?webgl, whatever its value.
    webgl: q.has('webgl'),
  }
}

/** Parameters held at a value for this visit, whatever the level says. */
export function pinnedParams(s: FlashSwitches): Record<string, ParamValue> {
  return {
    ...(s.shadows0 ? { 'gfx.shadowQuality': 0 } : {}),
    ...(s.shading0 ? { 'gfx.vehicleShading': 0 } : {}),
    ...(s.lowRest ? LOW_REST : {}),
  }
}

/** For the copied report: which switches were on. */
export function flashSwitchNames(s: FlashSwitches): string[] {
  return [
    s.blank && 'blank=1', s.shadows0 && 'shadows=0', s.shadows1 && 'shadows=1', s.shading0 && 'shading=0', s.post && 'post=' + s.post,
    s.samples1 && 'samples=1', s.lowRest && 'lowrest=1', s.freeze && 'freeze=1', s.uiFlat && 'ui=flat',
    s.gfx !== undefined && 'gfx=' + s.gfx, s.diag && 'diag=1', s.webgl && 'webgl=1',
  ].filter((name): name is string => !!name)
}

export const flashSwitches: FlashSwitches = readFlashSwitches(typeof location === 'undefined' ? '' : location.search)
export const flashPins: Readonly<Record<string, ParamValue>> = pinnedParams(flashSwitches)

/**
 * Sun shadows on Safari WebGPU (v26.11.2305 stopgap). The owner's iPhone flashed the whole screen
 * black dozens of times a minute at Medium and High, and not at all with ?shadows=0, at Low (no
 * shadows) or on WebGL 2 (23 November 2026). Until the cause is found and proven fixed on such a
 * device, the cascaded sun shadow is held off on WebKit and touch devices running WebGPU, with
 * the same device test as the mid-pass copies (midPassCopy.ts). ?shadows=1 turns them back on for
 * the visit, to test a fix. Desktop Chromium and every WebGL 2 device keep their shadows.
 */
let shadowsUnproven = false
let shadowsGated = false
/** Set once the backend is known (QualityController.attachRenderer). */
export function gateSunShadows(webgpu: boolean, unproven: boolean, s: FlashSwitches = flashSwitches): void {
  shadowsUnproven = webgpu && unproven
  shadowsGated = shadowsUnproven && !s.shadows1
}

/** Why a parameter is held: the link switch that holds it, or a device gate. */
export interface Pin { value: ParamValue; by: string }

/**
 * Every level-owned parameter held at a value for this visit, and why: the one place that says so,
 * read at run time. A link switch wins over a device gate (?shadows=0 holds shadows off either way).
 */
export function pins(s: FlashSwitches = flashSwitches): Record<string, Pin> {
  const held: Record<string, Pin> = {}
  if (shadowsGated) held['gfx.shadowQuality'] = { value: 0, by: 'device gate: sun shadows not yet proven on this device' }
  const by = (id: string) => id === 'gfx.shadowQuality' ? 'shadows=0' : id === 'gfx.vehicleShading' ? 'shading=0' : 'lowrest=1'
  for (const [id, value] of Object.entries(s === flashSwitches ? flashPins : pinnedParams(s))) held[id] = { value, by: 'link switch ?' + by(id) }
  return held
}

/** The value a level-owned parameter is held at for this visit, or undefined when it is free. */
export function pinnedValue(id: string): ParamValue | undefined { return pins()[id]?.value }

/** For the copied report. */
export function sunShadowsLine(s: FlashSwitches = flashSwitches): string {
  return 'Sun shadows: ' + (s.shadows0 ? 'off: ?shadows=0' : shadowsGated ? 'off: not yet proven on this device'
    : shadowsUnproven ? 'on: ?shadows=1, though not yet proven on this device' : 'on')
}

/** A level's post tier, after ?post=base. (?post=off removes the chain instead: main.ts.) */
export function flashPostTier<T extends string>(tier: T): T | 'base' {
  return flashSwitches.post === 'base' && tier !== 'off' ? 'base' : tier
}

export function flashSwitchLine(s: FlashSwitches = flashSwitches): string {
  const names = flashSwitchNames(s)
  return 'Flash switches: ' + (names.length ? names.join(', ') : 'none')
}
