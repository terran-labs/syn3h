/**
 * How a tyre mark looks on each kind of ground. Plain numbers, so tests can hold the table to
 * the owner's rule (15 November 2026): marks differ by surface, only the swamp's mud keeps the
 * heavy dark ruts, and the heaviest mark on anything else is substantially lighter than the
 * single near-black mark this replaced (colour .055 .035 .022, alpha .25 rolling, .375 spinning).
 *
 * Marks blend normally over the ground, so a near-black tint darkens the ground toward its own
 * shade (pressed, damp or shadowed) and a pale tint lightens it (frost on ice, dust on glass).
 * `darkening` below is the share of the ground's brightness a mark removes at its strongest,
 * which is what the eye reads as heavy or light.
 */
import type {SurfaceKind} from '../../world/terrain/surface'

export interface TreadStyle {
  /** Linear rgb of the mark. */
  tint:readonly [number,number,number]
  /** Alpha when the wheel simply rolls. */
  roll:number
  /** Alpha when the wheel spins or slides under full throttle. */
  slip:number
  /** 0 a smooth, broken scuff on hard ground; 1 a deep print with ribs and lug blocks. */
  tread:number
  /** Width relative to the tyre: soft ground spreads the print. */
  width:number
  /** Seconds before the mark has faded. */
  life:number
}

export const TREADS:Readonly<Record<SurfaceKind,TreadStyle>>={
  // Wet swamp mud: deep, dark, lasting ruts. The one heavy mark.
  mud:{tint:[.05,.04,.02],roll:.32,slip:.42,tread:1,width:1.15,life:90},
  // Dry soil, ash and clay: a pressed print a shade darker than the ground.
  dust:{tint:[.1,.06,.04],roll:.12,slip:.2,tread:.7,width:1,life:60},
  // Loose sand: a wide soft print the wind soon fills.
  sand:{tint:[.16,.11,.06],roll:.11,slip:.18,tread:.85,width:1.12,life:40},
  // Turf: flattened grass, and brown where a spinning wheel tears it.
  grass:{tint:[.08,.08,.03],roll:.09,slip:.2,tread:.45,width:1,life:50},
  // Snow: a crisp print that reads as blue shadow, and stays.
  snow:{tint:[.34,.44,.6],roll:.2,slip:.27,tread:1,width:1.08,life:90},
  // Ice: only a thin white scratch of frost.
  ice:{tint:[.9,.96,1],roll:.07,slip:.2,tread:.15,width:.8,life:40},
  // Obsidian glass: a pale smear of dust, almost nothing unless the wheel slides.
  glass:{tint:[.5,.48,.56],roll:.05,slip:.14,tread:.1,width:.85,life:40},
  // Moon powder: sharp lug prints, and no wind to wear them away.
  regolith:{tint:[.08,.08,.09],roll:.14,slip:.2,tread:1,width:1,life:120},
  // Bare rock: nothing rolling, a faint rubber scuff when sliding.
  rock:{tint:[.08,.07,.06],roll:.03,slip:.14,tread:0,width:.9,life:30},
  // A made road: rubber only when the tyre lets go.
  road:{tint:[.05,.05,.05],roll:.02,slip:.19,tread:.15,width:.9,life:45},
  // A worn dirt track is already packed: a light print on top.
  track:{tint:[.1,.07,.05],roll:.08,slip:.17,tread:.6,width:1,life:50},
}

/** Used where a terrain cannot say what it is made of (stand-in terrains in tests and demos). */
export const DEFAULT_TREAD:TreadStyle=TREADS.dust

/** Share of the ground's brightness the mark removes at alpha `a` (negative: it lightens). */
export function darkening(style:TreadStyle,alpha:number,ground=.5):number {
  const [r,g,b]=style.tint,l=.2126*r+.7152*g+.0722*b
  return alpha*(1-l/ground)
}
