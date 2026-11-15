/**
 * Pure parts of the release showcase: the fixed scene list, the URLs that open each scene,
 * the frame quality check, the ffmpeg inputs and the manifest. No browser, no file system,
 * so tools/showcase.test.mjs can test all of it with node:test.
 *
 * The browser staging for each scene lives in tools/showcase.mjs.
 */

/**
 * The scenes, in GIF order. Every scene opens in a fresh room with a fixed seed so runs
 * repeat. `vehicle` and `planet` become ?vehicle= and ?planet=; `params` are applied through
 * the parameter registry after load. `requires` lists what the build must have for the scene
 * to be honest; a build without it skips the scene with a note in the manifest.
 *
 * requires entries: `param:<id>` (a registry parameter), `vehicle:<kind>`, `planet:<id>`,
 * `net` (the room connection), `camera:cinematic` (an external camera pose).
 */
export const SCENES = Object.freeze([
  {
    id: 'lobby', title: 'Lobby: the Syn3h logo and the planets',
    // Deep space behind a lit logo: darker on average than any world scene.
    lobby: true, seed: 7, requires: [], limits: { minMeanLuma: 6 },
  },
  {
    id: 'buggy-volcano', title: 'The Syn3h buggy on the road, volcano ahead, golden hour',
    vehicle: 'buggy-syn3h', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 17.6, 'sun.azimuth': 90 }, requires: ['vehicle:buggy-syn3h', 'param:sun.timeOfDay'],
  },
  {
    id: 'wings-glide', title: 'Wings open in the air off a dune',
    vehicle: 'buggy-syn3h', planet: 'desert', seed: 11,
    params: { 'sun.timeOfDay': 15.5 }, requires: ['vehicle:buggy-syn3h', 'planet:desert', 'camera:cinematic'],
  },
  {
    id: 'bots-pursuit', title: 'Four or more bots chasing the player',
    vehicle: 'buggy-syn3h', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 16, 'bots.count': 5, 'bots.canFire': false }, requires: ['param:bots.count', 'camera:cinematic'],
  },
  {
    id: 'tag-beam', title: 'A tag beam connecting two vehicles',
    vehicle: 'buggy-syn3h', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 17.6, 'laser.speed': 40 }, requires: ['net', 'param:laser.speed', 'camera:cinematic'],
  },
  {
    id: 'jet-flight', title: 'The jet above the island',
    vehicle: 'jet', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 15.5, 'sun.azimuth': 155 }, requires: ['vehicle:jet'],
  },
  {
    id: 'hovercraft-lava', title: 'The hovercraft over lava',
    vehicle: 'hovercraft', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 17.2 }, requires: ['vehicle:hovercraft', 'camera:cinematic'],
  },
  {
    id: 'lava-night', title: 'Lava and headlights at night',
    vehicle: 'buggy-syn3h', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 22.5 }, requires: ['param:sun.timeOfDay', 'camera:cinematic'],
  },
  {
    id: 'king-of-the-hill', title: 'King of the Hill: on the rim with the score showing',
    vehicle: 'buggy-syn3h', planet: 'volcanic', seed: 7,
    params: { 'sun.timeOfDay': 17 }, requires: ['net', 'param:game.mode'],
  },
  {
    id: 'other-world', title: 'Another world: the alpine planet',
    vehicle: 'buggy-syn3h', planet: 'alpine', seed: 11,
    params: { 'sun.timeOfDay': 16.5 }, requires: ['planet:alpine'],
  },
])

export const SCENE_IDS = Object.freeze(SCENES.map((s) => s.id))

/** Room name for one scene of one run. Fresh per run so nothing carries over between runs. */
export function sceneRoom(sceneId, runTag) {
  const tag = String(runTag).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
  return `showcase-${sceneId}-${tag}`.slice(0, 40)
}

/** The URL that opens a scene. Gameplay scenes skip the lobby with ?autoplay=1. */
export function sceneUrl(base, scene, runTag) {
  const url = new URL(base)
  url.searchParams.set('room', sceneRoom(scene.id, runTag))
  if (scene.planet) url.searchParams.set('planet', scene.planet)
  url.searchParams.set('seed', String(scene.seed))
  if (scene.vehicle) url.searchParams.set('vehicle', scene.vehicle)
  if (!scene.lobby) url.searchParams.set('autoplay', '1')
  url.searchParams.set('name', 'Showcase')
  return url.href
}

/**
 * Why a build cannot show this scene honestly, or null if it can.
 * `features` is { params: string[], vehicles: string[], planets: string[], net: boolean, cinematic: boolean }.
 */
