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
 *   ?frameCanary=1      count WebGPU command buffers the browser accepted and never ran
 *                       (core/frameCanary.ts), on screen in the ?blank=1 counter box
 *   ?canvasAlpha=opaque  the canvas configured opaque (three's alpha false): another WebKit
 *                       compositing path for the drawn frame
 *   ?presentHold=1      no new frame while the previous frame's GPU work is unfinished
 *                       (Game.ts), so at most one frame is in flight
 *   ?canvasBackdrop=1   a magenta page behind the canvas in play: a frame shown with nothing
 *                       drawn in it (transparent) flashes magenta, not black
 *   ?frameProbe=1       what our passes drew, frame by frame: the scene image and the canvas read
 *                       back on the GPU and classified (core/frameProbe.ts), in the same counter box
 *   ?shadowCascades=1   one sun shadow cascade instead of the level's two or three
 *   ?shadowMap=512      a fixed sun shadow cascade size: 512, 1024 or 2048
 *   ?shadowColor=0      depth-only sun shadow maps: no colour target or attachment per cascade
 *   ?shadowFilter=hard  basic shadow maps: one depth compare, no filtering
 *   ?shadowFade=0       no blend between sun shadow cascades
 *   ?presentLate=1      the canvas texture taken at the end of the frame and filled with one copy
 *                       (core/presentLate.ts), not taken first and held across the frame
 *   ?frameCap=30        in play, draw at most every 30 ms: about 30 frames a second
 *   ?shadowUpdate=once  sun shadow maps drawn once and then reused (and again on a level change)
 *   ?shadowUpdate=2     sun shadow maps drawn every second frame
 * The five shadow switches shape how shadows are drawn, not whether: with shadows off (Low, ?shadows=0,
 * or the device gate below) they change nothing. They are build choices of the shadow node, not
 * level-owned parameters, so they are read here and applied where the shadow is built
 * (world/Environment.ts, Game.ts), not held through pins(). All take effect after a reload.
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
  frameCanary: boolean
  frameProbe: boolean
  canvasOpaque: boolean
  presentHold: boolean
  canvasBackdrop: boolean
  /** Sun shadow cascades for every level, or null for the level's own. */
  shadowCascades: number | null
  /** Sun shadow cascade size for every level, or null for the level's own. */
  shadowMap: 512 | 1024 | 2048 | null
  shadowColor0: boolean
  shadowHard: boolean
  shadowFade0: boolean
  presentLate: boolean
  frameCap30: boolean
  shadowOnce: boolean
  shadowEvery2: boolean
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
    frameCanary: on(q, 'frameCanary'),
    frameProbe: on(q, 'frameProbe'),
    canvasOpaque: q.get('canvasAlpha') === 'opaque',
    presentHold: on(q, 'presentHold'),
    canvasBackdrop: on(q, 'canvasBackdrop'),
    shadowCascades: on(q, 'shadowCascades') ? 1 : null,
    shadowMap: q.get('shadowMap') === '512' ? 512 : q.get('shadowMap') === '1024' ? 1024 : q.get('shadowMap') === '2048' ? 2048 : null,
    shadowColor0: on(q, 'shadowColor', '0'),
    shadowHard: q.get('shadowFilter') === 'hard',
    shadowFade0: on(q, 'shadowFade', '0'),
    presentLate: on(q, 'presentLate'),
    frameCap30: on(q, 'frameCap', '30'),
    shadowOnce: on(q, 'shadowUpdate', 'once'),
    shadowEvery2: on(q, 'shadowUpdate', '2'),
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
    s.frameCanary && 'frameCanary=1', s.frameProbe && 'frameProbe=1', s.canvasOpaque && 'canvasAlpha=opaque', s.presentHold && 'presentHold=1', s.canvasBackdrop && 'canvasBackdrop=1', s.shadowCascades && 'shadowCascades=' + s.shadowCascades, s.shadowMap && 'shadowMap=' + s.shadowMap,
    s.shadowColor0 && 'shadowColor=0', s.shadowHard && 'shadowFilter=hard', s.shadowFade0 && 'shadowFade=0',
    s.presentLate && 'presentLate=1', s.frameCap30 && 'frameCap=30', s.shadowOnce && 'shadowUpdate=once', s.shadowEvery2 && 'shadowUpdate=2',
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

/**
 * The gate again after ?shadows=1 changes in play (Performance, Diagnostics, Field switches:
 * core/fieldSwitches.ts). The device was found when the renderer was attached; only the switch
 * changed, so this needs nothing from the renderer.
 */
export function regateSunShadows(s: FlashSwitches = flashSwitches): void { shadowsGated = shadowsUnproven && !s.shadows1 }
/** True on a device where sun shadows are not yet proven (whether or not ?shadows=1 lifts the gate). */
export function sunShadowsUnproven(): boolean { return shadowsUnproven }
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
