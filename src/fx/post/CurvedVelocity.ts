import { Vector3, VelocityNode, type NodeFrame, type NodeBuilder } from 'three/webgpu'
import { cameraViewMatrix, modelWorldMatrix, positionLocal, positionPrevious, renderGroup, uniform, vec2, vec4 } from 'three/tsl'
import { copyCurveState, curveWorldOffset } from '../../world/curve'

/** An out-of-frame reprojection rejects history for procedural vertices without history. */
export const REJECT_HISTORY_VELOCITY = 4

/** Object and instance history projected with the same planet bend as the visible mesh. */
export class CurvedVelocity extends VelocityNode {
  private frame = -1
  private readonly currentState = new Vector3()
  private readonly previousState = new Vector3()
  private readonly currentBend = uniform(new Vector3()).setGroup(renderGroup).onRenderUpdate(() => this.currentState)
  private readonly previousBend = uniform(new Vector3()).setGroup(renderGroup).onRenderUpdate(() => this.previousState)

  override update(frame: NodeFrame): undefined {
    super.update(frame)
    if (this.frame !== frame.frameId) {
      this.previousState.copy(this.currentState)
      copyCurveState(this.currentState)
      if (this.frame < 0) this.previousState.copy(this.currentState)
      this.frame = frame.frameId
    }
    return undefined
  }

  override setup(builder: NodeBuilder): any {
    const material = builder.material as unknown as { curved?: boolean; positionNode?: unknown; isSpriteNodeMaterial?: boolean }
    // positionPrevious contains original geometry, not a previous evaluation of arbitrary
    // positionNode expressions. Grass placement and particle billboards therefore have
    // no usable vertex history. Reject those pixels instead of inventing motion from the
    // original unit mesh. TRAA's depth dilation also rejects their immediate boundaries.
    if (material.positionNode || material.isSpriteNodeMaterial) return vec2(REJECT_HISTORY_VELOCITY)
    const current: any = modelWorldMatrix.mul(vec4(positionLocal, 1))
    const previous: any = this.previousModelWorldMatrix.mul(vec4(positionPrevious, 1))
    const now = material.curved ? vec4(current.xyz.add(curveWorldOffset(current, this.currentBend)), 1) : current
    const then = material.curved ? vec4(previous.xyz.add(curveWorldOffset(previous, this.previousBend)), 1) : previous
    const currentClip: any = this.currentProjectionMatrix.mul(cameraViewMatrix).mul(now)
    const previousClip: any = this.previousProjectionMatrix.mul(this.previousCameraViewMatrix).mul(then)
    return currentClip.xy.div(currentClip.w).sub(previousClip.xy.div(previousClip.w))
  }
}
