import {expect,it} from 'vitest'
import {voiceProfile,motionMix} from '../../src/audio/Engine'
import {lavaProximity,type AudioTerrain} from '../../src/audio/WorldAudio'
it('gives the five families distinct spectra and a flight roar for the jet',()=>{
 const base={speed:25,throttle:.8,airborne:false}
 const profiles=['buggy-syn3h','buggy-classic','jet','hovercraft','tank'].map(kind=>voiceProfile({...base,kind}))
 expect(new Set(profiles.map(p=>JSON.stringify(p))).size).toBe(5)
 expect(voiceProfile({...base,kind:'jet',wings:true}).roar).toBeGreaterThan(profiles[2].roar)
 expect(motionMix({...base,altitude:600}).wind).toBeGreaterThan(motionMix(base).wind)
})
it('finds lava coastlines and optional vents but excludes water and distant altitude',()=>{
 const t={liquidHeightAt:()=>0,liquidKindAt:(x:number)=>x>10?'lava':null} as unknown as AudioTerrain
 expect(lavaProximity(t,{x:0,y:2,z:0})).toBeGreaterThan(.5)
 expect(lavaProximity(t,{x:0,y:200,z:0})).toBe(0)
 t.liquidKindAt=()=> 'water';expect(lavaProximity(t,{x:0,y:2,z:0})).toBe(0)
 t.vents=()=>[{x:3,y:2,z:0}];expect(lavaProximity(t,{x:0,y:2,z:0})).toBeGreaterThan(.9)
})
