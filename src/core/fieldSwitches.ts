/**
 * The link switches (core/flashSwitches.ts) as switches in the running game: Performance,
 * Diagnostics, Field switches (the owner, 23 November 2026: "Is it possible to also have all of
 * these be checkboxes inside the performance card from inside the running game?").
 *
 * One state. `flashSwitches` is the only record: read from the address at start, changed here,
 * and every change is written back into the address (history.replaceState), so a reload keeps
 * the visit's switches and "Copy link" is the address itself. A box and its link switch cannot
 * disagree, because they are the same field.
 *
 * Nothing saved. This module writes to no storage. Pinned parameters reach the game only through
 * the quality controller's own write (QualityController.refreshPins), which is not recorded as
 * the player's override and so is never saved with the level; Flat glass for the visit goes
 * through setGlassForVisit, which skips the saved style. Close the tab and every switch is gone;
 * only a link that carries them brings them back.
 *
 * Live or not, read from where each switch acts:
 *  - live: shadows, shading, lowrest (pinned parameters, written again now), post=base (the post
 *    chain asks for its tier every frame), post=off (the game takes or drops its post chain),
 *    freeze (the governor checks it every frame), ui=flat, blank (the recorder and its counter).
 *  - after a reload: samples=1 (antialias is fixed when the renderer is made, Game.ts) and
 *    webgl=1 (the backend is chosen when the renderer is made, Game.ts).
 */
import { flashPins, flashSwitches, pinnedParams, type FlashSwitches } from './flashSwitches'
import type { ParamValue } from '../../shared/params'

export type SwitchKey = 'blank' | 'shadows0' | 'shading0' | 'postBase' | 'postOff' | 'samples1' | 'lowRest' | 'freeze' | 'uiFlat' | 'webgl'

/** How the rows group the switches; a group is a sub-heading. */
export type SwitchGroup = 'Graphics' | 'Renderer' | 'Interface' | 'Governor' | 'Recorder'

/**
 * One link switch. The single list (FIELD_SWITCHES): the rows, the copied link, the report's
 * names and the documentation table (fieldSwitchTable) are all read from it, so a new switch
 * is one entry here (and the place in the game that acts on it).
 */
export interface FieldSwitch {
  key: SwitchKey
  /** The name in the address, and the value that turns it on: ?name=value. */
  name: string
  value: string
  /** In plain words, as the row says it. */
  label: string
  /** True: it applies at once. False: it applies after a reload. */
  live: boolean
  group: SwitchGroup
  /** What it does, in a sentence, for the documentation table. */
  note: string
}

export const FIELD_SWITCHES: readonly FieldSwitch[] = [
  { key: 'shadows0', name: 'shadows', value: '0', label: 'Sun shadows off', live: true, group: 'Graphics', note: 'No sun shadows (gfx.shadowQuality 0, as at Low).' },
  { key: 'shading0', name: 'shading', value: '0', label: 'Plain vehicle shading', live: true, group: 'Graphics', note: 'Plain vehicle materials (gfx.vehicleShading 0, as at Low).' },
  { key: 'postBase', name: 'post', value: 'base', label: 'Post effects at their base tier', live: true, group: 'Graphics', note: 'The post chain\'s base tier, the look pass only, as at Low: no sun shaft passes.' },
  { key: 'postOff', name: 'post', value: 'off', label: 'No post effects at all', live: true, group: 'Graphics', note: 'No post chain, the scene straight to the canvas; implies Flat interface glass.' },
  { key: 'lowRest', name: 'lowrest', value: '1', label: 'Other Medium settings at Low', live: true, group: 'Graphics', note: 'Water ripple size, fog bank samples, ground cover and tyre mark life at their Low values.' },
  { key: 'samples1', name: 'samples', value: '1', label: 'No multisampling', live: false, group: 'Renderer', note: 'The scene drawn with one sample; antialias is fixed when the renderer is made.' },
  { key: 'webgl', name: 'webgl', value: '1', label: 'WebGL 2 instead of WebGPU', live: false, group: 'Renderer', note: 'The WebGL 2 backend; the backend is chosen when the renderer is made.' },
  { key: 'freeze', name: 'freeze', value: '1', label: 'Quality governor frozen', live: true, group: 'Governor', note: 'No rung, level or bot steps; the render scale stays put.' },
  { key: 'uiFlat', name: 'ui', value: 'flat', label: 'Flat interface glass', live: true, group: 'Interface', note: 'Flat interface glass for this visit; the saved style is kept.' },
  { key: 'blank', name: 'blank', value: '1', label: 'Blank frame counter on screen', live: true, group: 'Recorder', note: 'The blank-frame recorder on, its counter on screen with a Test flash control.' },
]

/** ?name=value for a switch. */
export const linkOf = (f: Pick<FieldSwitch, 'name' | 'value'>) => `${f.name}=${f.value}`

