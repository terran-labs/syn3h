/**
 * The tank tread map, generated once at run time in place of tank-track.png.
 *
 * Why a texture and not shader nodes: the tread sits on a plain MeshStandardMaterial that
 * Tank.ts owns and disposes, and the tank scrolls it with `map.offset` to follow ground speed.
 * A generated map keeps that path unchanged and costs well under a millisecond of CPU once.
 *
 * The pixel data is built on first use and cached; every call returns a new texture over that
 * data, because each tread segment disposes the texture it holds.
 */
import * as T from 'three/webgpu'

/** Build an RGBA8 image of `w` by `h` from `pixel(x, y)` in 0 to 1, row 0 at v = 0. */
function image(w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(w * h * 4)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = pixel((i + .5) / w, (j + .5) / h), o = (j * w + i) * 4
    for (let k = 0; k < 4; k++) data[o + k] = Math.round(Math.min(1, Math.max(0, c[k])) * 255)
  }
  return data
}

function texture(data: Uint8Array, w: number, h: number, colorSpace: string = T.NoColorSpace): T.DataTexture {
  const t = new T.DataTexture(data, w, h, T.RGBAFormat, T.UnsignedByteType)
  t.wrapS = t.wrapT = T.RepeatWrapping
  t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true
  t.colorSpace = colorSpace; t.needsUpdate = true
  return t
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
let treadData: Uint8Array | undefined
const TREAD_W = 8, TREAD_H = 64
/**
 * One tank tread link per tile along v, after tank-track.png: a light plate a quarter of the
 * tile long across the tile seam, dark between plates. The plate now has bevelled edges, a raised
 * grouser bar and a dark gap, where the original was one flat grey band. It varies along v only,
 * as the original did, so it suits whatever way the tread mesh lays out u. sRGB, as before.
 */
export function createTreadMap(): T.DataTexture {
  treadData ??= image(TREAD_W, TREAD_H, (_x, v) => {
    const d = Math.min(v, 1 - v)
    const plate = 1 - smooth(.105, .135, d), bevel = smooth(.02, .1, .135 - d)
    const bar = 1 - smooth(.01, .03, Math.abs(d - .06))
    const g = plate * (.42 + .18 * bevel + .2 * bar) + (1 - plate) * .05
    return [g, g, g, 1]
  })
  return texture(treadData, TREAD_W, TREAD_H, T.SRGBColorSpace)
}
