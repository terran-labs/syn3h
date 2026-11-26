/** A planet on screen. depth: distance from the eye along the view; smaller is nearer. */
export interface ScreenDisc { x: number; y: number; radius: number; depth?: number }
export interface LabelPlace extends ScreenDisc { id: string; visible: boolean; depth: number }

export function insideDisc(disc: ScreenDisc, x: number, y: number): boolean {
  return Math.hypot(x - disc.x, y - disc.y) < disc.radius
}

/** How much of disc a is covered by disc b, 0 to 1. */
export function covered(a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y), r = a.radius, s = b.radius
  if (r <= 0 || d >= r + s) return 0
  if (d <= Math.abs(s - r)) return s >= r ? 1 : (s * s) / (r * r)
  // The lens where two circles cross, as a share of the first circle's area.
  const lens = r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) + s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s))
    - 0.5 * Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s))
  return lens / (Math.PI * r * r)
}

/**
 * Whether a planet's caption should be faded: more than half of it lies behind a nearer
 * planet, or it sits behind the sun's core (the sun is drawn over a far planet). `sun` is the
 * sun's disc on screen with its depth, when known.
 */
export function captionHidden(place: LabelPlace, places: readonly LabelPlace[], sun?: ScreenDisc): boolean {
  if (places.some(other => other.id !== place.id && other.visible && other.depth < place.depth && covered(place, other) > 0.5)) return true
  return !!sun && sun.depth !== undefined && sun.depth < place.depth && covered(place, sun) > 0.5
}

/** A planet wholly behind a nearer body has no visible disc for a caption to name. */
function coversDisc(body: ScreenDisc, place: ScreenDisc): boolean {
  return Math.hypot(body.x - place.x, body.y - place.y) + place.radius <= body.radius
}

/** A rectangle on screen, in CSS pixels. */
export interface ScreenBox { left: number; top: number; right: number; bottom: number }

const CONTROL_MARGIN = 8
/** The least gap between a caption and the screen's edge, px. */
export const CAPTION_INSET = 6
const CAPTION_SEPARATION = 2
const MOON_CLEARANCE = 5
// The bright bloom extends beyond the physical solar core, even on the near side of its depth.
const SOLAR_GLARE_SCALE = 6
// The renderer's horizontal lens streak reaches well past the circular bloom. Its
// shoulder needs more clearance vertically than the thin bright line at its centre.
const SOLAR_STREAK_WIDTH = 16
const SOLAR_STREAK_HEIGHT = 1.25

/**
 * Whether a caption's box comes within `margin` of any of the lobby's own controls (the buttons
 * in the lower right, the settings card, the version): such a caption fades out and takes no
 * taps, so it never draws over a control or reads through the card (the owner's iPad mini, 21
 * November 2026). The planet itself stays.
 */
export function captionBlocked(box: ScreenBox, blockers: readonly ScreenBox[], margin = CONTROL_MARGIN): boolean {
  return blockers.some(blocker => boxesOverlap(box, blocker, margin))
}

function boxesOverlap(a: ScreenBox, b: ScreenBox, margin: number): boolean {
  return boxClearance(a, b) < margin
}

function boxClearance(a: ScreenBox, b: ScreenBox): number {
  return Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom)
}

/** Signed distance from the printed caption box to the closest foreground limb. */
export function captionClearance(box: ScreenBox, place: LabelPlace, places: readonly LabelPlace[], sun?: ScreenDisc): number {
  let gap = Infinity
  for (const disc of sun ? [...places, sun] : places) {
    if (disc.depth === undefined || disc.depth >= place.depth || ('visible' in disc && !disc.visible)) continue
    gap = Math.min(gap, discClearance(box, disc))
  }
  return gap
}

function discClearance(box: ScreenBox, disc: ScreenDisc): number {
  const dx = Math.max(box.left - disc.x, disc.x - box.right, 0)
  const dy = Math.max(box.top - disc.y, disc.y - box.bottom, 0)
  return Math.hypot(dx, dy) - disc.radius
}

export interface CaptionSize { width: number; height: number }

/** Clamp a caption under its planet, easing clear of the adjacent controls. */
export function captionBox(place: LabelPlace, top: number, size: CaptionSize, width: number, height: number, blockers: readonly ScreenBox[] = []): ScreenBox | undefined {
  if (discClearance({ left: 0, top: 0, right: width, bottom: height }, place) > 0) return
  return placeCaption(place.x, top, size, width, height, blockers)
}

