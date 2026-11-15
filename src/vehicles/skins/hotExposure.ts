import { renderGroup, uniform } from 'three/tsl'
import { skyExposure } from '../../world/sky/skyParams'

/** Match the lava sea: retain a little night boost without bleaching hot colours. */
export function hotExposureDim(exposure: number, daytime = skyExposure.value): number {
  const over = exposure / Math.max(1e-3, daytime)
  return over > 1 ? 1 / (over * 0.8 + 0.2) : 1
}

/** Per-render update also works in paused inspection views and standalone model viewers. */
export function hotExposureNode() {
  return uniform(1).setGroup(renderGroup).onRenderUpdate(frame =>
    frame.scene?.children.some(object => 'sunDirection' in object)
      ? hotExposureDim(frame.renderer?.toneMappingExposure ?? skyExposure.value) : 1)
}
