import * as T from 'three/webgpu'
import type { Terrain } from '../Terrain'

/** Fraction of a triangle below a linearly interpolated waterline. Depth is positive in water. */
export function wetTriangle(a:number,b:number,c:number):number {
  if(a<=0&&b<=0&&c<=0)return 0
  if(a>0&&b>0&&c>0)return 1
  if(a>0&&b<=0&&c<=0)return a/(a-b)*a/(a-c)
  if(b>0&&a<=0&&c<=0)return b/(b-a)*b/(b-c)
  if(c>0&&a<=0&&b<=0)return c/(c-a)*c/(c-b)
  if(a<=0)return 1-a/(a-b)*a/(a-c)
  if(b<=0)return 1-b/(b-a)*b/(b-c)
  return 1-c/(c-a)*c/(c-b)
}

/** Main-camera near-plane samples. No vehicle, contact state or effect toggle is consulted. */
export class CameraWater {
  /** Signed local wave depths at top-left, top-right, bottom-left, bottom-right. */
  readonly depths=new T.Vector4(-1,-1,-1,-1)
  coverage=0
  private point=new T.Vector3()
  update(camera:T.PerspectiveCamera,terrain:Terrain):void {
    camera.updateWorldMatrix(true,false)
    const nearZ=camera.coordinateSystem===T.WebGPUCoordinateSystem?0:-1
    for(let i=0;i<4;i++){
      const p=this.point.set(i%2?1:-1,i<2?1:-1,nearZ)
        .applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld)
      const surface=terrain.liquidKindAt?.(p.x,p.z)==='water'?terrain.liquidHeightAt?.(p.x,p.z)??-Infinity:-Infinity
      // Finite dry sentinel keeps interpolation valid at the edge of a liquid region.
      this.depths.setComponent(i,Number.isFinite(surface)?surface-p.y:-1)
    }
    const d=this.depths
    this.coverage=(wetTriangle(d.x,d.y,d.w)+wetTriangle(d.x,d.w,d.z))*.5
  }
}