function placeCaption(x: number, top: number, size: CaptionSize, width: number, height: number, blockers: readonly ScreenBox[]): ScreenBox | undefined {
  const inset = CAPTION_INSET
  if (size.width > width - 2 * inset || size.height > height - 2 * inset) return
  const left = Math.max(inset, Math.min(width - inset - size.width, x - size.width / 2))
  top = Math.max(inset, Math.min(height - inset - size.height, top))
  const bottom = top + size.height
  let pushRight = 0, pushLeft = 0
  for (const blocker of blockers) {
    const min = blocker.left - CONTROL_MARGIN, max = blocker.right + CONTROL_MARGIN
    if (left >= max || left + size.width <= min) continue
    const verticalGap = Math.max(blocker.top - CONTROL_MARGIN - bottom, top - blocker.bottom - CONTROL_MARGIN, 0)
    // Ease into the side clearance before reaching the control's corner.
    const approach = Math.max(0, 1 - verticalGap / CONTROL_MARGIN / 3)
    if (blocker.left + blocker.right > width) {
      pushLeft = Math.max(pushLeft, approach * (left + size.width - min))
    } else {
      pushRight = Math.max(pushRight, approach * (max - left))
    }
  }
  const offset = Math.max(-size.width / 2, Math.min(size.width / 2, pushRight - pushLeft))
  const shifted = Math.max(inset, Math.min(width - inset - size.width, left + offset))
  const box = { left: shifted, top, right: shifted + size.width, bottom }
  return captionBlocked(box, blockers) ? undefined : box
}

export type CaptionContent = 'full' | 'with-count' | 'name'

export interface CaptionOption {
  box: ScreenBox
  content: CaptionContent
  /** Which side of its globe it sits on ('below', 'above', 'left', 'right', or a glare-avoiding spot). */
  anchor?: string
  inGlare?: true
  inline?: 'start' | 'end'
  blockEnd?: true
}

interface CaptionMetrics {
  scale: number
  name: CaptionSize
  biome: CaptionSize
  count?: CaptionSize
  moon?: boolean
}

export interface CaptionSpace extends CaptionSize {
  blockers: readonly ScreenBox[]
}

/** The same minimum button box as shell.css, before the projection scale. */
const MIN_CAPTION_WIDTH = 44
const MIN_CAPTION_HEIGHT = 32
const MIN_COMPACT_HEIGHT = 24

/** Printed row bounds within the hit target. Row sizes are in projected pixels. */
export function captionRows(box: ScreenBox, rows: readonly CaptionSize[], inline?: CaptionOption['inline'], blockEnd?: true): ScreenBox[] {
  let top = blockEnd ? box.bottom - rows.reduce((height, row) => height + row.height, 0) : box.top
  return rows.map(({ width, height }) => {
    const left = inline === 'start' ? box.left : inline === 'end' ? box.right - width : (box.left + box.right - width) / 2
    const row = { left, right: left + width, top, bottom: top + height }
    top = row.bottom
    return row
  })
}

