/**
 * Ground palettes, one per look (`terrain.look`). Plain numbers and no renderer imports,
 * so the terrain material, the lobby's painted planet maps, tests and the server all read
 * the same table and cannot drift apart.
 */
export interface Palette {
  groundDark: number; groundLight: number; rockDark: number; rockLight: number
  /** The darker rock of the centre feature and the mountain tops. */
  darkRockA: number; darkRockB: number
  /** Ground at the waterline (overridden to scorched black round a lava sea). */
  shore: number
  roadDark: number; roadLight: number; roadLine: number
  /** Colour of snow where the snow line is low enough to show. */
  snow: number
  /** 0 matt dust, up to about 0.45 for wet ice and glass: subtracted from the roughness. */
  gloss: number
  /** Glowing seams in the rock (0 for none). */
  seam: number
  /** 0..1: loose sand or snow that glitters in the sun and ripples (rich surface only). */
  sparkle: number
  /** One accent colour used sparingly (0 for none): streaks on cliffs, or a band above the shore. */
  accent: number
  /** 1: the accent is a margin above the waterline; 0: mineral streaks down the cliffs. */
  accentShore: number
  /**
   * How the roads are drawn. 0: a made road with crisp edges and edge lines (alpine only).
   * Above 0: a worn track, two wheel ruts with a ragged edge that fades into the ground;
   * the number is how worn the band between and beside the ruts is (1 a well used dirt
   * track, 0.3 little more than tyre marks).
   */
  track: number
  /** The sea on the lobby's painted globe. The sea in the world itself is the Water Lab's. */
  seaDeep: number; seaShallow: number
}

export const LOOK_NAMES = ['volcanic', 'desert', 'alpine', 'archipelago', 'ice', 'obsidian', 'badlands', 'moon', 'swamp'] as const

const WATER = { seaDeep: 0x0a3562, seaShallow: 0x2fc4bd }
const PLAIN = { snow: 0xeef2f6, gloss: 0, seam: 0 }
const NO_ACCENT = { sparkle: 0, accent: 0, accentShore: 0 }

