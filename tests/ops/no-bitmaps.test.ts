/**
 * AGENTS.md, "generate it, do not ship it", and the owner's instruction of 14 November 2026:
 * "eliminate all remaining bitmap textures from the project". This fails when a tracked image
 * file exists that is not on the list below. The list is what was left once the vehicle effect images had gone that night. It only
 * shrinks: delete an entry when its file is replaced by a shader, a vector or a build step,
 * and never add one. The test also fails for an entry whose file is gone, so the list cannot
 * go stale.
 *
 * Files that platforms insist are raster (the share card, install icons) are generated at
 * export time from the vector logo. Existing platform fallbacks remain checked in until
 * a browser-free build path is available. Screenshots and captures belong in /tmp
 * or a release artefact, not in the repository.
 */
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|ico|avif|tga|tiff?|ktx2?|hdr|exr|dds|basis)$/i

/** Each line: path, then who removes it. */
const ALLOWED = new Map<string, string>([
  // Orchestrator: dashboard marks, to become the vector wordmark and traced marks.
  ['dashboard/assets/mira-logo-sun-1024x512.png', 'Orchestrator'],
  ['dashboard/assets/terran-labs-logo.png', 'Orchestrator'],
  ['dashboard/assets/terran-labs-wordmark.png', 'Orchestrator'],
  // UX: explicit vector exports retained as platform fallbacks. Ordinary builds
  // must not require Chrome; remove these once a browser-free export path exists.
  ['public/brand/apple-touch-icon.png', 'UX'],
  ['public/brand/icon-192.png', 'UX'],
  ['public/brand/icon-512.png', 'UX'],
  ['public/brand/share.png', 'UX'],
])
/** The list may never be longer than it was on the day it was written. */
const CEILING = 7

/**
 * Not part of the shrinking list: the owner's one content exception (AGENTS.md, "Curated About
 * images may load only after deliberate About entry"). The Welcome guide's six screenshots are
 * kept as originals in art/welcome/ and encoded by tools/welcome-images.mjs to WebP in four
 * widths. Exactly these names pass, matching tools/check-shipped-assets.mjs ABOUT_PICTURES;
 * the about-in-play and discoverability checks and tools/runtime-assets-check.mjs prove none
 * loads before the player opens the guide.
 */
const ABOUT_PICTURES = ['wings-glide', 'jet-tiny-world', 'lagoon-hovercraft', 'lava-night', 'swamp-river', 'canyon-convoy']
const aboutPicture = (f: string) => ABOUT_PICTURES.some((id) => f === `art/welcome/${id}.jpg` || new RegExp(`^public/welcome/${id}-(640|960|1280|1920)\\.webp$`).test(f))

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((f) => IMAGE.test(f))

it('no tracked image file exists outside the shrinking allow list', () => {
  const extra = tracked().filter((f) => !ALLOWED.has(f) && !aboutPicture(f))
  expect(extra, `New image files are not allowed. Generate them (shader, vector path, seeded generator or build step) instead:\n${extra.join('\n')}`).toEqual([])
})

it('the allow list only shrinks and names only files that still exist', () => {
  expect(ALLOWED.size, 'the allow list grew').toBeLessThanOrEqual(CEILING)
  const present = new Set(tracked())
  const gone = [...ALLOWED.keys()].filter((f) => !present.has(f))
  expect(gone, `These files are gone. Delete their lines from the allow list and lower CEILING to match:\n${gone.join('\n')}`).toEqual([])
})

it('the About picture exception names only pictures that still exist', () => {
  const present = new Set(tracked())
  const gone = ABOUT_PICTURES.filter((id) => !present.has(`art/welcome/${id}.jpg`))
  expect(gone, `These Welcome originals are gone. Delete them from ABOUT_PICTURES:\n${gone.join('\n')}`).toEqual([])
})

it('image data is not embedded in source either', () => {
  let sources: string[] = []
  try {
    sources = execFileSync('git', ['grep', '-lIE', 'data:image/(png|jpe?g|webp|gif|bmp|avif);base64,', '--', 'src', 'shared', 'server', 'index.html', 'dashboard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches, which is the passing case.
    if ((error as { status?: number }).status !== 1) throw error
  }
  expect(sources, 'embedded raster data URIs').toEqual([])
})
