import { mergeConfig, type Plugin } from 'vite'
import base from '../../vite.config'
// Concurrent worktrees share node_modules, so their optimizer caches must not collide.
process.env.SYN3H_NO_ROOM_SERVER = '1'
const effectsTest:Plugin={
 name:'vehicle-effects-test-injection',
 transform(code,id){
  if(!id.endsWith('/src/main.ts'))return
  return {code:"import {attachVehicleEffects} from './vehicles/effects';\n"+code.replace('game.add(player)','game.add(player); Object.assign(window,{disposeTestEffects:attachVehicleEffects(game,terrain,player,{local:true})})'),map:null}
 },
}
export default mergeConfig(base, {
 plugins:process.env.SYN3H_TEST_EFFECTS?[effectsTest]:[],
 cacheDir:'/tmp/syn3h-vehicles2-vite',
 server:{proxy:{'/ws':{target:`ws://127.0.0.1:${process.env.SYN3H_ROOM_PORT ?? '8787'}`,ws:true}}},
})
