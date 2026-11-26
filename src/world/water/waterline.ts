/**
 * The waterline: crossing the surface is a moment, not a cut.
 *
 * A sheet just in front of the lens. While the lens is near the surface the sheet draws the
 * surface where it crosses the glass: everything below the line takes the liquid's colour and
 * the line itself is a bright meniscus. The line is the real intersection of the water surface
 * (the physics surface at the lens, its height and slope, liquidHeightAt) with the sheet, so it
 * sits where the drawn water meets the lens, tilts with a wave face and with the camera's roll
 * and pitch. The owner, on v26.11.1713: "where my camera is intersected by the water surface, it
 * seems like you generally draw the foam line differently than where the water plane actually
 * hits the camera."
 *
 * After the lens comes up, drops and streaks run down the view and clear: water ones clear
 * and bright, lava ones glowing orange that cool to dark as they slide.
 */
import * as T from 'three/webgpu'
import { abs, float, floor, fract, fwidth, max, mix, renderGroup, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { heightAtLens, lensNearSea, lensNearSeaNow } from './drawnSurface'

/** How far in front of the lens the sheet sits, in near-plane distances. */
const SHEET = 1.5
/** Half width of the bright meniscus, as a share of the sheet's half height. */
const MENISCUS = 0.018
/** Seconds the drops take to run off after surfacing. */
export const DRIP_SECONDS = 1.6

const hash = (v: T.Node<'float'>) => fract(sin(v.mul(127.1)).mul(43758.5453))

/**
 * Height above the water surface of points on the sheet: writes (centre, per unit right, per
 * unit up) into `out` for sheet coordinates in -1..1. `height` is the lens' height above the
 * surface under it, `forward`, `right` and `up` the lens' unit axes in world space, `d` the
 * sheet's distance, `halfW` and `halfH` its half size, and the slopes the surface's rise per
 * metre along x and z there. The surface is a plane over the sheet's few centimetres.
 */
export function waterlinePlane(
  height: number, forward: { x: number; y: number; z: number }, right: readonly number[], up: readonly number[],
  d: number, halfW: number, halfH: number, slopeX: number, slopeZ: number, out: T.Vector3,
): T.Vector3 {
  const rise = (x: number, y: number, z: number) => y - slopeX * x - slopeZ * z
  return out.set(
    height + d * rise(forward.x, forward.y, forward.z),
    halfW * rise(right[0], right[1], right[2]),
    halfH * rise(up[0], up[1], up[2]),
  )
}

export class Waterline {
  readonly mesh: T.Mesh<T.PlaneGeometry, T.MeshBasicNodeMaterial>
  /**
   * Height above the water surface of a point on the sheet, metres, as h = x + y s.x + z s.y for
   * sheet coordinates s in -1..1 (centre, right, up). Exact for a plane surface; the sheet spans
   * centimetres, over which the surface is one.
   */
  private readonly plane = uniform(new T.Vector3(10, 0, 0))
  /** 0..1: how far into a crossing the lens is (the lens rule's wash); the line shows only then. */
  private readonly crossing = uniform(0)
  /** Seconds since the lens last came up out of a liquid. */
  private readonly sinceUp = uniform(99)
  private readonly tint = uniform(new T.Color(0.1, 0.4, 0.45))
  private readonly lava = uniform(0)
  private wasUnder = false
  private surfaced = 99
  private readonly forward = new T.Vector3()

  constructor(private readonly scene: T.Scene) {
    for (const u of [this.plane, this.sinceUp, this.tint, this.lava, this.crossing]) (u as unknown as { setGroup(g: unknown): { onRenderUpdate(f: () => unknown): void } }).setGroup(renderGroup).onRenderUpdate(() => u.value)
    const material = new T.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false })
    material.fog = false
    const s = uv().mul(2).sub(1)
    // This pixel's height above the surface, and its distance from the line in sheet units.
    const h = this.plane.x.add(this.plane.y.mul(s.x)).add(this.plane.z.mul(s.y))
    const grad = vec2(this.plane.y, this.plane.z).length().max(1e-6)
    const signed = h.div(grad)
    const below = smoothstep(0.012, -0.012, signed)
    const meniscus = smoothstep(MENISCUS, 0, abs(signed))
    // Below the line: the liquid's colour, a little lighter at the line where light comes through.
    const under = mix(this.tint.mul(1.4), this.tint.mul(0.85), smoothstep(0, 0.6, signed.negate()))
    // Only while the surface crosses the sheet (the line lies within it), and during a crossing.
    const near = smoothstep(1.2, 0.9, abs(this.plane.x).div(grad)).mul(this.crossing)
    const lineColour = mix(vec3(1.8, 2, 2), vec3(4, 1.6, 0.3), this.lava)
    const planeLine = meniscus.mul(0.85).mul(near)
    const planeBody = below.mul(near).mul(0.55)
    // At the sea's surface (drawnSurface.ts) the line is where this pixel's near-plane point meets
    // the drawn sea: where the near plane cuts the mesh, so line and drawn edge are one curve at
    // every pitch, roll and wave. Below it the underwater look is the scene fog's own, per pixel,
    // so the sheet adds no tint there. Lava and inland water keep the fitted plane above.
    const heightHere = heightAtLens()
    const lineWidth = fwidth(heightHere).mul(1.2).max(0.0008)
    const seaLine = smoothstep(lineWidth, float(0), abs(heightHere)).mul(0.85).mul(lensNearSea)
    const notSea = float(1).sub(lensNearSea)
    const lineAlpha = max(planeLine.mul(notSea), seaLine)
    const bodyAlpha = planeBody.mul(notSea)
    // Drops after surfacing: a column per streak, each with its own start and speed.
    const columns = 34
    const column = floor(uv().x.mul(columns))
    const seedA = hash(column), seedB = hash(column.add(17.3))
    const offset = uv().x.mul(columns).sub(column).sub(0.5)
    const run = this.sinceUp.mul(float(0.35).add(seedB.mul(0.8))).sub(seedA.mul(0.4))
    const head = float(1).sub(run)
    const y = uv().y
    const width = float(0.12).add(seedA.mul(0.18))
    const streak = smoothstep(width, 0, abs(offset)).mul(smoothstep(head.sub(0.25).sub(seedB.mul(0.2)), head, y)).mul(smoothstep(head.add(0.02), head, y))
    const drop = smoothstep(0.3, 0.0, vec2(offset.mul(1.2), y.sub(head).mul(columns * 0.5)).length())
    const live = smoothstep(DRIP_SECONDS, DRIP_SECONDS * 0.4, this.sinceUp).mul(seedA.greaterThan(0.45).select(1, 0))
    const wet = max(streak.mul(0.35), drop.mul(0.8)).mul(live)
    // Lava streaks cool from yellow to a dark crust as they run.
    const molten = mix(vec3(5, 2, 0.4), vec3(0.15, 0.04, 0.02), smoothstep(0.2, 1.2, this.sinceUp))
    const dropColour = mix(vec3(0.85, 0.95, 1), molten, this.lava)
    const alpha = max(max(lineAlpha, bodyAlpha), wet)
    const colour = mix(mix(under, lineColour, lineAlpha.div(max(alpha, 1e-3))), dropColour, wet.div(max(alpha, 1e-3)))
    material.outputNode = vec4(colour, alpha)
    this.mesh = new T.Mesh(new T.PlaneGeometry(1, 1), material)
    this.mesh.name = 'waterline'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1000
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  /**
   * Per frame, after the lens is placed. `surface` is the liquid height at the lens or
   * -Infinity, `slopeX` and `slopeZ` its rise per metre there; `kind` which liquid; `tint` its
   * colour as seen from inside.
   */
  update(camera: T.PerspectiveCamera, surface: number, kind: 'water' | 'lava' | null, tint: T.Color, dt: number, crossing = 1, slopeX = 0, slopeZ = 0): void {
    // Settled near the surface, the scene itself shows the surface; the sheet is for the move.
    this.crossing.value = Math.min(1, crossing * 1.6)
    const height = Number.isFinite(surface) ? camera.position.y - surface : 10
    const under = height < 0
    if (this.wasUnder && !under) this.surfaced = 0
    this.wasUnder = under
    this.surfaced = Math.min(99, this.surfaced + Math.max(0, Math.min(0.1, dt)))
    // The sheet, just past the near plane, filling the view.
    const d = camera.near * SHEET
    const halfH = d * Math.tan((camera.fov * Math.PI) / 360) * 1.05, halfW = halfH * camera.aspect
    camera.getWorldDirection(this.forward)
    this.mesh.position.copy(camera.position).addScaledVector(this.forward, d)
    this.mesh.quaternion.copy(camera.quaternion)
    this.mesh.scale.set(halfW * 2, halfH * 2, 1)
    // Height above the surface plane through the lens' surface point, at the sheet's centre and
    // along its right and up edges (waterlinePlane).
    const e = camera.matrixWorld.elements
    waterlinePlane(height, this.forward, [e[0], e[1], e[2]], [e[4], e[5], e[6]], d, halfW, halfH, slopeX, slopeZ, this.plane.value)
    const p = this.plane.value, reach = Math.hypot(p.y, p.z)
    const active = (Math.abs(p.x) < reach * 1.2 && crossing > 0.01) || this.surfaced < DRIP_SECONDS || lensNearSeaNow()
    this.mesh.visible = active
    if (!active) return
    if (kind) {
      this.lava.value = kind === 'lava' ? 1 : 0
      this.tint.value.copy(tint)
    }
    this.sinceUp.value = this.surfaced
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
