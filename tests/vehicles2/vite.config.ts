import { mergeConfig, type Plugin } from 'vite'
import {existsSync,readFileSync} from 'node:fs'
import base from '../../vite.config'
// Concurrent worktrees share node_modules, so their optimizer caches must not collide.
process.env.SYN3H_NO_ROOM_SERVER = '1'
const effectsTest:Plugin={
 name:'vehicle-effects-test-injection',
 transform(code,id){
  if(!id.endsWith('/src/main.ts'))return
  const attached='attachVehicleEffects(game, terrain, player, { local: true })'
  if(code.includes(attached))return {code:code.replace(attached,`Object.assign(window,{disposeTestEffects:${attached}})`),map:null}
  return {code:"import {attachVehicleEffects} from './vehicles/effects';\n"+code.replace('game.add(player)','game.add(player); Object.assign(window,{disposeTestEffects:attachVehicleEffects(game,terrain,player,{local:true})})'),map:null}
 },
}
const baseline:Plugin={name:'vehicle-baseline-profile',enforce:'pre',load(id){
 const prefix=process.env.SYN3H_VEHICLE_BASELINE;if(!prefix)return
 const relative=id.slice(id.indexOf('/src/vehicles/')+1),file=prefix+'/'+relative
 if(id.includes('/src/vehicles/')&&existsSync(file))return readFileSync(file,'utf8')
}}
export default mergeConfig(base, {
 plugins:[baseline,...(process.env.SYN3H_TEST_EFFECTS?[effectsTest]:[])],
 cacheDir:'/tmp/syn3h-vehicles2-vite',
 server:{proxy:{'/ws':{target:`ws://127.0.0.1:${process.env.SYN3H_ROOM_PORT ?? '8787'}`,ws:true}}},
})
