/**
 * The link switches (core/flashSwitches.ts) as switches in the running game: Performance,
 * Diagnostics, Field switches (the owner, 23 November 2026: "Is it possible to also have all of
 * these be checkboxes inside the performance card from inside the running game?").
 *
 * One list. FIELD_SWITCHES is every link switch that diagnoses the renderer: the rows, the copied
 * link, the report's "Flash switches" line and the README's field switch table (between its
 * field-switches markers) are all read from it, so a new switch is one entry here plus the
 * place in the game that acts on it.
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
 *  - live: shadows=0 and =1, shading, lowrest (pinned parameters, written again now; the sun
 *    shadow gate is worked out again from the device it already knows), post=base (the post
 *    chain asks for its tier every frame), post=off (the game takes or drops its post chain),
 *    freeze (the governor checks it every frame), ui=flat, blank (the recorder and its counter).
 *  - after a reload: samples=1 (antialias is fixed when the renderer is made, Game.ts), webgl=1
 *    (the backend is chosen then) and gpuTrace=1 (allocations are wrapped then, Game.ts).
 *  - not rows: gfx=N (a level for one load; the card's level picker does it live) and diag=1
 *    (it opens Diagnostics, where these rows are). They are kept in a copied link and named
 *    in the report like the rest.
 */
import { flashPins, flashSwitches, pinnedParams, pins, regateSunShadows, type FlashSwitches } from './flashSwitches'
import type { ParamValue } from '../../shared/params'

export type SwitchKey = 'blank' | 'shadows0' | 'shadows1' | 'shading0' | 'postBase' | 'postOff' | 'samples1' | 'lowRest' | 'freeze' | 'uiFlat' | 'webgl' | 'gpuTrace' | 'gfx' | 'diag'
  | 'frameCanary' | 'frameProbe' | 'shadowCascades' | 'shadowMap512' | 'shadowMap1024' | 'shadowMap2048' | 'shadowColor0' | 'shadowHard' | 'shadowFade0'

/** How the rows group the switches; a group is a sub-heading. */
export type SwitchGroup = 'Graphics' | 'Sun shadows' | 'Renderer' | 'Interface' | 'Governor' | 'Recorder'

/**
 * One link switch. The single list (FIELD_SWITCHES): the rows, the copied link, the report's
 * names and the documentation table (fieldSwitchTable) are all read from it.
 */
export interface FieldSwitch {
  key: SwitchKey
  /** The name in the address, and the value that turns it on: ?name=value. */
  name: string
  value: string
  /** The values the documentation lists. */
  values: string
  /** In plain words, as the row says it. */
  label: string
  /** What it does, for the documentation table. */
  note: string
  /** True: it applies at once. False: it applies after a reload. */
  live: boolean
  group: SwitchGroup
  /** False: not a row of its own (a device gate's row forces it, or the card already does it). */
  row: boolean
  /** Entries that share a name and a choice are one row: a choice among their values, or none. */
  choice?: string
}

