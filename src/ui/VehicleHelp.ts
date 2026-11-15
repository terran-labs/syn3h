import type { VehicleKind } from '../vehicles'

export function vehicleHelp(kind: VehicleKind): string[] {
  // Lift-off first: on the ground W only tips the nose, and the throttle is what flies.
  if (kind === 'jet') return ['Hold R to lift off and climb · F: come down', 'W / S: nose down / up · A / D: bank · Q / E: yaw', 'Space: switch hover and flight', 'Shift: brake · X: zorb ball']
  if (kind === 'hovercraft') return ['W: thrust forward · A / D: turn', 'S: pitch · Shift: brake · X: zorb ball']
  return ['W / S or arrows: drive · A / D: steer', 'Shift: brake · Space: force field wings', 'With wings: W / S pitch · A / D roll', 'L or click: tag beam · X: zorb ball']
}
/** Shown only while the host allows more than one kind of gear. Wording agreed with the Weapons lane. */
export const gearHelp = ['T: switch gear · Bungee: hold L or click to reel in · V or wheel: let out · G: let go', 'Gamepad: D-pad left and right: switch gear · LB: let out · RB: let go']
export const gearTouchHelp = 'Tap the Gear chip to switch gear. With the Bungee: hold TAG to reel in, LET OUT to pay out, LET GO to drop it.'
export const cameraHelp = ['Click: capture the mouse, then move it to look round · Esc: release', 'C: chase, cockpit, orbit, stationary, roam · Right click: cockpit', 'Wheel or + / −: distance · Z: scope']
export function touchHelp(kind: VehicleKind): string {
  return kind === 'jet' ? 'Hold THR + to lift off, THR − to come down. Left thumb: pitch and bank. MODE: hover or flight. BRAKE: slow down. ZORB: ride in a ball.' : kind === 'hovercraft' ? 'Left thumb: thrust, turn and pitch. BRAKE: slow down. ZORB: ride in a ball.' : 'Left thumb: drive and steer. WINGS: deploy wings. BRAKE: slow down. TAG: send a tag beam. ZORB: ride in a ball.'
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
  return ['WASD or arrows: drive · Shift: brake', 'Space: wings · L or click: tag beam', MOUSE_LOOK]
}
export function renderHelp(element: HTMLElement, kind: VehicleKind, touch = false, quick = false, gear = false): void {
  element.replaceChildren()
  const lines = quick ? quickHelp(kind, touch) : touch ? [touchHelp(kind), ...(gear ? [gearTouchHelp] : [])] : [...vehicleHelp(kind), ...(gear ? gearHelp : []), ...cameraHelp]
  for (const text of lines) { const line = document.createElement('div'); line.textContent = text; element.append(line) }
}
