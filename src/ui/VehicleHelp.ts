import type { VehicleKind } from '../vehicles'
import { keycap, shortcut } from './keycap'

export function vehicleHelp(kind: VehicleKind): string[] {
  // Lift-off first: on the ground W only tips the nose, and the throttle is what flies.
  if (kind === 'jet') return ['Hold E to lift off and climb · Q: come down', 'W / S: nose down / up · A / D: bank', 'Space: switch hover and flight · in flight E / Q: more / less thrust', 'Shift: brake · X: zorb ball']
  if (kind === 'hovercraft') return ['W: thrust forward · A / D: turn', 'S: pitch · Shift: brake · X: zorb ball']
  return ['W / S or arrows: drive · A / D: steer', 'Shift: brake · Space: force field wings', 'With wings: W / S pitch · A / D roll', 'L or click: Plasma Tag · X: zorb ball']
}
/** Shown only while the host allows more than one kind of gear. Wording agreed with the Weapons lane. */
export const gearHelp = [
  'Number keys 1 to 9: choose a gear · L or left mouse: use gear',
  'Grapple: click to launch · hold to reel in · V or wheel: let out · G: let go',
  'Yoink: aim at a vehicle and hold to grab; release to fling. With no target, press for a gust.',
  'Plasma Thunder: hold until fully charged, then release. Letting go early fizzles.',
  'Chaser: aim at a vehicle and press to send a Chaser after it.',
  'Gamepad: D-pad left and right: switch gear · LB: let out · RB: let go',
]
export const gearTouchHelp = [
  'Tap a gear in the selector to switch. TAG uses the selected gear: hold it and drag to aim at the reticle.',
  'Plasma Tag fires for as long as you hold TAG. Other gear goes when you let go; drag onto Cancel to hold it back.',
  'Grapple: tap TAG to launch, hold TAG to reel in, LET OUT to pay out, LET GO to drop it.',
  'Yoink: aim at a vehicle and hold TAG to grab; let go to fling. With no target, tap TAG for a gust.',
  'Plasma Thunder: hold TAG until fully charged, then let go. Letting go early fizzles.',
  'Chaser: hold TAG, drag to aim at a vehicle, and let go to send a Chaser after it.',
  'Pinch with two fingers on the right to bring the camera in or out.',
]
/** Chat, on a keyboard: the left column's Chat row opens the same. */
export const chatHelp = 'Y: Chat · Enter: send · Esc: close'
export const cameraHelp = ['Click: capture the mouse, then move it to look round · Esc: release', 'C: chase, cockpit, orbit, stationary, roam · Right click: cockpit', 'Wheel or + / −: distance · Z: scope', 'I: interface full, driving or hidden · Esc: back to full']
export function touchHelp(kind: VehicleKind): string {
  return kind === 'jet' ? 'Hold THR + to lift off, THR − to come down. Left thumb: pitch and bank. MODE: hover or flight. BRAKE: slow down. ZORB: ride in a ball.' : kind === 'hovercraft' ? 'Left thumb: thrust, turn and pitch. BRAKE: slow down. ZORB: ride in a ball.' : 'Left thumb: drive and steer. WINGS: deploy wings. BRAKE: slow down. TAG: use your gear (Plasma Tag to start). ZORB: ride in a ball.'
}
/**
 * The few controls worth showing over the game right after Play. The card sits in a corner
 * and must not compete with the first look at the vehicle, the road and the volcano, so
 * this is two lines; H opens the full list from `vehicleHelp` and `cameraHelp`.
 */
