import { readMesh, triangles, REF } from './glb'
import { sheet, MAT_RGB } from './render'
const { tri, mat, names } = triangles(readMesh(REF, 'Body'))
const role = (n: string) => /Body/.test(n) ? 'paint' : /Accent/.test(n) ? 'accent' : /Chrome/.test(n) ? 'chrome' : /Head/.test(n) ? 'lamp' : /Tail/.test(n) ? 'tail' : 'frame'
sheet('/tmp/buggy-fit/sections/ref.png', [{ tri, rgb: t => MAT_RGB[role(names[mat[t]])] }])
