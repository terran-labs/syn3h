import type { VehicleKind } from '../vehicles'

export function vehicleHelp(kind: VehicleKind): string[] {
  // Lift-off first: on the ground W only tips the nose, and the throttle is what flies.
  if (kind === 'jet') return ['Hold R to lift off and climb · F: come down', 'W / S: nose down / up · A / D: bank · Q / E: yaw', 'Space: switch hover and flight', 'Shift: brake · X: zorb ball']
  if (kind === 'hovercraft') return ['W: thrust forward · A / D: turn', 'S: pitch · Shift: brake · X: zorb ball']
  return ['W / S or arrows: drive · A / D: steer', 'Shift: brake · Space: force field wings', 'With wings: W / S pitch · A / D roll', 'L or click: Plasma Tag · X: zorb ball']
}
/** Shown only while the host allows more than one kind of gear. Wording agreed with the Weapons lane. */
export const gearHelp = [
  'T: switch gear · L or left mouse: use gear',
  'Grapple: click to launch · hold to reel in · V or wheel: let out · G: let go',
  'Yoink: aim at a vehicle and hold to grab; release to fling. With no target, press for a gust.',
  'Plasma Thunder: hold until fully charged, then release. Letting go early fizzles.',
  'Chaser: aim at a vehicle and press to send a Chaser after it.',
  'Gamepad: D-pad left and right: switch gear · LB: let out · RB: let go',
]
export const gearTouchHelp = [
  'Tap a gear in the selector to switch. TAG uses the selected gear.',
  'Grapple: tap TAG to launch, hold TAG to reel in, LET OUT to pay out, LET GO to drop it.',
  'Yoink: aim at a vehicle and hold TAG to grab; release to fling. With no target, tap TAG for a gust.',
  'Plasma Thunder: hold TAG until fully charged, then release. Letting go early fizzles.',
  'Chaser: aim at a vehicle and tap TAG to send a Chaser after it.',
]
export const cameraHelp = ['Click: capture the mouse, then move it to look round · Esc: release', 'C: chase, cockpit, orbit, stationary, roam · Right click: cockpit', 'Wheel or + / −: distance · Z: scope']
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
export function quickHelp(kind: VehicleKind, touch = false): string[] {
  if (touch) return [kind === 'jet' ? 'Hold THR + to lift off' : kind === 'hovercraft' ? 'Left thumb: thrust and turn' : 'Left thumb: drive and steer']
  if (kind === 'jet') return ['Hold R to lift off · F: come down', 'W / S: pitch · A / D: bank · Space: flight mode', MOUSE_LOOK]
  if (kind === 'hovercraft') return ['W: thrust · A / D: turn · Shift: brake', MOUSE_LOOK]
  return ['WASD or arrows: drive · Shift: brake', 'Space: wings · L or click: Plasma Tag', MOUSE_LOOK]
}
export function renderHelp(element: HTMLElement, kind: VehicleKind, touch = false, quick = false, gear = false): void {
  element.replaceChildren()
  const lines = quick ? quickHelp(kind, touch) : touch ? [touchHelp(kind), ...(gear ? gearTouchHelp : [])] : [...vehicleHelp(kind), ...(gear ? gearHelp : []), ...cameraHelp]
  for (const text of lines) { const line = document.createElement('div'); line.textContent = text; element.append(line) }
}
