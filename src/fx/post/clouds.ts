/** Procedural cloud density integrated through a layer in the rendered world's space.
 * A curved world uses a spherical shell around the camera's tangent anchor; flat worlds
 * use a horizontal slab. Scene depth clips the march, including when flying inside it.
 * This adds cloud self-shadowing, not cloud shadows on terrain. No textures are downloaded.
 */
import { Vector2, Vector3 } from 'three/webgpu'
import {
  Fn, If, Loop, Break, abs, acos, clamp, dot, exp, float, floor, fract, getViewPosition,
  interleavedGradientNoise, max, min, mix, renderGroup, rtt,
  screenCoordinate, smoothstep, sqrt, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { curveFactor } from '../../world/curve'
import type { CloudInputs } from '../../world/Environment'
import type { SunSource } from './PostChain'
import { postCloudBase, postCloudDepth, postClouds } from './params'

type N = any
export const CLOUD_STEPS = 24

/** Reconstruct the half-resolution layer without spreading sky clouds onto foregrounds. */
export function compositeClouds(surface: N, volume: N, depth: N, projInv: N, visibility: N = float(1)): N {
  return rtt(Fn(() => {
    const p = uv(), size = vec2(volume.size())
    const pixel = p.mul(size).sub(0.5), cell = floor(pixel), fraction = fract(pixel)
    const distance = getViewPosition(p, depth.sample(p).r, projInv).length().max(1)
    const sum = vec4(0).toVar(), weights = float(0).toVar()
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const tap = cell.add(vec2(x, y)).add(0.5).div(size)
      const tapDistance = getViewPosition(tap, depth.sample(tap).r, projInv).length()
      const compatible = float(1).sub(smoothstep(0.05, 0.2, abs(tapDistance.sub(distance)).div(distance)))
      const weight = (x ? fraction.x : float(1).sub(fraction.x))
        .mul(y ? fraction.y : float(1).sub(fraction.y)).mul(compatible)
      sum.addAssign(volume.sample(tap).mul(weight)); weights.addAssign(weight)
    }
    // The volume is premultiplied: fade its colour and opacity together so submersion
    // cannot leave a bright cloud painted over the water fog.
    const cloud = sum.div(weights.max(1e-5)).mul(visibility)
    return vec4(surface.sample(p).rgb.mul(float(1).sub(cloud.a)).add(cloud.rgb), 1)
  })())
}

