/** Sheet of one candidate at detail 0, 1 and 2:  npx tsx tools/buggy-fit/sections/lods.ts <module> <tag> */
import { resolve } from 'node:path'
import { sheet, MAT_RGB, VIEWS } from './render'
import { soupOf } from './measure'
const mod = (await import(resolve(process.argv[2]))).default
sheet(`/tmp/buggy-fit/sections/${process.argv[3]}.png`, [0, 1, 2].map(d => { const s = soupOf(mod.build(d)); return { tri: s.tri, rgb: (t: number) => MAT_RGB[s.role[t]] } }), [VIEWS[4], VIEWS[0], VIEWS[3]])
