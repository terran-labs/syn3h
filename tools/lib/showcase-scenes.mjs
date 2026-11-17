/**
 * Pure parts of the release showcase: the shot list, the URLs that open each shot, the
 * check that a frame is a real picture, the encoder arguments, the README section and the
 * manifest. No browser and no file system, so tools/showcase.test.mjs tests all of it with
 * node:test. The browser staging for each shot lives in tools/showcase.mjs.
 *
 * The brief for the shots is the owner's: docs/RELEASE-SHOWCASE.md, "What a shot must show".
 */

/**
 * The shots, in README order. Every shot opens in a fresh room with a fixed seed.
 *
 *   kind       'still' or 'clip'
 *   hud        'lobby' (the lobby as the game shows it), 'driving' (hud.mode 1, the view a
 *              player sees with the cursor captured; the default for gameplay), or 'hidden'
 *              (hud.mode 2, nothing but the world; extras only, never the lead image)
 *   planet, seed, vehicle  become ?planet=, ?seed= and ?vehicle=
 *   params     set through the parameter registry after load (time of day and so on)
 *   seconds    clips: length at 60 frames per second
 *   staging    what was placed by the tool rather than reached by play, for the caption
 *   requires   what the build must have for the shot to be honest; otherwise it is skipped
 *   reference  which of the owner's private reference images the shot answers (1 to 7)
 *   readme     false keeps a shot out of the README gallery (still captured and uploaded)
 *              until its composition meets the bar; see docs/RELEASE-SHOWCASE.md
 */
