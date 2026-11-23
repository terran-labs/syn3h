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
 * is on is named in the copied Diagnostics report (flashSwitchLine). They combine freely, and with
 * ?webgl=1 and ?gfx=N.
 *
 *   ?blank=1      the recorder on, its counter on screen, and a Test flash control
 *   ?shadows=0    no sun shadows (gfx.shadowQuality 0, as at Low)
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

export interface FlashSwitches {
  blank: boolean
  shadows0: boolean
  shading0: boolean
  post: 'base' | 'off' | null
  samples1: boolean
  lowRest: boolean
  freeze: boolean
  uiFlat: boolean
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
    shading0: on(q, 'shading', '0'),
    post: post === 'base' || post === 'off' ? post : null,
    samples1: on(q, 'samples'),
    lowRest: on(q, 'lowrest'),
    freeze: on(q, 'freeze'),
    // The post chain draws the Liquid glass; without it the interface takes Flat glass.
    uiFlat: q.get('ui') === 'flat' || post === 'off',
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
    s.blank && 'blank=1', s.shadows0 && 'shadows=0', s.shading0 && 'shading=0', s.post && 'post=' + s.post,
    s.samples1 && 'samples=1', s.lowRest && 'lowrest=1', s.freeze && 'freeze=1', s.uiFlat && 'ui=flat',
  ].filter((name): name is string => !!name)
}

export const flashSwitches: FlashSwitches = readFlashSwitches(typeof location === 'undefined' ? '' : location.search)
export const flashPins: Readonly<Record<string, ParamValue>> = pinnedParams(flashSwitches)

/** A level's post tier, after ?post=base. (?post=off removes the chain instead: main.ts.) */
export function flashPostTier<T extends string>(tier: T): T | 'base' {
  return flashSwitches.post === 'base' && tier !== 'off' ? 'base' : tier
}

export function flashSwitchLine(s: FlashSwitches = flashSwitches): string {
  const names = flashSwitchNames(s)
  return 'Flash switches: ' + (names.length ? names.join(', ') : 'none')
}