export const FIELD_SWITCHES: readonly FieldSwitch[] = [
  { key: 'shadows0', name: 'shadows', value: '0', values: '`0`', label: 'Sun shadows off', note: 'No sun shadows, as at Low, at every level.', live: true, group: 'Graphics', row: true },
  { key: 'shadows1', name: 'shadows', value: '1', values: '`1`', label: 'Sun shadows on where not yet proven', note: 'Sun shadows on where they are held off as not yet proven: WebGPU on Safari, iPhone, iPad and other touch devices. In play it is the sun shadow row under the device gates.', live: true, group: 'Graphics', row: false },
  { key: 'shading0', name: 'shading', value: '0', values: '`0`', label: 'Plain vehicle shading', note: 'Plain vehicle materials, as at Low, at every level.', live: true, group: 'Graphics', row: true },
  { key: 'postBase', name: 'post', value: 'base', values: '`base`', label: 'Post effects at their base tier', note: 'Only the base tier of the post chain (the look pass, as at Low): no sun shafts or other upper tier passes.', live: true, group: 'Graphics', row: true },
  { key: 'postOff', name: 'post', value: 'off', values: '`off`', label: 'No post effects at all', note: 'No post chain: the scene is drawn straight to the canvas, with Flat interface glass.', live: true, group: 'Graphics', row: true },
  { key: 'lowRest', name: 'lowrest', value: '1', values: '`1`', label: 'Other Medium settings at Low', note: 'Hold the remaining Medium differences at their Low values: water ripple size, fog bank samples, ground cover and tyre mark life.', live: true, group: 'Graphics', row: true },
  { key: 'gfx', name: 'gfx', value: 'N', values: '`0` to `5`', label: 'Quality level for this visit', note: 'Pin the quality level for this visit, as choosing it by hand does: 0 Minimal, 1 Low, 2 Medium, 3 High, 4 Ultra, 5 Cinematic. Nothing is saved unless you change a setting. In play the card\'s level picker does the same.', live: false, group: 'Graphics', row: false },
  // How sun shadows are drawn, not whether: with shadows off they change nothing, so their rows show
  // only while shadows are on. Build choices of the shadow node (world/Environment.ts, Game.ts),
  // read once at start: all after a reload.
  { key: 'shadowCascades', name: 'shadowCascades', value: '1', values: '`1`', label: 'One shadow cascade', note: 'One sun shadow cascade instead of the level\'s two or three.', live: false, group: 'Sun shadows', row: true },
  { key: 'shadowMap512', name: 'shadowMap', value: '512', values: '`512`', label: '512', note: 'Every sun shadow cascade 512 pixels square, whatever the level.', live: false, group: 'Sun shadows', row: true, choice: 'Shadow map size' },
  { key: 'shadowMap1024', name: 'shadowMap', value: '1024', values: '`1024`', label: '1024', note: 'Every sun shadow cascade 1024 pixels square, whatever the level.', live: false, group: 'Sun shadows', row: true, choice: 'Shadow map size' },
  { key: 'shadowMap2048', name: 'shadowMap', value: '2048', values: '`2048`', label: '2048', note: 'Every sun shadow cascade 2048 pixels square, whatever the level.', live: false, group: 'Sun shadows', row: true, choice: 'Shadow map size' },
  { key: 'shadowColor0', name: 'shadowColor', value: '0', values: '`0`', label: 'Depth-only shadow maps', note: 'Depth-only sun shadow maps: no colour target beside each cascade\'s depth.', live: false, group: 'Sun shadows', row: true },
  { key: 'shadowHard', name: 'shadowFilter', value: 'hard', values: '`hard`', label: 'Hard-edged shadows', note: 'Basic shadow maps: one depth comparison per pixel, no soft filtering.', live: false, group: 'Sun shadows', row: true },
  { key: 'shadowFade0', name: 'shadowFade', value: '0', values: '`0`', label: 'No blending between cascades', note: 'No blend between one sun shadow cascade and the next.', live: false, group: 'Sun shadows', row: true },
  { key: 'samples1', name: 'samples', value: '1', values: '`1`', label: 'No multisampling', note: 'Draw the scene without multisampling. Antialias is fixed when the renderer is made.', live: false, group: 'Renderer', row: true },
  { key: 'webgl', name: 'webgl', value: '1', values: 'present, any value', label: 'WebGL 2 instead of WebGPU', note: 'Start on WebGL 2 instead of WebGPU. The backend is chosen when the renderer is made.', live: false, group: 'Renderer', row: true },
  { key: 'gpuTrace', name: 'gpuTrace', value: '1', values: 'present, any value', label: 'Count live GPU memory exactly', note: 'Count live WebGPU texture and buffer bytes exactly, by wrapping every allocation, and add a "Live WebGPU memory (gpuTrace)" line to the report. The wrapping starts with the renderer.', live: false, group: 'Renderer', row: true },
  { key: 'freeze', name: 'freeze', value: '1', values: '`1`', label: 'Quality governor frozen', note: 'Freeze the quality governor: no level, rung or bot count changes, and the render scale stays fixed.', live: true, group: 'Governor', row: true },
  { key: 'uiFlat', name: 'ui', value: 'flat', values: '`flat`', label: 'Flat interface glass', note: 'Flat interface glass for this visit. The saved choice is kept.', live: true, group: 'Interface', row: true },
  { key: 'blank', name: 'blank', value: '1', values: '`1`', label: 'Blank frame counter on screen', note: 'Turn the blank-frame recorder on, with its counter on screen in play and a Test flash button that shows whether the recorder can see frames in this browser.', live: true, group: 'Recorder', row: true },
  { key: 'frameCanary', name: 'frameCanary', value: '1', values: '`1`', label: 'Dropped frame counter on screen', note: 'Count WebGPU command buffers the browser accepted but never ran, which shows on screen as a black frame and which Safari reports nowhere, in the same on-screen counter as ?blank=1 and in the report. It starts with the renderer.', live: false, group: 'Recorder', row: true },
  { key: 'frameProbe', name: 'frameProbe', value: '1', values: '`1`', label: 'Black frame probe on screen', note: 'Read a grid of pixels back from the scene image and from the picture handed to the screen after every frame in play, and count frames where either is black, transparent or not a number, and frames where the sun shadow or exposure values are not finite, in the same on-screen counter as ?blank=1 and in the report. WebGPU only; it starts with the renderer.', live: false, group: 'Recorder', row: true },
  { key: 'diag', name: 'diag', value: '1', values: '`1`', label: 'Diagnostics open at load', note: 'Start diagnostic sampling at load, as opening the Diagnostics fold of the Performance card does.', live: false, group: 'Recorder', row: false },
]

/** ?name=value for a switch, with the visit's own value for one that takes a number (gfx). */
export const linkOf = (f: Pick<FieldSwitch, 'key' | 'name' | 'value'>, s: FlashSwitches = flashSwitches) =>
  f.key === 'gfx' ? `gfx=${s.gfx ?? 'N'}` : `${f.name}=${f.value}`

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

