import type { VehicleKind } from '../vehicles'

export function vehicleHelp(kind: VehicleKind): string[] {
  if (kind === 'jet') return ['R / F: thrust up / down', 'Space: switch hover and flight', 'W / S: nose down / up', 'A / D: bank · Q / E: yaw', 'Shift: brake']
  if (kind === 'hovercraft') return ['W: thrust forward · A / D: turn', 'S: pitch · Shift: brake']
  return ['W / S or arrows: drive · A / D: steer', 'Shift: brake · Space: force field wings', 'With wings: W / S pitch · A / D roll', 'L or click: tag beam']
}
export const cameraHelp = ['C: chase, cockpit, orbit, stationary, roam', 'Right click: cockpit · middle drag or Alt+drag: look', 'Wheel or + / −: distance · Z: scope']
export function touchHelp(kind: VehicleKind): string {
  return kind === 'jet' ? 'Left thumb: pitch and bank. THR + / −: thrust. MODE: hover or flight. BRAKE: slow down.' : kind === 'hovercraft' ? 'Left thumb: thrust, turn and pitch. BRAKE: slow down.' : 'Left thumb: drive and steer. WINGS: deploy wings. BRAKE: slow down. TAG: send a tag beam.'
}
/**
 * The few controls worth showing over the game right after Play. The card sits in a corner
 * and must not compete with the first look at the vehicle, the road and the volcano, so
 * this is two lines; H opens the full list from `vehicleHelp` and `cameraHelp`.
 */
export function quickHelp(kind: VehicleKind, touch = false): string[] {
  if (touch) return [kind === 'jet' ? 'Left thumb: pitch and bank' : kind === 'hovercraft' ? 'Left thumb: thrust and turn' : 'Left thumb: drive and steer']
  if (kind === 'jet') return ['R / F: thrust · W / S: pitch · A / D: bank', 'Space: hover or flight · C: camera']
  if (kind === 'hovercraft') return ['W: thrust · A / D: turn · Shift: brake', 'C: camera']
  return ['WASD or arrows: drive · Shift: brake', 'Space: wings · L: tag beam · C: camera']
}
export function renderHelp(element: HTMLElement, kind: VehicleKind, touch = false, quick = false): void {
  element.replaceChildren()
  const lines = quick ? quickHelp(kind, touch) : touch ? [touchHelp(kind)] : [...vehicleHelp(kind), ...cameraHelp]
  for (const text of lines) { const line = document.createElement('div'); line.textContent = text; element.append(line) }
}
