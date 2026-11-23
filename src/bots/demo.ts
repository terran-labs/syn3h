import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Game } from '../core/Game'
import { RAPIER } from '../core/physics'
import { createVehicle } from '../vehicles'
import type { Terrain } from '../world/Terrain'
import { params } from '../../shared/params'
import { BotManager } from './BotManager'
import { botCount } from './params'
const game = new Game(document.getElementById('game') as HTMLCanvasElement)
await game.init()
const terrain: Terrain = {
  size: 200, heightAt: () => 0, normalAt: (_x, _z, out) => out.set(0, 1, 0),
  spawnPoint: index => ({ position: new THREE.Vector3(index * 4, 2, 0), heading: 0 }), dispose() {},
}
game.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0))
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardNodeMaterial({ color: 0x5c3b32, roughness: 1 }))
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; game.scene.add(ground)
game.scene.add(new THREE.GridHelper(200, 40, 0x966d57, 0x705044))
game.scene.background = new THREE.Color(0x201c25)
const sun = new THREE.DirectionalLight(0xffdbc0, 3); sun.position.set(30, 70, 40); game.scene.add(sun)
game.scene.add(new THREE.HemisphereLight(0xc5dbff, 0x221811, 1.5))
const player = game.add(createVehicle(game, terrain, 'buggy', new THREE.Vector3(0, 2, 0)))
player.id = 'player'; player.name = 'Player'
const manager = game.add(new BotManager(game, terrain, player))
manager.setTargets([player])
game.camera.position.set(42, 60, 55)
const controls = new OrbitControls(game.camera, game.canvas); controls.target.set(0, 0, 0); controls.update()
const metrics = { contact: false, minimumDistance: Infinity, initialDistance: 0 }
const coloured = new WeakSet<object>()
game.add({
  postPhysics() {
    for (const bot of manager.vehicles) {
      const p = bot.body.translation(), target = player.body.translation(), distance = Math.hypot(p.x - target.x, p.z - target.z)
      if (!metrics.initialDistance) metrics.initialDistance = distance
      metrics.minimumDistance = Math.min(metrics.minimumDistance, distance)
      game.world.contactPair(bot.body.collider(0), player.body.collider(0), manifold => { if (manifold.numContacts()) metrics.contact = true })
    }
  },
  update() {
    for (const bot of manager.vehicles) if (!coloured.has(bot)) {
      coloured.add(bot)
      bot.object.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) object.material.color.setHex(0xff6a24) })
    }
    document.getElementById('stats')!.textContent = `${manager.vehicles.length} bots / closest ${Number.isFinite(metrics.minimumDistance) ? metrics.minimumDistance.toFixed(1) : '-'} m / contact ${metrics.contact ? 'yes' : 'no'}`
  },
})
document.getElementById('add')!.onclick = () => params.set('bots.count', botCount.value + 1)
document.getElementById('clear')!.onclick = () => params.set('bots.count', 0)
Object.assign(window, { mira: { game, terrain, player, params, bots: manager, metrics } })
game.start()
