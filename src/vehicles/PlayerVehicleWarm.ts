import * as THREE from 'three/webgpu'
import type { CoveredWarm, Game } from '../core/Game'
import { Jet } from './Jet'
import { Syn3hBuggy } from './Syn3hBuggy'
import type { Vehicle } from './Vehicle'

/** Draw the actual cached local model at full size in the covered camera's view. */
export function drawPlayerVehicleWarm(game: Game, player: Vehicle, vehicle: Vehicle, warm: CoveredWarm): void {
  const parked = vehicle !== player
  const draw = () => warm.draw(vehicle.kind)
  const bodyDraw = () => {
    if (vehicle instanceof Jet) vehicle.drawCoveredGear(parked, draw)
    else if (vehicle instanceof Syn3hBuggy) vehicle.drawCoveredMotorSparks(() => vehicle.drawCoveredWings(parked, draw))
    else draw()
  }
  if (!parked) {
    // Keep the live interpolation, physics and pose. Only the model's hidden
    // renderable mechanisms are temporarily exposed by the body draw.
    bodyDraw()
    return
  }

  const root = vehicle.object
  const position = root.position.clone(), rotation = root.quaternion.clone()
  const visible = root.visible
  const eye = game.camera.getWorldPosition(new THREE.Vector3())
  const forward = game.camera.getWorldDirection(new THREE.Vector3())

  try {
    // Only the drawable is attached. Its Rapier body and systems stay parked.
    game.scene.add(root)
    vehicle.update(0, 1)
    root.position.copy(eye).addScaledVector(forward, Math.max(22, game.camera.near * 2))
    root.quaternion.copy(player.object.quaternion)
    root.visible = true
    bodyDraw()
  } finally {
    root.removeFromParent()
    root.position.copy(position)
    root.quaternion.copy(rotation)
    root.visible = visible
    root.updateMatrixWorld(true)
  }
}
