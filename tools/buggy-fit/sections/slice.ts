/** Cut a triangle soup with planes z = const; returns segments [x0,y0,x1,y1,mat]. */
export function sliceZ(tri: Float32Array, z0: number, mat?: Uint8Array): number[][] {
  const out: number[][] = []
  for (let t = 0; t < tri.length / 9; t++) {
    const o = t * 9, pts: number[][] = []
    for (let k = 0; k < 3; k++) {
      const a = o + k * 3, b = o + ((k + 1) % 3) * 3, za = tri[a + 2] - z0, zb = tri[b + 2] - z0
      if ((za < 0) !== (zb < 0)) { const f = za / (za - zb); pts.push([tri[a] + (tri[b] - tri[a]) * f, tri[a + 1] + (tri[b + 1] - tri[a + 1]) * f]) }
    }
    if (pts.length === 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1], mat ? mat[t] : 0])
  }
  return out
}
