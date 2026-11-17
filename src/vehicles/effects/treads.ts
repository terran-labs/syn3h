/**
 * What a wheel leaves on each kind of ground: the tyre mark, and the dust it throws. Plain
 * numbers, so tests can hold the tables to the owner's rules.
 *
 * Marks (15 and 16 November 2026): they differ by surface, only the swamp's mud keeps heavy
 * ruts, and overall they are something you notice on a second look: a shade of the ground
 * itself (groundTone.ts), darker and a little greyer on soil and grass, a pale frosty scuff on
 * ice and snow, faint on hard ground and stronger only where the tyre slides. `roll` and
 * `slip` are the alpha when rolling and when sliding, before the strength setting
 * (markParams.ts) scales them.
 *
 * Dust: its colour is the ground's, toned; ice and snow throw a little fine pale spray that
 * settles quickly, sand a lot that hangs, grass a few flecks, rock sparse grit.
 */
import type {SurfaceKind} from '../../world/terrain/surface'
import type {Tone} from './groundTone'

export interface TreadStyle extends Tone {
  /** Alpha when the wheel simply rolls. */
  roll:number
  /** Alpha when the wheel spins or slides under full throttle or brakes. */
  slip:number
  /** 0 a smooth scuff on hard ground; 1 a deep print with ribs and lug blocks. */
  tread:number
  /** Width relative to the tyre: soft ground spreads the print. */
  width:number
  /** Seconds before the mark has faded, before the lifetime setting scales it. */
  life:number
}

export const TREADS:Readonly<Record<SurfaceKind,TreadStyle>>={
  // Wet swamp mud: deep, dark, lasting ruts. The heaviest mark.
  mud:{shade:.22,sat:.8,frost:0,roll:.5,slip:.85,tread:1,width:1.15,life:90},
  // Dry soil, ash and clay: a clear pressed print a shade darker than the ground.
  dust:{shade:.32,sat:.8,frost:0,roll:.36,slip:.8,tread:.6,width:1,life:60},
  // Loose sand: a wide soft trough darker than the sand, soon filled.
  sand:{shade:.3,sat:.85,frost:0,roll:.42,slip:.85,tread:.5,width:1.15,life:40},
  // Turf: flattened grass, a darker green; earth shows only where a wheel tears it.
  grass:{shade:.34,sat:.7,frost:0,earth:.25,roll:.36,slip:.85,tread:.35,width:1,life:50},
  // Snow: packed paler and a little blue, never brown, and no dark tread.
  snow:{shade:1,sat:.6,frost:.6,roll:.4,slip:.65,tread:0,width:1.1,life:90},
  // Ice: a faint pale scratch of frost rolling, a scuff sliding.
  ice:{shade:1,sat:.5,frost:.7,roll:.1,slip:.55,tread:0,width:.8,life:40},
  // Obsidian glass: a faint pale smear, almost nothing unless the wheel slides.
  glass:{shade:2.2,sat:.4,frost:0,roll:.05,slip:.3,tread:.1,width:.85,life:40},
  // Moon powder: crisp lug prints, and no wind to wear them away.
  regolith:{shade:.36,sat:1,frost:0,roll:.34,slip:.75,tread:.8,width:1,life:120},
  // Bare rock and lava crust: barely anything rolling, a grey scuff when sliding.
  rock:{shade:.55,sat:.25,frost:0,roll:.04,slip:.35,tread:0,width:.9,life:30},
  // A made road: rubber only when the tyre lets go.
  road:{shade:.35,sat:.2,frost:0,roll:.03,slip:.4,tread:.1,width:.9,life:45},
  // A worn dirt track is already packed: a lighter print on top.
  track:{shade:.42,sat:.8,frost:0,roll:.24,slip:.65,tread:.4,width:1,life:50},
}

/** Used where a terrain cannot say what it is made of (stand-in terrains in tests and demos). */
export const DEFAULT_TREAD:TreadStyle=TREADS.dust

export interface DustStyle extends Tone {
  /** Emission relative to dry soil: 0 none, above 1 more. */
  amount:number
  /** Seconds a particle lives. */
  life:number
  /** Size at birth, metres. */
  size:number
  /** Upward speed at birth, m/s, before the random share. */
  rise:number
}

export const DUSTS:Readonly<Record<SurfaceKind,DustStyle>>={
  mud:{shade:.6,sat:.6,frost:0,amount:.08,life:.6,size:.3,rise:.3},
  dust:{shade:1.15,sat:.7,frost:0,amount:1,life:1,size:.3,rise:.6},
  // Sand hangs in the air.
  sand:{shade:1.1,sat:.85,frost:0,amount:1.5,life:1.6,size:.35,rise:.7},
  // A few green-brown flecks.
  grass:{shade:.7,sat:.6,frost:0,earth:.45,amount:.3,life:.7,size:.22,rise:.5},
  // Fine pale crystals: less, smaller, settling fast.
  snow:{shade:1,sat:.4,frost:.8,amount:.45,life:.55,size:.2,rise:.4},
  ice:{shade:1,sat:.3,frost:.85,amount:.3,life:.45,size:.16,rise:.3},
  glass:{shade:2.5,sat:.3,frost:0,amount:.2,life:.6,size:.2,rise:.4},
  regolith:{shade:1.1,sat:1,frost:0,amount:1.2,life:1.4,size:.3,rise:.5},
  // Sparse grey grit.
  rock:{shade:1,sat:.2,frost:0,amount:.2,life:.5,size:.18,rise:.4},
  road:{shade:1,sat:.3,frost:0,amount:.12,life:.5,size:.2,rise:.4},
  track:{shade:1.1,sat:.75,frost:0,amount:.9,life:1,size:.3,rise:.6},
}