export function missingFeature(scene, features) {
  for (const need of scene.requires ?? []) {
    const [kind, name] = need.split(':')
    const have =
      kind === 'param' ? features.params?.includes(name)
        : kind === 'vehicle' ? features.vehicles?.includes(name)
          : kind === 'planet' ? features.planets?.includes(name)
            : kind === 'net' ? features.net === true
              : kind === 'camera' ? features.cinematic === true
                : false
    if (!have) return `build lacks ${need}`
  }
  return null
}

/**
 * Colour statistics of an RGB24 frame (3 bytes per pixel). Luma uses Rec. 709 weights.
 * `dominantShare` is the fraction of pixels in the most common colour bucket, with each
 * channel quantised to 8 levels: near 1 means the frame is close to a single colour.
 */
export function frameStats(rgb) {
  const pixels = Math.floor(rgb.length / 3)
  if (pixels === 0) throw new Error('Empty frame')
  const buckets = new Map()
  let sum = 0, sumSq = 0
  for (let i = 0; i < pixels; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += luma; sumSq += luma * luma
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const meanLuma = sum / pixels
  const lumaStdDev = Math.sqrt(Math.max(0, sumSq / pixels - meanLuma * meanLuma))
  const dominantShare = Math.max(...buckets.values()) / pixels
  return { meanLuma: round(meanLuma), lumaStdDev: round(lumaStdDev), dominantShare: round(dominantShare), colourBuckets: buckets.size }
}

export const FRAME_LIMITS = Object.freeze({ minMeanLuma: 12, minLumaStdDev: 10, maxDominantShare: 0.85, minColourBuckets: 12 })

/** Reject frames that are black, flat or nearly one colour. Returns { ok, reason }. */
export function judgeFrame(stats, limits = FRAME_LIMITS) {
  if (stats.meanLuma < limits.minMeanLuma) return { ok: false, reason: `too dark: mean luma ${stats.meanLuma}` }
  if (stats.lumaStdDev < limits.minLumaStdDev) return { ok: false, reason: `too flat: luma deviation ${stats.lumaStdDev}` }
  if (stats.dominantShare > limits.maxDominantShare) return { ok: false, reason: `nearly one colour: ${Math.round(stats.dominantShare * 100)}% in one bucket` }
  if (stats.colourBuckets < limits.minColourBuckets) return { ok: false, reason: `too few colours: ${stats.colourBuckets} buckets` }
  return { ok: true, reason: null }
}

/**
 * ffmpeg concat demuxer script holding each still for `hold` seconds. The last file is
 * listed twice because the demuxer ignores the final duration otherwise.
 */
export function concatScript(files, hold = 1.5) {
  if (!files.length) throw new Error('No stills to assemble')
  for (const f of files) if (/['\n\r]/.test(f)) throw new Error(`Unsafe file name for the concat script: ${f}`)
  return files.map((f) => `file '${f}'\nduration ${hold}`).join('\n') + `\nfile '${files.at(-1)}'\n`
}

/** ffmpeg arguments for a looping GIF from a concat script, with a generated palette. */
export function gifArgs({ list, output, width = 960, height = 540, fps = 10, colours = 192 }) {
  const filter =
    `fps=${fps},scale=${width}:${height}:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colours}:stats_mode=full[p];` +
    `[b][p]paletteuse=dither=sierra2_4a`
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-filter_complex', filter, '-loop', '0', output]
}

export const MAX_GIF_BYTES = 10 * 1024 * 1024

/** The manifest written next to the stills and the GIF. */
export function buildManifest({ version, build, files, captured, skipped, browser, generatedAt, hold }) {
  return {
    schemaVersion: 1,
    version,
    commit: build.commit,
    buildId: build.id,
    buildNote: build.note,
    generatedAt,
    browser,
    gif: { file: 'syn3h-showcase.gif', holdSeconds: hold, order: captured.map((c) => `${c.id}.png`) },
    captured,
    skipped,
    files: [...files].sort((a, b) => a.file.localeCompare(b.file)),
  }
}

/** Parse --name value pairs. Unknown names are errors so a typo cannot pass silently. */
export function parseArgs(argv, known) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`)
    const name = flag.slice(2)
    if (!known.includes(name)) throw new Error(`Unknown option --${name}; known: ${known.join(', ')}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) { options[name] = true; continue }
    options[name] = value; i++
  }
  return options
}

function round(n) { return Math.round(n * 1000) / 1000 }