export const PALETTES: readonly Palette[] = [
  // 0 Volcanic: saturated rust and basalt, the colour of Tholus and the Mars Explorer worlds.
  {
    groundDark: 0xa5351a, groundLight: 0xd9602c, rockDark: 0x7a2a14, rockLight: 0xa8431f,
    darkRockA: 0x241715, darkRockB: 0x3f241c, shore: 0xc28a5a,
    // Pale trodden dust, so a track shows on rust plains and on black basalt alike.
    roadDark: 0x8c5c44, roadLight: 0xa97a5e, roadLine: 0xc79670, ...PLAIN, ...WATER,
    sparkle: 0, accent: 0x5a4fb0, accentShore: 0,
    track: 0.9,
  },
  // 1 Desert: gold sand, banded orange sandstone, a pale beach.
  {
    groundDark: 0xc98a3c, groundLight: 0xf0c878, rockDark: 0x9a4a22, rockLight: 0xd08040,
    darkRockA: 0x8a4a26, darkRockB: 0xb86a34, shore: 0xf2deb0,
    roadDark: 0x7a5230, roadLight: 0x93683f, roadLine: 0xf6e3b4, ...PLAIN, ...WATER,
    sparkle: 1, accent: 0x3f9a7a, accentShore: 1,
    track: 1,
  },
  // 2 Alpine: meadow green, grey granite, shingle at the water.
  {
    groundDark: 0x3f5f26, groundLight: 0x86a04a, rockDark: 0x55555a, rockLight: 0x8a8782,
    darkRockA: 0x3e4044, darkRockB: 0x63625f, shore: 0xb8b29c,
    roadDark: 0x5a4a38, roadLight: 0x6e5c46, roadLine: 0xd8cfb8, ...PLAIN, seaDeep: 0x0a3562, seaShallow: 0x2f8fc4,
    sparkle: 0, accent: 0xb08a6a, accentShore: 0,
    track: 0,
  },
  // 3 Archipelago: bright tropical green over white sand and pale coral rock.
  {
    groundDark: 0x4a9440, groundLight: 0xa6c95e, rockDark: 0xa89a7c, rockLight: 0xe2d6b6,
    darkRockA: 0x8c8672, darkRockB: 0xb8b09a, shore: 0xf8efcf,
    roadDark: 0x9a8660, roadLight: 0xb39c74, roadLine: 0xfff6d8, ...PLAIN, seaDeep: 0x0b5f92, seaShallow: 0x58ecd8,
    sparkle: 0.5, accent: 0, accentShore: 0,
    track: 0.8,
  },
  // 4 Ice moon: white and pale cyan ice, glinting; blue only in shadowed cliffs and cracks
  // (the owner, 16 November 2026: it read as a blue world).
  {
    groundDark: 0xc4d6e2, groundLight: 0xeef4f8, rockDark: 0x7e9cb4, rockLight: 0xc4d8e6,
    darkRockA: 0x56748e, darkRockB: 0x92acc0, shore: 0xdde9f0,
    roadDark: 0x4a6a86, roadLight: 0x5f809c, roadLine: 0xe8f6ff,
    snow: 0xf4f8ff, gloss: 0.18, seam: 0, seaDeep: 0x061a33, seaShallow: 0x1f5f8a,
    sparkle: 0.7, accent: 0x3fd0e0, accentShore: 0,
    track: 0.7,
  },
  // 5 Obsidian: black volcanic glass with faint magenta seams.
  {
    groundDark: 0x0e0c12, groundLight: 0x262130, rockDark: 0x08070b, rockLight: 0x2c2636,
    darkRockA: 0x050507, darkRockB: 0x1c1826, shore: 0x140a08,
    roadDark: 0x2c2630, roadLight: 0x3a3340, roadLine: 0x9a4a8a,
    snow: 0xeef2f6, gloss: 0.2, seam: 0xff2a9a, ...WATER,
    ...NO_ACCENT,
    track: 0.55,
  },
  // 6 Badlands: red clay and strongly banded cream and oxblood buttes.
  {
    groundDark: 0x9a3a24, groundLight: 0xd27a4a, rockDark: 0x7a2418, rockLight: 0xe6aa78,
    darkRockA: 0x6a2a1c, darkRockB: 0xb0583a, shore: 0xe2b890,
    roadDark: 0x5a2a1e, roadLight: 0x70392a, roadLine: 0xf0c8a0, ...PLAIN, seaDeep: 0x0e4a5a, seaShallow: 0x3fb0a0,
    sparkle: 0, accent: 0x6fb0a0, accentShore: 0,
    track: 1,
  },
  // 7 Moon: grey regolith, nothing else.
  {
    groundDark: 0x6a6a6e, groundLight: 0xa6a6a8, rockDark: 0x4a4a4e, rockLight: 0x8c8c8e,
    darkRockA: 0x3a3a3e, darkRockB: 0x5e5e62, shore: 0x56565a,
    roadDark: 0x4e4e52, roadLight: 0x5e5e62, roadLine: 0xd4d4d4, ...PLAIN, seaDeep: 0x3a3a3e, seaShallow: 0x56565a,
    sparkle: 0.3, accent: 0, accentShore: 0,
    track: 0.3,
  },
  // 8 Mire: a warm wetland. Olive and ochre mud, reed and moss tones, round murky green-brown water.
  {
    groundDark: 0x4a5422, groundLight: 0x8c8a3a, rockDark: 0x5a4a22, rockLight: 0x9a8440,
    darkRockA: 0x3a3a1e, darkRockB: 0x5e5a2e, shore: 0x6c6a3a,
    roadDark: 0x3e3a22, roadLight: 0x524c2c, roadLine: 0xc8c890, ...PLAIN, seaDeep: 0x1c2412, seaShallow: 0x5a5a2c,
    sparkle: 0, accent: 0xb05a2a, accentShore: 1,
    track: 0.9,
  },
]

/**
 * A frozen sea's ice (the Ice Moon's): floes in two whites, polished wind-scoured blue ice,
 * and the blue of the cracks between floes. A little under white, so the sun does not burn it out. Shared by the ice sheet's material in the world and the lobby's painted maps.
 */
export const SEA_ICE = { floe: 0xd6e2ea, old: 0xb8c9d6, scour: 0x8eaec4, crack: 0x3a6688 } as const

export function paletteFor(look: number): Palette {
  return PALETTES[look] ?? PALETTES[0]
}
