import * as T from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** A shallow rotor contained by the existing oval duct, with no new light or material. */
export const DUCT_FAN = { blades: 7, radius: .095, idleSpeed: 3, throttleSpeed: 15 }
let sharedGeometry: T.BufferGeometry | undefined

function geometry(): T.BufferGeometry {
  if (!sharedGeometry) {
    const parts: T.BufferGeometry[] = [new T.CylinderGeometry(.019, .019, .012, 10).rotateX(Math.PI / 2)]
    for (let i = 0; i < DUCT_FAN.blades; i++) {
      const blade = new T.BoxGeometry(.022, DUCT_FAN.radius - .018, .008)
      blade.rotateZ(-.28).translate(0, (DUCT_FAN.radius + .018) / 2, 0).rotateZ(i * Math.PI * 2 / DUCT_FAN.blades)
      parts.push(blade)
    }
    sharedGeometry = mergeGeometries(parts)
    parts.forEach(g => g.dispose())
  }
  return sharedGeometry
}

export class DuctFan {
  readonly object: T.InstancedMesh
  private phase = 0
  private readonly matrix = new T.Matrix4()

  constructor(material: T.Material, shared: boolean) {
    this.object = new T.InstancedMesh(shared ? geometry() : geometry().clone(), material, 2)
    this.object.name = 'Duct fans'
    this.object.instanceMatrix.setUsage(T.DynamicDrawUsage)
    this.writePose()
  }

  private writePose(): void {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1
      this.matrix.makeRotationZ(this.phase * side).setPosition(side * .205, 0, 0)
      this.object.setMatrixAt(i, this.matrix)
    }
    this.object.instanceMatrix.needsUpdate = true
  }

  reset(): void {
    this.phase = 0
    this.writePose()
  }

  update(dt: number, throttle: number, running: boolean): void {
    if (!running) return
    const speed = DUCT_FAN.idleSpeed + Math.max(0, Math.min(1, throttle)) * DUCT_FAN.throttleSpeed
    this.phase = (this.phase + Math.max(0, Math.min(dt, .1)) * speed) % (Math.PI * 2)
    this.writePose()
  }
}