export function cloudVolume(depth: N, camera: { projInv: N; camWorld: N; camPos: N }, source: SunSource & { clouds: CloudInputs }): N {
  const live = (read: () => number) => uniform(0).setGroup(renderGroup).onRenderUpdate(read)
  const cover = live(() => source.clouds.coverage)
  const density = live(() => source.clouds.density * source.clouds.atmosphere * postClouds.value)
  // Existing elevation is dimensionless: 0..1 maps to half..one-and-a-half base height.
  const base = live(() => postCloudBase.value * (0.5 + source.clouds.elevation))
  const thickness = live(() => postCloudDepth.value)
  // Fit whole lattice cells to the wrapping tile. At scale .0002 a cell is about 120 m;
  // each octave repeats at the tile boundary, including while wind moves the field.
  const tileSize = live(() => Math.max(1, source.clouds.worldSize))
  const cells = live(() => Math.max(1, Math.round(source.clouds.worldSize * source.clouds.scale / 0.024)))
  const frequency: N = cells.div(tileSize)
  const speed = live(() => source.clouds.speed)
  const invR = live(curveFactor)
  const offset = uniform(new Vector2()).setGroup(renderGroup).onRenderUpdate((_frame, self) => {
    self.value.set(source.clouds.offset.x, source.clouds.offset.y)
  })
  const towardLight = uniform(new Vector3()).setGroup(renderGroup).onRenderUpdate((_frame, self) => {
    self.value.copy(source.lightDirection ?? source.sunDirection)
  })
  const sunlight = uniform(new Vector3()).setGroup(renderGroup).onRenderUpdate((_frame, self) => {
    const c = source.sunColor; self.value.set(c?.r ?? 0, c?.g ?? 0, c?.b ?? 0)
  })
  const ambient = uniform(new Vector3()).setGroup(renderGroup).onRenderUpdate((_frame, self) => {
    const c = source.horizonColor; self.value.set(c?.r ?? 0, c?.g ?? 0, c?.b ?? 0)
  })
  const radius: N = float(1).div(invR.max(1e-6))
  const centre: N = vec3(camera.camPos.x, radius.negate(), camera.camPos.z)

  const hash = Fn(([cell, period]: N[]) => {
    const wrapped = vec3(cell.x.mod(period).add(period).mod(period), cell.y, cell.z.mod(period).add(period).mod(period))
    const p = fract(wrapped.mul(vec3(0.1031, 0.11369, 0.13787))).toVar()
    p.addAssign(dot(p, p.yzx.add(19.19)))
    return fract(p.x.add(p.y).mul(p.z))
  })
  const noise = Fn(([point, period]: N[]) => {
    const cell = floor(vec3(point)), f = fract(vec3(point))
    const t = f.mul(f).mul(float(3).sub(f.mul(2)))
    const at = (x: number, y: number, z: number) => hash(cell.add(vec3(x, y, z)), period)
    const low = mix(mix(at(0, 0, 0), at(1, 0, 0), t.x), mix(at(0, 1, 0), at(1, 1, 0), t.x), t.y)
    const high = mix(mix(at(0, 0, 1), at(1, 0, 1), t.x), mix(at(0, 1, 1), at(1, 1, 1), t.x), t.y)
    return mix(low, high, t.z)
  })

  const sampleDensity = Fn(([point]: N[]) => {
    const horizontal = point.xz.toVar()
    const altitude = point.y.toVar()
    If(invR.greaterThan(0), () => {
      const radial = point.sub(centre)
      const distance = radial.length().max(1e-4)
      altitude.assign(distance.sub(radius))
      const angle = acos(clamp(radial.y.div(distance), -1, 1))
      horizontal.assign(camera.camPos.xz.add(radial.xz.div(radial.xz.length().max(1e-4)).mul(angle).mul(radius)))
    })
    const h = altitude.sub(base).div(thickness)
    const layer = smoothstep(0, 0.15, h).mul(float(1).sub(smoothstep(0.65, 1, h)))
    const result = float(0).toVar()
    If(layer.greaterThan(0), () => {
      const drift = offset.mul(1000)
      const p = vec3(horizontal.x.mul(frequency).add(drift.x), h.mul(1.2), horizontal.y.mul(frequency).add(drift.y))
      const evolve = time.mul(speed).mul(300)
      const field = noise(p, cells).mul(0.5)
        .add(noise(p.mul(2).add(vec3(11.1, evolve, 4.7)), cells.mul(2)).mul(0.3))
        .add(noise(p.mul(4).add(vec3(evolve, 7.3, 19.1)), cells.mul(4)).mul(0.2))
      // Sparse coverage must survive integration along a long, grazing ray: a low
      // threshold can fill most of the sky even when each individual sample is sparse.
      const threshold = float(0.85).sub(cover.mul(0.65))
      result.assign(smoothstep(threshold, threshold.add(0.08), field).mul(layer).mul(density))
    })
    return result
  })

  const sphereHits = Fn(([origin, direction, r]: N[]) => {
    const relative = origin.sub(centre)
    const b = dot(relative, direction)
    const disc = b.mul(b).sub(dot(relative, relative).sub(r.mul(r)))
    const hits = vec2(1, -1).toVar()
    If(disc.greaterThanEqual(0), () => {
      const root = sqrt(max(disc, 0))
      hits.assign(vec2(b.negate().sub(root), b.negate().add(root)))
    })
    return hits
  })

  const volume = Fn(() => {
    const p = uv()
    const view = getViewPosition(p, depth.sample(p).r, camera.projInv)
    const direction = camera.camWorld.mul(vec4(view.normalize(), 0)).xyz.normalize()
    const origin = camera.camPos
    const stop = min(view.length(), 10000)
    const start = float(0).toVar(), end = float(0).toVar()
    If(invR.greaterThan(0), () => {
      const outer = sphereHits(origin, direction, radius.add(base).add(thickness))
      start.assign(max(0, outer.x)); end.assign(min(stop, outer.y))
      // Starting below the layer: skip the empty distance to its inner boundary.
      If(origin.sub(centre).length().lessThan(radius.add(base)), () => {
        start.assign(max(start, sphereHits(origin, direction, radius.add(base)).y))
      })
      // Clouds on the far side must not shine through the opaque planet body.
      const planet = sphereHits(origin, direction, radius)
      If(planet.y.greaterThanEqual(planet.x).and(planet.x.greaterThan(0)), () => { end.assign(min(end, planet.x)) })
    }).Else(() => {
      If(abs(direction.y).greaterThan(1e-5), () => {
        const a = base.sub(origin.y).div(direction.y)
        const b = base.add(thickness).sub(origin.y).div(direction.y)
        start.assign(max(0, min(a, b))); end.assign(min(stop, max(a, b)))
      }).Else(() => {
        If(origin.y.greaterThanEqual(base).and(origin.y.lessThanEqual(base.add(thickness))), () => { end.assign(stop) })
      })
    })
    const transmission = float(1).toVar(), radiance = vec3(0).toVar()
    If(end.greaterThan(start), () => {
      const step = end.sub(start).div(CLOUD_STEPS)
      // Static spatial jitter avoids moving grain while temporal history is unavailable.
      const jitter = interleavedGradientNoise(screenCoordinate)
      const phase = float(0.6975).div(float(1.3025).sub(dot(direction, towardLight).mul(1.1)).max(0.05).pow(1.5)).min(8)
      Loop(CLOUD_STEPS, ({ i }: N) => {
        If(transmission.lessThan(0.01), () => { Break() })
        const distance = start.add(float(i).add(jitter).mul(step))
        const point = origin.add(direction.mul(distance))
        const rho = sampleDensity(point)
        If(rho.greaterThan(0.001), () => {
          const lightStep = thickness.mul(0.25)
          const opticalDepth = float(0).toVar()
          for (let j = 0; j < 3; j++) opticalDepth.addAssign(sampleDensity(point.add(towardLight.mul(lightStep.mul(j + 0.5)))).mul(lightStep))
          const lit = exp(opticalDepth.mul(-0.025))
          const illumination = ambient.mul(0.08).add(sunlight.mul(lit).mul(phase.mul(0.04).add(0.03)))
          const alpha = float(1).sub(exp(rho.mul(step).mul(-0.025)))
          const haze = float(1).sub(exp(distance.mul(-0.00005)))
          radiance.addAssign(mix(illumination, ambient, haze).mul(alpha).mul(transmission))
          transmission.mulAssign(float(1).sub(alpha))
        })
      })
    })
    return vec4(radiance, float(1).sub(transmission))
  })
  const target = rtt(volume()).setResolutionScale(0.5)
  target.renderTarget!.texture.name = 'Cloud radiance and opacity'
  return target
}