/** On a desktop the first click captures the cursor; after that the mouse looks round. */
const MOUSE_LOOK = 'Click, then move the mouse to look round · Esc: release'
/** The last line on a keyboard: the number keys pick gear (when there is a choice) and Y opens Chat. */
const KEYS_LINE = (gear: boolean) => gear ? 'Number keys: choose gear · Y: Chat' : 'Y: Chat'
export function quickHelp(kind: VehicleKind, touch = false, gear = false): string[] {
  if (touch) return [kind === 'jet' ? 'Hold THR + to lift off' : kind === 'hovercraft' ? 'Left thumb: thrust and turn' : 'Left thumb: drive and steer']
  if (kind === 'jet') return ['Hold E to lift off · Q: come down', 'W / S: pitch · A / D: bank · Space: hover or cruise', MOUSE_LOOK, KEYS_LINE(gear)]
  if (kind === 'hovercraft') return ['W: thrust · A / D: turn · Shift: brake', MOUSE_LOOK, KEYS_LINE(gear)]
  return ['WASD or arrows: drive · Shift: brake', 'Space: wings · L or click: Plasma Tag', MOUSE_LOOK, KEYS_LINE(gear)]
}
/** Words a key name is made of: single keys, named keys and the joins between them. */
const KEY_WORDS = new Set(['or', 'and', 'to', 'WASD', 'arrows', 'Space', 'Shift', 'Esc', 'Enter', 'Number', 'keys', 'click', 'Click', 'Right', 'right', 'left', 'mouse', 'Wheel', 'wheel'])
/** True when the text before a colon names keys ("L or click", "W / S"), not a gear or a mode ("Grapple"). */
export function namesKeys(text: string): boolean {
  return text.split(' ').every((w) => /^[A-Z0-9?+\-−/]$/.test(w) || KEY_WORDS.has(w))
}
/**
 * One line of help, split into what to press and what it does. Each " · " part that reads
 * "keys: action" gives its keys as a key glyph (a bright <kbd>, the same form as the left
 * column's, hud-column.css) followed by the action; anything else stays plain text.
 */
export function helpParts(line: string): Array<{ keys?: string; text: string }> {
  return line.split(' · ').map((part) => {
    const at = part.indexOf(': ')
    return at > 0 && namesKeys(part.slice(0, at)) ? { keys: part.slice(0, at), text: part.slice(at + 2) } : { text: part }
  })
}
/**
 * A lone capital letter in a plain part of a help line ("Hold E to lift off", "in flight E /
 * Q", "A / D roll") is a key. A and I are keys only beside a "/" join; elsewhere they are
 * words. A letter joined to a word ("D-pad") is not a key.
 */
const LONE_KEY = /(?<![\w-])([B-HJ-Z]|[AI](?= \/ )|(?<=\/ )[AI])(?![\w-])/
export function inlineParts(text: string): Array<{ key?: string; text?: string }> {
  return text.split(new RegExp(LONE_KEY.source, 'g')).map((piece, i) => i % 2 ? { key: piece } : { text: piece }).filter((p) => p.key ?? p.text)
}
export function inlineKeys(text: string): Node[] {
  return inlineParts(text).map((p) => p.key !== undefined ? keycap(p.key) : document.createTextNode(p.text!))
}
export function renderHelp(element: HTMLElement, kind: VehicleKind, touch = false, quick = false, gear = false): void {
  element.replaceChildren()
  const lines = quick ? quickHelp(kind, touch, gear) : touch ? [touchHelp(kind), ...(gear ? gearTouchHelp : [])] : [...vehicleHelp(kind), ...(gear ? gearHelp : []), chatHelp, ...cameraHelp]
  for (const text of lines) {
    const line = document.createElement('div')
    // Touch has no keys: its lines stay plain text.
    if (touch) line.textContent = text
    else fillHelpLine(line, text)
    element.append(line)
  }
}
/** Fill an element with one help line, its keys as key glyphs. */
export function fillHelpLine(element: HTMLElement, text: string): void {
  element.replaceChildren()
  helpParts(text).forEach((part, i) => {
    if (i) element.append(' · ')
    if (part.keys) element.append(...shortcut(part.keys), ' ')
    element.append(...inlineKeys(part.text))
  })
}