export const SHOTS = Object.freeze([
  {
    id: 'lobby', kind: 'still', hud: 'lobby', seed: 7, reference: null,
    title: 'The galaxy lobby: the Syn3h wordmark and the planets on their orbits',
    staging: 'None: the lobby as it opens.',
  },
  {
    id: 'canyon-convoy', kind: 'still', hud: 'driving', planet: 'badlands', seed: 7, vehicle: 'buggy-syn3h', reference: 3,
    title: 'The buggy in the Badlands at golden hour, a convoy and a jet beyond',
    params: { 'sun.timeOfDay': 16.4 },
    staging: 'Player and bots placed on a canyon floor; they drive themselves from there.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'volcano-fleet', kind: 'still', hud: 'driving', planet: 'volcanic', seed: 7, vehicle: 'buggy-syn3h', reference: 1, readme: false,
    title: 'A mixed fleet under the volcano at dusk',
    params: { 'sun.timeOfDay': 17.9 },
    staging: 'Player placed on the volcano road, bots placed around it; they drive themselves from there.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'wings-glide', kind: 'still', hud: 'driving', planet: 'badlands', seed: 11, vehicle: 'buggy-syn3h', reference: 4,
    title: 'Force-field wings open over the Badlands',
    params: { 'sun.timeOfDay': 15.2 },
    staging: 'The buggy is placed above a ridge with forward speed; the wings open with the normal control and physics flies it.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'jet-tiny-world', kind: 'still', hud: 'driving', planet: 'badlands', seed: 7, vehicle: 'jet', reference: 6,
    title: 'The jet banking high above the curve of a tiny world',
    params: { 'sun.timeOfDay': 14.5 },
    staging: 'The jet is placed high above the world in forward flight; it banks under the normal roll control.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'headlights-night', kind: 'still', hud: 'driving', planet: 'badlands', seed: 7, vehicle: 'buggy-syn3h', reference: 5,
    title: 'Headlights on rough ground at night, a hovercraft and a jet for company',
    params: { 'sun.timeOfDay': 22.8 },
    staging: 'Player and bots placed on open ground; bots drive themselves.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'swamp-river', kind: 'still', hud: 'driving', planet: 'swamp', seed: 7, vehicle: 'buggy-syn3h', reference: 2,
    title: 'Tracks and a river on the green slopes of the Methane Swamp',
    params: { 'sun.timeOfDay': 13.5 },
    staging: 'Player placed above a river bank and driven a short way under normal input.',
    requires: ['param:hud.mode', 'planet:swamp'],
  },
  {
    id: 'lava-night', kind: 'still', hud: 'driving', planet: 'volcanic', seed: 7, vehicle: 'buggy-syn3h', reference: 5,
    title: 'The lava sea at night under the buggy\'s headlights',
    params: { 'sun.timeOfDay': 22.5 },
    staging: 'Player placed on a gentle lava beach, facing the lava.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'lagoon-hovercraft', kind: 'still', hud: 'driving', planet: 'archipelago', seed: 11, vehicle: 'hovercraft', reference: 2, readme: false,
    title: 'The hovercraft crossing the lagoon toward the islands',
    params: { 'sun.timeOfDay': 15 },
    staging: 'Hovercraft placed on open water; it drives under normal input.',
    requires: ['param:hud.mode', 'vehicle:hovercraft'],
  },
  {
    id: 'jet-tiny-world-clean', kind: 'still', hud: 'hidden', planet: 'badlands', seed: 7, vehicle: 'jet', reference: 6, extra: true,
    title: 'The jet above a tiny world, interface hidden (the game\'s Hidden interface, key I)',
    params: { 'sun.timeOfDay': 14.5 }, stage: 'jet-tiny-world',
    staging: 'As the HUD version; the interface is hidden with the game\'s own Interface: Hidden setting.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'clip-dive', kind: 'clip', hud: 'lobby', seed: 7, seconds: 7, reference: null,
    title: 'From the galaxy lobby down into a world',
    staging: 'None: Enter on the current planet in the lobby, recorded as it plays.',
  },
  {
    id: 'clip-wings', kind: 'clip', hud: 'driving', planet: 'badlands', seed: 11, vehicle: 'buggy-syn3h', seconds: 6, reference: 4,
    title: 'Off a ridge and into a glide on force-field wings',
    params: { 'sun.timeOfDay': 15.2 }, stage: 'wings-glide',
    staging: 'The buggy is placed above a ridge with forward speed; the wings open with the normal control.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'clip-jet', kind: 'clip', hud: 'driving', planet: 'badlands', seed: 7, vehicle: 'jet', seconds: 6, reference: 6,
    title: 'The jet banking over the curve of the world',
    params: { 'sun.timeOfDay': 14.5 }, stage: 'jet-tiny-world',
    staging: 'The jet is placed high above the world in forward flight; it banks under the normal roll control.',
    requires: ['param:hud.mode'],
  },
  {
    id: 'clip-lava', kind: 'clip', hud: 'driving', planet: 'volcanic', seed: 7, vehicle: 'buggy-syn3h', seconds: 6, reference: 5,
    title: 'Along the lava shore at night',
    params: { 'sun.timeOfDay': 22.5 }, stage: 'lava-night', drive: true,
    staging: 'Player placed on a lava beach and driven along it under normal input.',
    requires: ['param:hud.mode'],
  },
])

export const SHOT_IDS = Object.freeze(SHOTS.map((s) => s.id))

/** The shots for a run: all of them, or the --only list in SHOTS order. Unknown ids throw. */
export function selectShots(only) {
  if (!only) return [...SHOTS]
  const unknown = only.filter((id) => !SHOT_IDS.includes(id))
  if (unknown.length || !only.length) throw new Error(`Unknown shot ${unknown.join(', ')}; known: ${SHOT_IDS.join(', ')}`)
  return SHOTS.filter((s) => only.includes(s.id))
}

/** Room name for one shot of one run. Fresh per run so nothing carries over between runs. */
export function sceneRoom(shotId, runTag) {
  const tag = String(runTag).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
  return `showcase-${shotId}-${tag}`.slice(0, 40)
}

/** The URL that opens a shot. Gameplay shots skip the lobby with ?autoplay=1. */
export function sceneUrl(base, shot, runTag) {
  const url = new URL(base)
  url.searchParams.set('room', sceneRoom(shot.id, runTag))
  if (shot.planet) url.searchParams.set('planet', shot.planet)
  url.searchParams.set('seed', String(shot.seed))
  if (shot.vehicle) url.searchParams.set('vehicle', shot.vehicle)
  if (shot.hud !== 'lobby') url.searchParams.set('autoplay', '1')
  url.searchParams.set('name', 'Showcase')
  return url.href
}

