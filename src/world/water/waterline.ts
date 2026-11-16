/**
 * The waterline: crossing the surface is a moment, not a cut.
 *
 * A sheet just in front of the lens. While the lens is near the surface the sheet draws the
 * surface as it would cross the lens: everything below a wavy line takes the liquid's colour,
 * the line itself is a bright meniscus, and as the lens moves the line sweeps across the view.
 * The lens is about ten centimetres tall, so the line would flick past in a frame; it is drawn
 * as if the lens were SPAN metres tall, so the sweep takes most of the one-second crossing.
 *
 * After the lens comes up, drops and streaks run down the view and clear: water ones clear
 * and bright, lava ones glowing orange that cool to dark as they slide.
 */
import * as T from 'three/webgpu'
import { abs, float, floor, fract, max, mix, renderGroup, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'

/** How tall the lens is treated as, metres: sets how long the waterline takes to sweep across. */
const SPAN = 0.9
/** Seconds the drops take to run off after surfacing. */
export const DRIP_SECONDS = 1.6

const hash = (v: T.Node<'float'>) => fract(sin(v.mul(127.1)).mul(43758.5453))

export class Waterline {
  readonly mesh: T.Mesh<T.PlaneGeometry, T.MeshBasicNodeMaterial>
  /** Lens height above the surface, metres (negative below). */
  private readonly height = uniform(10)
  /** World-up seen in screen space: how the line tilts with camera roll and pitch. (x, y) of up in view. */
  private readonly up = uniform(new T.Vector2(0, 1))
  /** Seconds since the lens last came up out of a liquid. */
  private readonly sinceUp = uniform(99)
  private readonly tint = uniform(new T.Color(0.1, 0.4, 0.45))
  private readonly lava = uniform(0)
  private wasUnder = false
  private surfaced = 99
  private readonly forward = new T.Vector3()

  constructor(private readonly scene: T.Scene) {
    for (const u of [this.height, this.up, this.sinceUp, this.tint, this.lava]) (u as unknown as { setGroup(g: unknown): { onRenderUpdate(f: () => unknown): void } }).setGroup(renderGroup).onRenderUpdate(() => u.value)
    const material = new T.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false })
    material.fog = false
    const s = uv().mul(2).sub(1)
    // Height of this pixel on the virtual lens: along world-up as it appears on screen.
    const along = s.x.mul(this.up.x).add(s.y.mul(this.up.y))
    const across = s.x.mul(this.up.y).sub(s.y.mul(this.up.x))
    const ripple = sin(across.mul(9).add(time.mul(3.1))).mul(0.025).add(sin(across.mul(23).sub(time.mul(4.7))).mul(0.01))
    const level = this.height.negate().div(SPAN * 0.5).add(ripple)
    const below = smoothstep(0.012, -0.012, along.sub(level))
    const meniscus = smoothstep(0.018, 0, abs(along.sub(level)))
    // Below the line: the liquid's colour, a little lighter at the line where light comes through.
    const under = mix(this.tint.mul(1.4), this.tint.mul(0.85), smoothstep(0, 0.6, level.sub(along)))
    const near = smoothstep(SPAN * 0.75, SPAN * 0.25, abs(this.height))
    const lineColour = mix(vec3(1.8, 2, 2), vec3(4, 1.6, 0.3), this.lava)
    const lineAlpha = meniscus.mul(0.85).mul(near)
    const bodyAlpha = below.mul(near).mul(0.55)
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
   * -Infinity; `kind` which liquid; `tint` its colour as seen from inside.
   */
  update(camera: T.PerspectiveCamera, surface: number, kind: 'water' | 'lava' | null, tint: T.Color, dt: number): void {
    const height = Number.isFinite(surface) ? camera.position.y - surface : 10
    const under = height < 0
    if (this.wasUnder && !under) this.surfaced = 0
    this.wasUnder = under
    this.surfaced = Math.min(99, this.surfaced + Math.max(0, Math.min(0.1, dt)))
    const active = Math.abs(height) < SPAN || this.surfaced < DRIP_SECONDS
    this.mesh.visible = active
    if (!active) return
    if (kind) {
      this.lava.value = kind === 'lava' ? 1 : 0
      this.tint.value.copy(tint)
    }
    this.height.value = height
    this.sinceUp.value = this.surfaced
    // World up in the camera's view: its screen x and y components.
    const e = camera.matrixWorld.elements
    const ux = e[1], uy = e[5]
    const len = Math.hypot(ux, uy) || 1
    this.up.value.set(ux / len, uy / len)
    // Fill the view just past the near plane.
    const d = camera.near * 1.5
    const h = 2 * d * Math.tan((camera.fov * Math.PI) / 360)
    camera.getWorldDirection(this.forward)
    this.mesh.position.copy(camera.position).addScaledVector(this.forward, d)
    this.mesh.quaternion.copy(camera.quaternion)
    this.mesh.scale.set(h * camera.aspect * 1.05, h * 1.05, 1)
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
