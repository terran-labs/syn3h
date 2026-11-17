/**
 * What the running game loads. The owner's rule of 15 November 2026: one approved design per
 * vehicle, and code for designs that are not shipped must not be in what the game loads.
 *
 * This walks the static and dynamic imports from the game's entry (index.html loads
 * src/main.ts) and checks that no design study, lab or viewer is reachable from it. The
 * studies stay in the repository for the lab pages, which are separate entries.
 */
import {existsSync,readFileSync} from 'node:fs'
import {dirname,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe,expect,it} from 'vitest'
import {TANK_AVAILABLE,VEHICLE_KINDS} from '../../src/vehicles'

const root=fileURLToPath(new URL('../../',import.meta.url))
const IMPORT=/(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
function file(base:string){for(const end of ['','.ts','.tsx','.js','.mjs','/index.ts'])if(existsSync(base+end)&&!/\/$/.test(base+end)&&(end!==''||/\.[a-z]+$/.test(base)))return base+end;return null}
/** Every source file reachable from `entry`, as repository paths. Type-only imports are skipped: they ship nothing. */
function reachable(entry:string){
 const seen=new Set<string>(),queue=[resolve(root,entry)]
 while(queue.length){
  const at=queue.pop()!;if(seen.has(at))continue;seen.add(at)
  if(!/\.(ts|tsx|js|mjs)$/.test(at))continue
  const text=readFileSync(at,'utf8').replace(/\/\*[\s\S]*?\*\//g,'')
  for(const m of text.matchAll(IMPORT)){
   if(/^import\s+type\s/.test(m[0])||/^export\s+type\s/.test(m[0]))continue
   const target=file(resolve(dirname(at),(m[1]??m[2]).replace(/\?.*$/,'')));if(target)queue.push(target)
  }
 }
 return [...seen].map(f=>relative(root,f)).sort()
}

describe('what the game loads',()=>{
 const game=reachable('src/main.ts')
 it('is a real graph: the vehicles and their shared code are in it',()=>{
  for(const f of ['src/vehicles/index.ts','src/vehicles/Vehicle.ts','src/vehicles/Syn3hBuggy.ts','src/vehicles/Jet.ts','src/vehicles/Hovercraft.ts','src/vehicles/Tank.ts','src/vehicles/jetgen/GameJet.ts','src/vehicles/effects/index.ts'])expect(game,f).toContain(f)
  expect(game.length).toBeGreaterThan(100)
 })
 it('contains no design study, lab or viewer',()=>{
  // The jet's study designs live in jetgen/designs.ts; the game takes its one design from jetgen/shipped.ts.
  const studies=game.filter(f=>/^src\/vehicles\/(hovergen|tankDesigns)\/|^src\/vehicles\/jetgen\/designs\.ts$|^src\/dev\/|^labs\/|^tools\/|\/viewer\.ts$|^src\/vehicles\/ClassicBuggy/.test(f))
  expect(studies).toEqual([])
 })
 it('offers each available vehicle once',()=>{
  expect(VEHICLE_KINDS).toEqual([{kind:'buggy',name:'Buggy'},{kind:'jet',name:'Jet'},{kind:'hovercraft',name:'Hovercraft'},...(TANK_AVAILABLE?[{kind:'tank',name:'Tank'}]:[])])
 })
})