/** Every address name a switch uses, once each. */
export const SWITCH_NAMES: readonly string[] = [...new Set(FIELD_SWITCHES.map(f => f.name))]

/** What a live switch needs the game to do now; set by main.ts. */
export interface FieldSwitchHooks {
  /** Write these level-owned parameters again: the pin where there is one, else the level's value. */
  refreshPins(ids: readonly string[]): void
  /** Draw through the post chain, or straight to the canvas. */
  setPost(on: boolean): void
  /** Flat interface glass for this visit, or back to the player's own. */
  setFlatGlass(on: boolean): void
  /** The blank-frame recorder and its on-screen counter. */
  setBlankCounter(on: boolean): void
}

let hooks: Partial<FieldSwitchHooks> = {}
export function setFieldSwitchHooks(next: Partial<FieldSwitchHooks>): void { hooks = { ...hooks, ...next } }

const webglAtStart = typeof location !== 'undefined' && new URLSearchParams(location.search).has('webgl')
let webgl = webglAtStart
/** ?ui=flat turned on only because ?post=off was ticked; it goes with it. */
let flatForPostOff = false

export function isOn(key: SwitchKey, s: FlashSwitches = flashSwitches): boolean {
  switch (key) {
    case 'postBase': return s.post === 'base'
    case 'postOff': return s.post === 'off'
    case 'webgl': return webgl
    default: return s[key]
  }
}

/** A reload-only switch whose box differs from what this page was started with. */
export function pendingReload(): boolean {
  return FIELD_SWITCHES.some(f => !f.live && isOn(f.key) !== startedWith[f.key])
}
const startedWith = Object.fromEntries(FIELD_SWITCHES.map(f => [f.key, isOn(f.key)])) as Record<SwitchKey, boolean>

const listeners = new Set<() => void>()
export function onFieldSwitches(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Turn one switch on or off for this visit, live where it can be, and write it into the address. */
export function setFieldSwitch(key: SwitchKey, on: boolean): void {
  if (isOn(key) === on) return
  const before = { ...flashPins }
  const s = flashSwitches
  switch (key) {
    case 'postBase': s.post = on ? 'base' : s.post === 'base' ? null : s.post; break
    case 'postOff': {
      s.post = on ? 'off' : s.post === 'off' ? null : s.post
      hooks.setPost?.(!on)
      // The post chain draws the Liquid glass: without it the interface takes Flat, as ?post=off
      // does at start (flashSwitches.ts), and gives it back after unless Flat was on already.
      if (on && !s.uiFlat) { s.uiFlat = true; flatForPostOff = true; hooks.setFlatGlass?.(true) }
      if (!on && flatForPostOff) { s.uiFlat = false; flatForPostOff = false; hooks.setFlatGlass?.(false) }
      break
    }
    case 'webgl': webgl = on; break
    default: s[key] = on
  }
  if (key === 'uiFlat') { flatForPostOff = false; hooks.setFlatGlass?.(on) }
  if (key === 'blank') hooks.setBlankCounter?.(on)
  // The pins follow the switches; every id that gained or lost a pin is written again now.
  const after = pinnedParams(s), pins = flashPins as Record<string, ParamValue>
  for (const id of Object.keys(pins)) delete pins[id]
  Object.assign(pins, after)
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => before[id] !== after[id])
  if (changed.length) hooks.refreshPins?.(changed)
  writeAddress()
  for (const fn of listeners) fn()
}

/** The address with every active switch in it, and every other query left as it was. */
export function linkWithSwitches(href: string = location.href): string {
  const url = new URL(href)
  const q = url.searchParams
  for (const name of SWITCH_NAMES) q.delete(name)
  for (const f of FIELD_SWITCHES) {
    if (!isOn(f.key)) continue
    // ?post=off already means flat glass (flashSwitches.ts); ui=flat beside it would only repeat it.
    if (f.key === 'uiFlat' && flashSwitches.post === 'off') continue
    q.set(f.name, f.value)
  }
  return url.toString()
}

function writeAddress(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return
  const next = linkWithSwitches()
  if (next !== location.href) history.replaceState(history.state, '', next)
}

/** Reload to the address with these switches in it (it already carries them). */
export function reloadWithSwitches(): void { writeAddress(); location.reload() }

/** For the copied report: every switch that is on, as ?name=value, in the list's order. */
export function fieldSwitchNames(s: FlashSwitches = flashSwitches): string[] {
  return FIELD_SWITCHES.filter(f => isOn(f.key, s)).map(linkOf)
}

/** The documentation table (README), from the list: link, what it does, live or after reload. */
export function fieldSwitchTable(): string {
  const rows = FIELD_SWITCHES.map(f => `| \`?${linkOf(f)}\` | ${f.label}. ${f.note} | ${f.live ? 'at once' : 'after a reload'} |`)
  return ['| Link | What it does | Applies |', '| --- | --- | --- |', ...rows].join('\n')
}
