import * as THREE from 'three/webgpu'
import { params, worldGravity, type ParamValue } from '../../shared/params'
import type { Game, System } from '../core/Game'
import { createWorld, initPhysics } from '../core/physics'
import { LEVELS, autoQuality, buildLadder, legacyTier, levelNumber, presetFor, qualityLevel, type QualityLevel } from '../core/quality'
import { drawFrame, gpuDeadlineMs, startRenderer } from '../core/renderOptions'
import { createPostChain, type PostChain } from '../fx/post/PostChain'
import { drawsEffects, postTier } from '../fx/post/gate'
import { ProceduralTerrain } from '../world/terrain/ProceduralTerrain'
import { createEnvironment, type Environment } from '../world/Environment'
import type { Terrain } from '../world/Terrain'
import { applyPlanet } from '../world/planets'
import { seaLevel, snapSeaLevel } from '../world/seaLevel'
import { AlienSkyMesh } from '../world/sky/AlienSkyMesh'
import { sunDirection } from '../world/sky/skyMath'
import { CLOCK_SWITCH_SECONDS, setWaterClock } from '../world/water/seaWaves'
import { setWeatherClock } from '../world/weather/wind'

export interface RenderCheckToggle {
  readonly name: string
  setEnabled(enabled: boolean): void
}

export interface RenderCheckState {
  readonly tier: QualityLevel
  readonly tierName: string
  readonly backend: 'webgpu' | 'webgl'
  readonly fallbackReason?: string
  readonly postTier: PostChain['tier']
  readonly devicePixelRatio: number
  readonly pixelRatioCap: number
  readonly pixelRatio: number
  readonly width: number
  readonly height: number
  readonly cssWidth: number
  readonly cssHeight: number
  readonly sky: boolean
  readonly water: boolean
}

export interface RenderCheckScene {
  readonly renderer: THREE.WebGPURenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  setTier(level: number): void
  /** Call once per animation frame so the production post passes update. */
  draw(): void
  getState(): RenderCheckState
  /** Hide draws while keeping their environment lighting and reflections. */
  setVisibility(visibility: { sky?: boolean; water?: boolean }): void
  /** Current-tier toggles. Measure after warming both the disabled and restored states. */
  getToggles(): readonly RenderCheckToggle[]
  dispose(): void
}

const SEED = 1
const HOUR = 17.5
const FIXED_TIME = 0
const POST_GROUPS = [
  { name: 'post.rays', ids: ['post.shafts', 'post.flare'] },
  { name: 'post.bloom', ids: ['post.bloom'] },
  { name: 'post.composite', ids: ['post.heat', 'post.motionBlur'] },
  { name: 'post.ao', ids: ['post.ao'] },
  { name: 'post.contact', ids: ['post.contact'] },
  { name: 'post.clouds', ids: ['post.clouds'] },
  { name: 'post.gi', ids: ['post.gi'] },
  { name: 'post.temporal', ids: ['post.temporal'] },
] as const

// The production world systems share a parameter registry and liquid/atmosphere uniforms.
let active = false

/** Find a reproducible point on the home island with both shallow water and dry ground. */
function aimAtShore(terrain: Terrain, camera: THREE.PerspectiveCamera): void {
  const sea = seaLevel()
  const limit = terrain.size * 0.45
  for (let i = 0; i < 12; i++) {
    const angle = Math.PI / 3 + i * Math.PI / 6
    const dx = Math.cos(angle), dz = Math.sin(angle)
    for (let r = 36; r + 45 < limit; r += 4) {
      const at = (distance: number) => terrain.heightAt(dx * distance, dz * distance)
      if (at(r) > sea || at(r - 20) < sea + 1 || at(r + 45) > sea - 2) continue
      const x = dx * (r - 22), z = dz * (r - 22)
      camera.position.set(x, Math.max(sea, terrain.heightAt(x, z)) + 22, z)
      const view = new THREE.Vector3(0.48 * dx + 0.88 * dz, 0, 0.48 * dz - 0.88 * dx).normalize()
      camera.lookAt(x + 165 * view.x, sea + 14, z + 165 * view.z)
      camera.updateMatrixWorld(true)

      // Aim the preset sun a little off centre so the production shafts can run.
      const [sx, , sz] = sunDirection(HOUR, Number(params.get('sun.tilt')?.value))
      const azimuth = (Math.atan2(sz, sx) - Math.atan2(view.z, view.x)) * 180 / Math.PI
      params.set('sun.azimuth', (azimuth + 368) % 360, 'preset')
      return
    }
  }
  throw new Error('The render check island has no usable shoreline')
}

