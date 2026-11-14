import { Float32BufferAttribute, Mesh, PlaneGeometry, Scene } from 'three/webgpu'
import { worldLavaAltitude } from '../../shared/params'
import type { System } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { createLavaMaterial } from './material'

export class LavaSurface implements System {
  readonly mesh: Mesh
  private readonly shader = createLavaMaterial(false, true)
  constructor(private readonly scene: Scene, terrain: Pick<Terrain, 'size' | 'heightAt'>) {
    const geometry = new PlaneGeometry(terrain.size, terrain.size, 128, 128)
    geometry.rotateX(-Math.PI / 2)
    const positions = geometry.attributes.position, uv = geometry.attributes.uv
    const ground = new Float32Array(positions.count)
    for (let i = 0; i < positions.count; i++) {
      ground[i] = terrain.heightAt(positions.getX(i), positions.getZ(i))
      uv.setXY(i, positions.getX(i), positions.getZ(i))
    }
    geometry.setAttribute('groundHeight', new Float32BufferAttribute(ground, 1))
    this.mesh = new Mesh(geometry, this.shader.material)
    scene.add(this.mesh)
    this.update(0)
  }
  update(dt: number) {
    this.mesh.position.y = worldLavaAltitude.value
    this.shader.update(dt, worldLavaAltitude.value)
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.shader.material.dispose() }
}