/** Candidate hit boxes. Keep the richer text if it fits near the disc. */
export function captionOptions(place: LabelPlace, metrics: CaptionMetrics, space: CaptionSpace, places: readonly LabelPlace[], sun?: ScreenDisc): CaptionOption[] {
  const { width, height, blockers } = space
  const { scale, name, biome, count, moon } = metrics
  const foreground = places.filter(other => other.visible && other.depth < place.depth)
  const bodies: readonly ScreenDisc[] = sun?.depth !== undefined && sun.depth < place.depth ? [...foreground, sun] : foreground
  if (discClearance({ left: 0, top: 0, right: width, bottom: height }, place) >= 0 ||
      bodies.some(body => coversDisc(body, place))) return []

  const gap = 5 * scale
  const glare = sun && { ...sun, radius: sun.radius * SOLAR_GLARE_SCALE }
  const streak = sun && {
    left: sun.x - sun.radius * SOLAR_STREAK_WIDTH, right: sun.x + sun.radius * SOLAR_STREAK_WIDTH,
    top: sun.y - sun.radius * SOLAR_STREAK_HEIGHT, bottom: sun.y + sun.radius * SOLAR_STREAK_HEIGHT,
  }
  const nameHeight = name.height * scale
  const solarClearance = (box: ScreenBox, ink: ScreenBox) => {
    if (!glare || !streak) return Infinity
    // Empty button padding does not brighten the first line. Check its actual alignment.
    return Math.min(discClearance(box, glare), boxClearance(ink, streak))
  }
  const clear: CaptionOption[] = [], bright: CaptionOption[] = []
  const otherBodies = moon ? places.filter(other => other.visible && other.id !== place.id) : foreground
  const bodyGap = moon ? MOON_CLEARANCE : 1
  const alternatives: { content: CaptionContent; rows: CaptionSize[] }[] = [
    { content: 'full', rows: count ? [name, biome, count] : [name, biome] },
    ...(count ? [{ content: 'with-count' as const, rows: [name, count] }] : []),
    { content: 'name', rows: [name] },
  ]
  for (const { content, rows } of alternatives) {
    const inkSizes = rows.map(row => ({ width: row.width * scale, height: row.height * scale }))
    const size = {
      width: Math.max(MIN_CAPTION_WIDTH * scale, ...inkSizes.map(row => row.width)),
      height: Math.max((content === 'full' ? MIN_CAPTION_HEIGHT : MIN_COMPACT_HEIGHT) * scale,
        inkSizes.reduce((height, row) => height + row.height, 0)),
    }
    const side = place.radius + gap + size.width / 2
    const middleY = place.y - size.height / 2
    const anchors: [number, number, string][] = [
      [place.x, place.y + place.radius + gap, 'below'],
      [place.x, place.y - place.radius - gap - size.height, 'above'],
      [place.x - side, middleY, 'left'],
      [place.x + side, middleY, 'right'],
    ]
    const [belowX, belowY] = anchors[0]
    const below = { left: belowX - size.width / 2, right: belowX + size.width / 2, top: belowY, bottom: belowY + size.height }
    const belowInGlare = solarClearance(below, captionRows(below, inkSizes)[0]) <= 0
    type Scored = CaptionOption & { solarGap: number }
    const build = (positions: readonly (readonly [number, number, string])[]): Scored[] => positions.flatMap(([x, y, anchor]): Scored[] => {
      const box = placeCaption(x, y, size, width, height, blockers)
      if (!box || discClearance(box, place) <= 1 || (sun && discClearance(box, sun) <= 1) ||
          otherBodies.some(body => discClearance(box, body) <= bodyGap)) return []
      const toward: CaptionOption['inline'] = place.x < (box.left + box.right) / 2 ? 'start' : 'end'
      const alignments: Pick<CaptionOption, 'inline' | 'blockEnd'>[] = [{}, { inline: toward }]
      if (place.y >= box.bottom) alignments.splice(1, 0, { blockEnd: true }, { inline: toward, blockEnd: true })
      let bright: Scored | undefined
      for (const alignment of alignments) {
        const ink = captionRows(box, inkSizes, alignment.inline, alignment.blockEnd)
        // Leave a pixel for placement rounding and the difference between line and glyph bounds.
        if (!ink.some(row => discClearance(row, place) <= nameHeight - 1)) continue
        const solarGap = solarClearance(box, ink[0])
        const option: Scored = { box, content, anchor, solarGap, ...alignment }
        if (solarGap > 0) return [option]
        bright ??= option
      }
      return bright ? [bright] : []
    })
    const choices = build(anchors)
    if (belowInGlare && sun) {
      choices.sort((a, b) => b.solarGap - a.solarGap)
      // A diagonal on the outward side can clear a neighbouring caption beside the globe.
      const outward = place.x < sun.x ? place.x - side : place.x + side
      choices.push(...build([[outward, anchors[1][1], 'outward-above'], [outward, belowY, 'outward-below']]))
      // Slide the outward line just above or below the streak if its normal side
      // position is occupied. Keep the slide within one caption height of that side.
      if (streak) {
        const edge = [streak.top - nameHeight - 1, streak.bottom + 1]
        choices.push(...build(edge.filter(y => Math.abs(y - middleY) <= size.height).map((y, i) => [outward, y, i ? 'streak-below' : 'streak-above'] as const)))
      }
    }
    for (const { solarGap, ...choice } of choices) {
      const { box } = choice
      if (moon && solarGap <= 0) continue
      const options = solarGap > 0 ? clear : bright
      if (!options.some(option => option.box.left === box.left && option.box.top === box.top &&
          option.box.right === box.right && option.box.bottom === box.bottom)) {
        options.push(solarGap > 0 ? choice : { ...choice, inGlare: true })
      }
    }
  }
  return [...clear, ...bright]
}

export interface CaptionCandidate {
  id: string
  priority: number
  options: readonly CaptionOption[]
  moon?: boolean
}

const overlaps = (a: CaptionOption, b: CaptionOption): boolean => boxesOverlap(a.box, b.box, CAPTION_SEPARATION)