/**
 * Why a build cannot show this shot honestly, or null if it can.
 * `features` is { params: string[], vehicles: string[], planets: string[] }.
 */
export function missingFeature(shot, features) {
  for (const need of shot.requires ?? []) {
    const [kind, name] = need.split(':')
    const have = kind === 'param' ? features.params?.includes(name)
      : kind === 'vehicle' ? features.vehicles?.includes(name)
        : kind === 'planet' ? features.planets?.includes(name)
          : false
    if (!have) return `build lacks ${need}`
  }
  return null
}

/** hud.mode value for a shot's interface. */
export function hudModeOf(shot) { return shot.hud === 'hidden' ? 2 : shot.hud === 'driving' ? 1 : null }

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

/** Night shots are dark by design, so the floor is low: this catches black, not moody. */
export const FRAME_LIMITS = Object.freeze({ minMeanLuma: 4, minLumaStdDev: 6, maxDominantShare: 0.9, minColourBuckets: 10 })

/** Reject frames that are black, flat or nearly one colour. Returns { ok, reason }. */
export function judgeFrame(stats, limits = FRAME_LIMITS) {
  if (stats.meanLuma < limits.minMeanLuma) return { ok: false, reason: `too dark: mean luma ${stats.meanLuma}` }
  if (stats.lumaStdDev < limits.minLumaStdDev) return { ok: false, reason: `too flat: luma deviation ${stats.lumaStdDev}` }
  if (stats.dominantShare > limits.maxDominantShare) return { ok: false, reason: `nearly one colour: ${Math.round(stats.dominantShare * 100)}% in one bucket` }
  if (stats.colourBuckets < limits.minColourBuckets) return { ok: false, reason: `too few colours: ${stats.colourBuckets} buckets` }
  return { ok: true, reason: null }
}

/** Width of the README copy of each still: sharp on a wide or high-density screen, small to load. */
export const README_WIDTH = 1600
/** Clip sizes: the MP4 is the download, the animated WebP plays in the README. */
export const CLIP = Object.freeze({ fps: 60, mp4Width: 1920, webpWidth: 640, webpFps: 30 })

/** The published file names for one shot. */
export function assetNames(shot) {
  if (shot.kind === 'clip') return { mp4: `${shot.id}.mp4`, webp: `${shot.id}.webp`, poster: `${shot.id}-poster.jpg` }
  return { png: `${shot.id}.png`, full: `${shot.id}.jpg`, readme: `${shot.id}-${README_WIDTH}.webp` }
}

/** Full-size JPEG from a PPM on stdin: 4:4:4 so thin HUD text keeps its colour edges. */
export function fullJpegArgs(quality = 93) { return ['-quality', String(quality), '-sample', '1x1', '-optimize', '-progressive'] }
/** README-width WebP from the lossless PNG. */
export function readmeWebpArgs(input, output, width = README_WIDTH, quality = 84) {
  return ['-quiet', '-q', String(quality), '-m', '6', '-sharp_yuv', '-resize', String(width), '0', input, '-o', output]
}
/** H.264 MP4 at 60 fps from a numbered JPEG sequence; plays in every browser and on phones. */
export function mp4Args({ pattern, output, fps = CLIP.fps, width = CLIP.mp4Width }) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', pattern,
    '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]
}
/**
 * img2webp arguments for an animated WebP from already scaled frames. `frames` are file
 * paths in order; each is shown for `1000 / fps` ms. Lossy, looping.
 */
export function webpAnimArgs({ frames, output, fps = CLIP.webpFps, quality = 62 }) {
  return ['-loop', '0', '-lossy', '-q', String(quality), '-m', '4', '-d', String(Math.round(1000 / fps)), ...frames, '-o', output]
}

