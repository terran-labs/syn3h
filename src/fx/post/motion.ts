/**
 * Camera motion blur, from the depth buffer and last frame's camera.
 *
 * Each pixel's world position is rebuilt from depth, projected with the previous frame's view
 * and projection, and the difference is its motion on screen. The blur smears colour along
 * that motion (centred, as a shutter open across the frame interval). No material writes a
 * motion vector, so it works the same on WebGPU and WebGL and costs no extra render target.
 *
 * What it cannot know: things moving in the world. It assumes the world is still and only
 * the camera moved, so the player's own vehicle, which travels with the chase camera, would
 * be smeared as if it stood still. Blur therefore fades to nothing within `nearFade` metres
 * of the camera, which keeps the vehicle and the ground right under it sharp, and grows to
 * full strength past twice that. Other vehicles get the camera's blur, not their own; true
 * per-object blur needs motion vectors from every material and is planned with temporal
 * antialiasing.
 *
 * The smear is capped (`maxBlur`, in screen fractions) so a fast camera swing, a seam
 * crossing or a respawn cannot fill the frame with streaks. Seam jumps and teleports are
 * caught on the CPU and skip one frame of blur entirely.
 */
import { Fn, If, float, getScreenPosition, getViewPosition, interleavedGradientNoise, length, min, screenCoordinate, smoothstep, vec4 } from 'three/tsl'

type N = any // TSL node

export interface MotionUniforms {
  projInv: N
  camWorld: N
  prevView: N
  prevProj: N
  /** 0 off; scales the motion (1 is a shutter open for the whole frame). */
  amount: N
  /** Distance in metres under which there is no blur. */
  nearFade: N
  /** Longest smear, as a fraction of the screen. */
  maxBlur: N
}

/** Taps along the motion. Jittered per pixel, so 10 read as a smooth smear. */
export const MOTION_TAPS = 10

/** Returns the colour at `uvN`, blurred along the camera's motion. `colorTex` is the scene colour. */
export function motionBlurred(colorTex: N, depthTex: N, uvN: N, u: MotionUniforms): N {
  return Fn(() => {
    const c = colorTex.sample(uvN).rgb.toVar()
    If(u.amount.greaterThan(0.001), () => {
      const depth = depthTex.sample(uvN).r
      const view = getViewPosition(uvN, depth, u.projInv)
      const world = u.camWorld.mul(vec4(view, 1))
      const prevView = u.prevView.mul(world).xyz
      const prevUv = getScreenPosition(prevView, u.prevProj)
      const dist = length(view)
      const near = smoothstep(u.nearFade, u.nearFade.mul(2), dist)
      const motion = uvN.sub(prevUv).mul(u.amount).mul(near).toVar()
      const len = length(motion)
      motion.mulAssign(min(float(1), u.maxBlur.div(len.max(1e-5))))
      If(len.greaterThan(0.0008), () => {
        const j = interleavedGradientNoise(screenCoordinate)
        const acc = c.toVar()
        for (let i = 0; i < MOTION_TAPS; i++) {
          // Taps from -0.5 to +0.5 of the motion, offset per pixel by the noise.
          const t = j.add(i).div(MOTION_TAPS).sub(0.5)
          acc.addAssign(colorTex.sample(uvN.sub(motion.mul(t))).rgb)
        }
        c.assign(acc.div(MOTION_TAPS + 1))
      })
    })
    return c
  })()
}
