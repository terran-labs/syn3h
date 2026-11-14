/**
 * Seam: sky, sun, shadows and fog. Nothing is baked: everything follows one sun direction.
 * Owner: sky and lighting work. This placeholder is a fixed sun and a flat sky colour.
 */
import * as THREE from 'three/webgpu'
import type { Game, System } from '../core/Game'
import type { Terrain } from './Terrain'

export interface Environment extends System {
  /** Unit vector pointing from the ground toward the sun. Other systems may read it. */
  readonly sunDirection: THREE.Vector3
}

export function createEnvironment(game: Game, _terrain: Terrain): Environment {
  const sunDirection = new THREE.Vector3(0.4, 0.7, 0.3).normalize()
  const sun = new THREE.DirectionalLight(0xfff0dd, 3)
  sun.position.copy(sunDirection).multiplyScalar(200)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const c = sun.shadow.camera
  c.left = c.bottom = -60
  c.right = c.top = 60
  c.near = 1
  c.far = 600
  game.scene.add(sun, sun.target)
  game.scene.add(new THREE.HemisphereLight(0xffc9a0, 0x402018, 0.8))
  game.scene.background = new THREE.Color(0xd9a27a)
  game.scene.fog = new THREE.FogExp2(0xd9a27a, 0.0012)
  return {
    sunDirection,
    update() {
      // Keep the shadow box centred on the camera.
      sun.target.position.copy(game.camera.position)
      sun.position.copy(game.camera.position).addScaledVector(sunDirection, 200)
    },
  }
}