/** ?gpuTrace is not one of the flash switches; Game.ts reads it once at start, as this does. */
let gpuTrace = typeof location !== 'undefined' && new URLSearchParams(location.search).has('gpuTrace')
/** ?ui=flat turned on only because ?post=off was ticked; it goes with it. */
let flatForPostOff = false

export function isOn(key: SwitchKey, s: FlashSwitches = flashSwitches): boolean {
  switch (key) {
    case 'postBase': return s.post === 'base'
    case 'postOff': return s.post === 'off'
    case 'gfx': return s.gfx !== undefined
    case 'gpuTrace': return gpuTrace
    case 'shadowCascades': return s.shadowCascades !== null
    case 'shadowMap512': return s.shadowMap === 512
    case 'shadowMap1024': return s.shadowMap === 1024
    case 'shadowMap2048': return s.shadowMap === 2048
    default: return s[key]
  }
}

const startedWith = Object.fromEntries(FIELD_SWITCHES.map(f => [f.key, isOn(f.key)])) as Record<SwitchKey, boolean>
/** A reload-only switch whose box differs from what this page was started with. */
export function pendingReload(): boolean {
  return FIELD_SWITCHES.some(f => f.row && !f.live && isOn(f.key) !== startedWith[f.key])
}

const listeners = new Set<() => void>()
export function onFieldSwitches(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }

const heldValues = () => Object.fromEntries(Object.entries(pins()).map(([id, pin]) => [id, pin.value]))

/** Turn one switch on or off for this visit, live where it can be, and write it into the address. */
export function setFieldSwitch(key: SwitchKey, on: boolean): void {
  if (isOn(key) === on || key === 'gfx') return
  const before = heldValues()
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
    // ?shadows=0 and ?shadows=1 are one name: turning one on turns the other off.
    case 'shadows0': s.shadows0 = on; if (on) s.shadows1 = false; break
    case 'shadows1': s.shadows1 = on; if (on) s.shadows0 = false; break
    case 'gpuTrace': gpuTrace = on; break
    case 'shadowCascades': s.shadowCascades = on ? 1 : null; break
    case 'shadowMap512': case 'shadowMap1024': case 'shadowMap2048': {
      const size = Number(key.slice('shadowMap'.length)) as 512 | 1024 | 2048
      s.shadowMap = on ? size : s.shadowMap === size ? null : s.shadowMap
      break
    }
    default: s[key] = on
  }
  if (key === 'uiFlat') { flatForPostOff = false; hooks.setFlatGlass?.(on) }
  if (key === 'blank') hooks.setBlankCounter?.(on)
  // The pins follow the switches (and the sun shadow gate follows ?shadows=1); every id that
  // gained, lost or changed a pin is written again now.
  const pinsNow = flashPins as Record<string, ParamValue>
  for (const id of Object.keys(pinsNow)) delete pinsNow[id]
  Object.assign(pinsNow, pinnedParams(s))
  regateSunShadows(s)
  const after = heldValues()
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => before[id] !== after[id])
  if (changed.length) hooks.refreshPins?.(changed)
  writeAddress()
  for (const fn of listeners) fn()
}

/** The address with every active switch in it, and every other query left as it was. */
export function linkWithSwitches(href: string = location.href): string {
  const url = new URL(href)
  const q = url.searchParams
  // Only what the list owns: ?post=1 and ?post=0 (the post effects setting) share a name with
  // ?post=base and ?post=off and are left alone. A switch on any value (webgl, gpuTrace, gfx) owns them all.
  for (const name of SWITCH_NAMES) {
    const value = q.get(name)
    if (value === null) continue
    const owners = FIELD_SWITCHES.filter(f => f.name === name)
    if (owners.some(f => f.value === value || f.values === 'present, any value' || f.key === 'gfx')) q.delete(name)
  }
  for (const f of FIELD_SWITCHES) {
    if (!isOn(f.key)) continue
    // ?post=off already means flat glass (flashSwitches.ts); ui=flat beside it would only repeat it.
    if (f.key === 'uiFlat' && flashSwitches.post === 'off') continue
    const [name, value] = linkOf(f).split('=')
    q.set(name, value)
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
  return FIELD_SWITCHES.filter(f => isOn(f.key, s)).map(f => linkOf(f, s))
}

/** The report's line. */
export function fieldSwitchLine(s: FlashSwitches = flashSwitches): string {
  const names = fieldSwitchNames(s)
  return 'Flash switches: ' + (names.length ? names.join(', ') : 'none')
}

/** The documentation table (README, between its field-switches markers), from the list. */
export function fieldSwitchTable(): string {
  const rows = FIELD_SWITCHES.map(f => `| \`?${f.key === 'gfx' ? 'gfx=N' : linkOf(f)}\` | ${f.values} | ${f.choice ? `${f.choice}: ` : ''}${f.note} | ${f.live ? 'at once' : 'after a reload'} |`)
  return ['| Switch | Values | What it does | In play |', '| --- | --- | --- | --- |', ...rows].join('\n')
}
