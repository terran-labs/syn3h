import { readMesh, triangles, REF } from './glb'
const prims = readMesh(REF, 'Body')
const { tri, mat, names } = triangles(prims)
console.log(names, prims.map(p => p.idx.length / 3))
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
for (let i = 0; i < tri.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tri[i + c]); hi[c] = Math.max(hi[c], tri[i + c]) }
console.log('bbox', lo.map(v => v.toFixed(3)), hi.map(v => v.toFixed(3)))
// per material bbox
names.forEach((n, m) => {
  const l = [1e9, 1e9, 1e9], h = [-1e9, -1e9, -1e9]
  for (let t = 0; t < mat.length; t++) if (mat[t] === m) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { const v = tri[t * 9 + k * 3 + c]; l[c] = Math.min(l[c], v); h[c] = Math.max(h[c], v) }
  console.log(m, n, l.map(v => v.toFixed(2)).join(','), h.map(v => v.toFixed(2)).join(','))
})