/** The release asset URL for a file of a version. */
export function assetUrl(repo, version, file) { return `https://github.com/${repo}/releases/download/${version}/${file}` }

export const README_START = '<!-- showcase:start (written by tools/showcase.mjs; edit the tool, not this block) -->'
export const README_END = '<!-- showcase:end -->'

/**
 * The README's showcase block for one capture: the lead still, the motion clips, then the
 * gallery, each README-width image linked to its full-size original. The caption names the
 * version the pictures really come from.
 */
export function renderReadmeSection({ repo, version, captured, date }) {
  const url = (file) => assetUrl(repo, version, file)
  const shown = (c) => SHOTS.find((s) => s.id === c.id)?.readme !== false
  const stills = captured.filter((c) => c.kind === 'still' && !c.extra && shown(c))
  const clips = captured.filter((c) => c.kind === 'clip')
  const extras = captured.filter((c) => c.kind === 'still' && c.extra)
  const lead = stills.find((c) => c.hud === 'driving') ?? stills[0]
  const img = (c, width) => `<a href="${url(c.files.full)}"><img src="${url(c.files.readme)}" alt="${escapeHtml(c.title)}"${width ? ` width="${width}"` : ''}></a>`
  const lines = [README_START, '']
  if (lead) lines.push(img(lead), '')
  if (clips.length) {
    lines.push(clips.map((c) => `<a href="${url(c.files.mp4)}"><img src="${url(c.files.webp)}" alt="${escapeHtml(c.title)}" width="420"></a>`).join(' '), '')
  }
  const rest = stills.filter((c) => c !== lead)
  if (rest.length) lines.push(rest.map((c) => img(c, 420)).join(' '), '')
  if (extras.length) lines.push(`Without the interface: ${extras.map((c) => `[${c.title.replace(/[[\]]/g, '')}](${url(c.files.full)})`).join(', ')}.`, '')
  lines.push(
    `Captured from ${version}${date ? ` on ${date}` : ''} in Chrome on an Apple M2 Max at the Cinematic quality level, ` +
    'rendered at 3840 x 2160 with the interface a player sees while driving. Click any picture for the full-size original; ' +
    'the moving pictures link to 60 fps video. Starting positions were staged; everything after that is the game playing. ' +
    'Every release\'s pictures are on the [releases page](https://github.com/' + repo + '/releases).',
    '', README_END)
  return lines.join('\n')
}

/** Replace the showcase block in a README, or throw if its markers are missing. */
export function replaceReadmeSection(readme, section) {
  const start = readme.indexOf(README_START), end = readme.indexOf(README_END)
  if (start < 0 || end < start) throw new Error('README has no showcase markers')
  return readme.slice(0, start) + section + readme.slice(end + README_END.length)
}

/**
 * The frozen build directory name for a calendar version, from release-notes/history.tsv
 * (version, milestone, commit, ...) and ../Syn3h-stable/releases.tsv (..., commit, worker
 * version, frozen id). The last production release of that commit wins.
 */
export function frozenIdFor(version, historyTsv, releasesTsv) {
  const row = historyTsv.split('\n').map((l) => l.split('\t')).find((f) => f[0] === version && f[4]?.trim() === 'production')
  if (!row) throw new Error(`${version} is not a production release in release-notes/history.tsv`)
  const commit = row[2]
  const same = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a))
  const frozen = releasesTsv.split('\n').map((l) => l.split('\t')).filter((f) => f[6] && same(f[4], commit))
  if (!frozen.length) throw new Error(`No frozen build recorded for ${version} (${commit})`)
  return frozen.at(-1)[6].trim()
}

/** The manifest written next to the files. */
export function buildManifest({ version, build, captured, skipped, browser, generatedAt, seconds }) {
  return { schemaVersion: 2, version, commit: build.commit, buildId: build.id, generatedAt, captureSeconds: seconds, browser, captured, skipped }
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

function escapeHtml(text) { return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }
function round(n) { return Math.round(n * 1000) / 1000 }