/**
 * Drop any option that would overlap a name drawn on screen now but not where the layout last
 * put it (one gliding to a new place, or fading out): the layout knows only targets, and two
 * names must never meet on the way.
 */
export function avoidDrawn(captions: readonly CaptionCandidate[], drawn: ReadonlyMap<string, ScreenBox>): CaptionCandidate[] {
  if (!drawn.size) return [...captions]
  return captions.map(caption => {
    const others = [...drawn].filter(([id]) => id !== caption.id).map(([, box]) => box)
    if (!others.length) return caption
    const options = caption.options.filter(option => others.every(box => !boxesOverlap(option.box, box, CAPTION_SEPARATION)))
    return options.length === caption.options.length ? caption : { ...caption, options }
  })
}

/** One placement decision, as a string: same key, same side, lines and alignment. */
export const captionKey = (option: CaptionOption): string => `${option.content}|${option.anchor ?? ''}|${option.inline ?? ''}|${option.blockEnd ? 1 : 0}`

/**
 * Put each caption's previous decision first among its options, so a name keeps its side and
 * lines for as long as they remain valid (the owner, 26 November 2026: "graceful motion only").
 * Without this the first free option in a fixed order wins every frame, and a name at the edge
 * of a rule flips between sides as the planets orbit. An option it left becomes its first
 * choice again only once the one it holds stops working: that is the hysteresis.
 */
export function preferPrevious(captions: readonly CaptionCandidate[], previous: ReadonlyMap<string, string>): CaptionCandidate[] {
  return captions.map(caption => {
    const key = previous.get(caption.id)
    const index = key === undefined ? -1 : caption.options.findIndex(option => captionKey(option) === key)
    if (index <= 0) return caption
    const options = [...caption.options]; const [kept] = options.splice(index, 1)
    return { ...caption, options: [kept, ...options] }
  })
}

/**
 * Keep priority order for unavoidable suppression. Before giving up, try moving up to three
 * other names. Every successful branch keeps all the earlier names, even if one loses a line.
 */
export function captionLayout(captions: readonly CaptionCandidate[]): Map<string, CaptionOption> {
  let placed = new Map<CaptionCandidate, CaptionOption>()
  for (const caption of [...captions].sort((a, b) => Number(!!a.moon) - Number(!!b.moon) || b.priority - a.priority)) {
    const occupied = [...placed.values()]
    const separation = caption.moon ? MOON_CLEARANCE : CAPTION_SEPARATION
    const free = (options: readonly CaptionOption[]) => options.find(option =>
      occupied.every(other => !boxesOverlap(option.box, other.box, separation)))
    const clear = caption.options.filter(option => !option.inGlare)
    const clearSpot = free(clear)
    if (clearSpot) { placed.set(caption, clearSpot); continue }
    if (caption.moon) continue // A moon cannot move or compact a planet's name.

    let budget = 96
    const relocate = (
      pending: readonly CaptionCandidate[], current: Map<CaptionCandidate, CaptionOption>,
      fixed: ReadonlySet<CaptionCandidate>, movesLeft: number, clearOnly: boolean,
    ): Map<CaptionCandidate, CaptionOption> | undefined => {
      const [next, ...rest] = pending
      if (!next) return current
      for (const option of next.options) {
        if (clearOnly && option.inGlare && (next === caption || !placed.get(next)?.inGlare)) continue
        if (budget-- <= 0) return
        const conflicts = [...current].filter(([, other]) => overlaps(option, other))
        if (conflicts.length > movesLeft || conflicts.some(([other]) => fixed.has(other))) continue
        const draft = new Map(current), moved = conflicts.map(([other]) => other)
        for (const other of moved) draft.delete(other)
        draft.set(next, option)
        const result = relocate([...rest, ...moved], draft, new Set([...fixed, next]), movesLeft - moved.length, clearOnly)
        if (result) return result
      }
    }
    const clearLayout = clear.length && relocate([caption], placed, new Set(), 3, true)
    if (clearLayout) { placed = clearLayout; continue }
    const brightSpot = free(caption.options)
    if (brightSpot) { placed.set(caption, brightSpot); continue }
    if (budget > 0 && (caption.options.some(option => option.inGlare) ||
        [...placed.keys()].some(other => other.options.some(option => option.inGlare)))) {
      placed = relocate([caption], placed, new Set(), 3, false) ?? placed
    }
  }
  return new Map([...placed].map(([caption, option]) => [caption.id, option]))
}
