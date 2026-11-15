import * as T from 'three/webgpu'
import { Builder, type Mat } from '../jetgen/shapes'

/** Round two follows the original GLB's shoulders, waist and swept rear blades.
 * Original bounds: 2.519 x 1.003 x 3.150 m. The approved Box arm buggy is
 * 2.690 m across its tyres and 4.009 m long. These studies target that ground footprint;
 * they are lab designs, not a silent change to the game's collider or ride camera.
 */
export const HERITAGE_EYE: [number, number, number] = [0, .69, -.63]
export const BUGGY_GROUND_SIZE = { width: 2.69, length: 4.00855 }
export interface HeritageDesign {
  id: string; name: string; notes: string; paint: number; accent: number
  shoulder: number; waist: number; rear: number; blade: number; rake: number
  chine: number; bridge: boolean; ribs: boolean
}
export const HERITAGE_DESIGNS: HeritageDesign[] = [
  { id: 'h2-original', name: 'Original', notes: 'Closest to the original: broad shoulders, tucked waist, inset cockpit and swept rear supports and spanning spoiler.', paint: 0x315d99, accent: 0xb576ff, shoulder: 1, waist: 1, rear: 1, blade: 1, rake: 0, chine: .045, bridge: true, ribs: false },
  { id: 'h2-flare', name: 'Flare', notes: 'Fuller front and rear quarters, drawn from the approved buggy flares; narrow waist and original spanning spoiler.', paint: 0x5367b9, accent: 0xffba48, shoulder: 1.035, waist: .96, rear: 1.035, blade: 1, rake: .015, chine: .035, bridge: true, ribs: false },
  { id: 'h2-box', name: 'Box', notes: 'The buggy’s substantial box supports become spoiler roots with inset accent ribs; stacked rear lamps stay inside the stern.', paint: 0x285b7a, accent: 0xf19a38, shoulder: 1.015, waist: .98, rear: 1.02, blade: 1.035, rake: -.025, chine: .045, bridge: true, ribs: true },
  { id: 'h2-bridge', name: 'Arch', notes: 'A taller arch spoiler on the original swept supports, with the approved buggy’s accent ribs.', paint: 0x7e253d, accent: 0xf2c793, shoulder: 1, waist: 1, rear: 1.015, blade: 1.08, rake: 0, chine: .035, bridge: true, ribs: true },
  { id: 'h2-sweep', name: 'Sweep', notes: 'A slightly longer visual sweep through the same footprint: slimmer chine lips and raked spoiler tips, with the original waist retained.', paint: 0x26736d, accent: 0xb6ddd2, shoulder: .995, waist: .95, rear: 1, blade: .97, rake: .045, chine: .025, bridge: true, ribs: false },
]

// The source mesh has front shoulders at z -1.07, a waist around zero, and rear
// haunches at z .56..1.07. Preserve those stations instead of turning it into a wedge.
export function heritageHull(d: HeritageDesign): number[][] {
  return [
    [-1.63, .035, .035, .025, .08, 2.4],
    [-1.48, .54, .105, .08, .15, 2.8],
    [-1.06, 1.18 * d.shoulder, .20, .14, .21, 3.1],
    [-.68, 1.17 * d.shoulder, .22, .15, .22, 3.0],
    [-.16, .88 * d.waist, .22, .13, .24, 2.8],
    [.22, .95 * d.waist, .23, .15, .23, 3.0],
    [.60, 1.18 * d.rear, .24, .16, .23, 3.1],
    [1.04, 1.17 * d.rear, .23, .16, .23, 3.0],
    [1.40, .68, .23, .13, .24, 2.7],
    [1.50, .16, .13, .08, .24, 2.3],
  ].map(([z, w, t, b, y, e]) => [z * 1.25, w * 1.10, t * 1.25, b * 1.25, y * 1.25, e])
}

export function buildHeritage(d: HeritageDesign, detail: number, cockpit = true): Builder {
  const b = new Builder(detail), hull = heritageHull(d)
  b.fuselage(hull)
  if (cockpit) b.cockpit(-1.37, .43, .55, HERITAGE_EYE, { bulge: .40, rim: .022, floor: .65 })
  // Four lift ports occupy the same front/rear quadrants as the source controller.
  for (const z of [-1.02, 1.0]) b.port(.96, z, .18, .24, .12)
  // Chrome spine and central stern nozzle, rising behind the canopy as in the original.
  b.body('chrome', [[.43, .06, .055, .045, .60, 2.5], [.85, .16, .13, .08, .75, 2.5], [1.34, .23, .18, .13, .84, 2.6]], { seg: 5, around: 20 })
  b.nozzle(1.36, .84, .22, .18, 0, 2.6)
  // The kit's generic glow lies behind the inner throat. Put the visible light inside
  // the open nozzle, still recessed from its exit, rather than painting its back wall.
  b.add('glow', new T.CircleGeometry(.13, Math.max(8, Math.round(20 * detail))).translate(0, .84, 1.64))
  // Swept spoiler supports: source roots at x .77/y .51, tips at x .73/y 1.02.
  // The original wing spans between the supports above the central thruster.
  b.surf([[.79, .50, .83, .64, .16], [.79, .88, 1.20, .49, .14], [.76, 1.22 * d.blade, 1.45 + d.rake, .40, .14]], { tipFrom: .86 })
  if (d.bridge) b.surf([[0, 1.22 * d.blade, 1.55, .26, .045], [.76, 1.22 * d.blade, 1.49, .34, .045]], { round: false })
  if (d.ribs) b.surf([[.805, .52, 1.10, .12, .035], [.805, .84, 1.30, .10, .03], [.775, 1.12, 1.51, .09, .025]], { mat: 'accent', round: false })
  // Thin bright chine lips follow the pinched planform. Their depth stays small;
  // these are the source's ground-level spoilers, not added aircraft wings.
  b.body('chrome', hull.map(([z,w,,,y,e]) => [z, w + d.chine, .018, .018, Math.max(.055, y - .14), e]), { seg: 10, around: 24 })
  // A dark lower rim gives the cushion a readable underside without a rubber skirt.
  b.body('dark', hull.map(([z,w,,,y,e]) => [z * .97, w * .94, .035, .03, Math.max(.045, y - .17), e]), { seg: 8, around: 20 })
  return b
}

/** Small solid fittings use the same piece stream as the lofts. */
export function addHeritageBox(b: Builder, mat: Mat, size: [number,number,number], at: [number,number,number]): void {
  b.add(mat, new T.BoxGeometry(...size).translate(...at))
}