export async function createRenderCheckScene(canvas: HTMLCanvasElement): Promise<RenderCheckScene> {
  if (active) throw new Error('Only one render check scene can run on this page')
  active = true

  const original = params.snapshot('all')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000)
  const systems = new Set<System>()
  let renderer: THREE.WebGPURenderer | undefined
  let world: ReturnType<typeof createWorld> | undefined
  let terrain: ProceduralTerrain | undefined
  let environment: Environment | undefined
  let post: PostChain | undefined
  let disposed = false
  let fixtureSettings = false
  let tier: QualityLevel = 3
  let revision = 0

  function dispose(): void {
    if (disposed) return
    disposed = true
    try {
      post?.dispose()
      environment?.dispose?.()
      terrain?.dispose()
      world?.free()
      renderer?.dispose()
    } finally {
      if (fixtureSettings) {
        params.applySnapshot(original, 'preset')
        snapSeaLevel()
        setWeatherClock(() => Date.now() / 1000)
        setWaterClock(() => 0)
      }
      active = false
    }
  }

  try {
    const search = location.search
    const forceWebGL = new URLSearchParams(search).has('webgl')
    const startup = await startRenderer((forceWebGL, freshCanvas) => {
      if (freshCanvas) {
        const replacement = canvas.cloneNode() as HTMLCanvasElement
        canvas.replaceWith(replacement)
        canvas = replacement
      }
      return new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL })
    }, { forceWebGL, deadlineMs: gpuDeadlineMs(search) })
    const drawingRenderer = renderer = startup.renderer
    const backend = (drawingRenderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl'
    drawingRenderer.toneMapping = THREE.ACESFilmicToneMapping
    drawingRenderer.shadowMap.enabled = true
    // The runner owns the cadence and chooses which frames to query.
    const timestampBackend = drawingRenderer.backend as unknown as { trackTimestamp: boolean }
    timestampBackend.trackTimestamp = drawingRenderer.hasFeature('timestamp-query')
    await initPhysics()

    fixtureSettings = true
    applyPlanet('archipelago', SEED, { source: 'preset' })
    params.set('sun.dayLength', 0, 'preset')
    params.set('sun.timeOfDay', HOUR, 'preset')
    params.set(autoQuality.def.id, false, 'preset')
    snapSeaLevel()
    setWeatherClock(() => FIXED_TIME)
    world = createWorld(worldGravity.value)

    // Terrain and environment take Game at the seam. They only use these world members
    // and system hooks. A full Game would also install input and its persistent governor.
    const host: Pick<Game, 'scene' | 'camera' | 'renderer' | 'world' | 'time' | 'add' | 'remove'> = {
      scene, camera, renderer: drawingRenderer, world, time: FIXED_TIME,
      add<T extends System>(system: T): T { systems.add(system); return system },
      remove(system, dispose = true) { if (systems.delete(system) && dispose) system.dispose?.() },
    }
    const terrainHost = host as Game
    const shore = terrain = new ProceduralTerrain(terrainHost, SEED)
    aimAtShore(shore, camera)
    const skyEnvironment = environment = createEnvironment(terrainHost, shore)
    const chain = post = createPostChain({ quality: {
      get postTier() { return LEVELS[tier].postTier },
      postBudget: 1,
    } }, skyEnvironment)
    const sky = scene.children.find(object => object instanceof AlienSkyMesh)
    const water = scene.getObjectByName('volcanics')
    if (!sky || !water) throw new Error('Production sky or liquids are missing from the render check scene')

    const buffer = new THREE.Vector2()
    let cssWidth = 0
    let cssHeight = 0
    let devicePixelRatio = 1
    function resize(): void {
      // The direct page uses a full-viewport canvas, as the game does. Intrinsic
      // canvas dimensions already include DPR and must not feed back into this size.
      const width = Math.max(1, window.innerWidth)
      const height = Math.max(1, window.innerHeight)
      const dpr = window.devicePixelRatio || 1
      const pixelRatio = buildLadder(tier, dpr)[0].pixelRatio
      if (drawingRenderer.getPixelRatio() !== pixelRatio) drawingRenderer.setPixelRatio(pixelRatio)
      if (width !== cssWidth || height !== cssHeight) {
        cssWidth = width
        cssHeight = height
        drawingRenderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      devicePixelRatio = dpr
    }

    const setVisibility: RenderCheckScene['setVisibility'] = visibility => {
      if (disposed) return
      if (visibility.sky !== undefined) sky.visible = visibility.sky
      if (visibility.water !== undefined) water.visible = visibility.water
    }

    function setTier(level: number): void {
      if (disposed) return
      tier = levelNumber(level)
      revision++
      setVisibility({ sky: true, water: true })
      params.set(qualityLevel.def.id, tier, 'preset')
      params.applySnapshot(presetFor(tier), 'preset')
      const { drawDistance, detail, groundCover } = LEVELS[tier]
      const terrainQuality = { level: legacyTier(tier), quality: tier, drawDistance, detail, groundCover }
      shore.setRenderQuality(terrainQuality)
      resize()
      skyEnvironment.update?.(0, 0)
      for (const system of systems) system.update?.(0, 0)
      // Liquid LOD can replace geometry during its update. Apply the same horizon curve
      // to that geometry before its first timed draw.
      shore.afterCamera()
    }

    function getToggles(): readonly RenderCheckToggle[] {
      if (disposed) return []
      const current = revision
      const toggles: RenderCheckToggle[] = [
        { name: 'sky', setEnabled(enabled) { if (current === revision) setVisibility({ sky: enabled }) } },
        { name: 'water', setEnabled(enabled) { if (current === revision) setVisibility({ water: enabled }) } },
      ]
      if (!drawsEffects(LEVELS[tier].postTier)) return toggles
      const preset = presetFor(tier)
      for (const { name, ids } of POST_GROUPS) {
        const enabled = ids.map(id => [id, preset[id]] as const).filter((entry): entry is readonly [typeof ids[number], ParamValue] => Boolean(entry[1]))
        if (!enabled.length) continue
        if (name === 'post.clouds' && !(skyEnvironment.clouds.coverage > 0 && skyEnvironment.clouds.density > 0 && skyEnvironment.clouds.atmosphere > 0)) continue
        toggles.push({ name, setEnabled(on) {
          if (disposed || current !== revision) return
          for (const [id, value] of enabled) params.set(id, on ? value : typeof value === 'boolean' ? false : 0, 'preset')
        } })
      }
      return toggles
    }

    // Wait out the production clock blend before freezing the scene for measurement.
    await new Promise<void>(resolve => setTimeout(resolve, CLOCK_SWITCH_SECONDS * 1000))
    setTier(tier)
    return {
      renderer: drawingRenderer, scene, camera, setTier, setVisibility, getToggles, dispose,
      draw() {
        if (disposed) return
        const aspect = camera.aspect
        resize()
        if (camera.aspect !== aspect) skyEnvironment.update?.(0, 0)
        drawFrame(drawingRenderer, scene, camera, chain, 1000 / 60)
      },
      getState() {
        drawingRenderer.getDrawingBufferSize(buffer)
        return {
          tier, tierName: LEVELS[tier].name, backend, fallbackReason: startup.fallbackReason,
          postTier: postTier({ on: params.get('post.on')?.value === true, tier: LEVELS[tier].postTier, shed: 0 }),
          devicePixelRatio, pixelRatioCap: LEVELS[tier].pixelRatio,
          pixelRatio: drawingRenderer.getPixelRatio(), width: buffer.x, height: buffer.y,
          cssWidth, cssHeight, sky: sky.visible, water: water.visible,
        }
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
