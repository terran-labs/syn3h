import { BlendMode, MaterialBlending, Node, Vector3, VelocityNode, type NodeFrame, type NodeBuilder } from 'three/webgpu'
import { abs, cameraViewMatrix, mix, normalView, modelWorldMatrix, positionLocal, positionPrevious, renderGroup, step, uniform, vec2, vec3, vec4 } from 'three/tsl'
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

/**
 * Where this fragment was on screen last frame, for reading a screen-space result that is
 * one frame old. `velocity` is the motion vector above (a difference in clip-space x and y,
 * y up) and `uv` the fragment's screen position (y down). Returns xy, and in z a weight:
 * 1 when that position was on screen, 0 when it was not and the old result says nothing.
 *
 * Procedural vertices carry the reject sentinel in place of a motion vector. They read the
 * old result where they are now: a frame late under motion, which is better than none.
 */
export function previousScreenUV(velocity: any, uv: any): any {
  const rejected = step(REJECT_HISTORY_VELOCITY * 0.5, abs(velocity.x))
  const then: any = mix(uv.sub(velocity.mul(vec2(0.5, -0.5))), uv, rejected)
  const inside = step(0, then.x).mul(step(then.x, 1)).mul(step(0, then.y)).mul(step(then.y, 1))
  return vec3(then, inside)
}

/**
 * The scene pass's view normal target, for occlusion and indirect light. A surface writes
 * its normal only if it also writes depth: a see-through sprite (dust, smoke, spray) leaves
 * the ground's depth in place, so its camera-facing normal over that depth would read as a
 * wall and occlude the ground behind it. Such a material outputs nothing, and with the
 * target blended as the material is (see SURFACE_NORMAL_BLEND) nothing is what lands.
 */
export class SurfaceNormal extends Node {
  constructor() { super('vec4') }
  override setup(builder: NodeBuilder): any {
    const material = builder.material as unknown as { transparent?: boolean; depthWrite?: boolean }
    return material.transparent && material.depthWrite === false ? vec4(0) : vec4(normalView, 1)
  }
}
/** Blend the normal target as each material blends: opaque overwrites, see-through adds zero. */
export const SURFACE_NORMAL_BLEND = new BlendMode(MaterialBlending)
