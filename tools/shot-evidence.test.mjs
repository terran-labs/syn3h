// Prepared only. These tests have not been run.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createShotEvidence,createShotDecision} from './shot-evidence.mjs'
function fixture() {
  let time=0
  const local=createShotEvidence(()=>time),remote=createShotEvidence(()=>time)
  local.begin('human',2,1);remote.begin('human',2,1)
  let audio=0, score=0
  const play=remote.wrapAudio(()=>++audio)
  const text=remote.wrapText(function(message){const m=JSON.parse(message);if(m.type==='hit')play('laserHit');else if(m.type==='game')score=m.score;return 42})
  const hit={type:'hit',shooter:2,shot:10,victim:1}
  const report=(x=hit)=>local.reported(x)
  const receive=(x=hit)=>text(JSON.stringify(x))
  const capture=()=>({originals:[true,true,true],local:local.snapshot(),remote:remote.snapshot(),score,scoreBefore:0,requireScore:true})
  return {local,remote,hit,report,receive,play,capture,setTime:t=>time=t,setScore:n=>score=n,audio:()=>audio,text}
}
test('separate original score and sound samples can both succeed',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.setScore(1);f.setTime(610)
  const frozen=f.capture() // Original score sample.
  f.setTime(640);f.receive() // Before the later original sound sample.
  frozen.remote=f.remote.snapshot()
  assert.equal(createShotDecision().seal(frozen).ok,true)
  assert.equal(frozen.remote.at,640)
})
test('no confirmation or server rejection cannot succeed',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.setScore(1)
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})
for(const field of ['shooter','shot','victim']) for(const stage of ['report','confirmation']) test(`wrong ${stage} ${field} fails`,()=>{
  const f=fixture();f.remote.emitted(10);f.setScore(1)
  f.report(stage==='report'?{...f.hit,[field]:99}:f.hit)
  f.receive(stage==='confirmation'?{...f.hit,[field]:99}:f.hit)
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})
test('score after its original sample cannot repair failure',()=>{
  const f=fixture();f.remote.emitted(10);f.report();const sample=f.capture()
  f.setScore(1);f.receive();sample.remote=f.remote.snapshot()
  assert.equal(createShotDecision().seal(sample).ok,false)
})
test('sound after its original sample cannot repair failure',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.setScore(1)
  const sample=f.capture();f.receive()
  assert.equal(createShotDecision().seal(sample).ok,false)
})
test('old baseline and out-of-callback audio never count',()=>{
  const f=fixture();f.play('laserHit');f.remote.emitted(10);f.report();f.setScore(1)
  const noSound=f.remote.wrapText(()=>{})
  noSound(JSON.stringify(f.hit));f.play('laserHit')
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})
test('multiple attempts match one emitted identity, capped at six',()=>{
  const f=fixture();for(let id=5;id<=11;id++)f.remote.emitted(id)
  f.report();f.receive();f.setScore(1)
  assert.equal(f.remote.snapshot().emitted.length,6)
  assert.equal(createShotDecision().seal(f.capture()).ok,false) // Overflow is invalid evidence.
  const g=fixture();g.remote.emitted(9);g.remote.emitted(10);g.report();g.receive();g.setScore(1)
  assert.deepEqual(createShotDecision().seal(g.capture()).matching,[10])
})
test('duplicates do not replace missing identity evidence',()=>{
  const f=fixture();f.remote.emitted(10);f.remote.emitted(10);f.report();f.report();f.setScore(1)
  f.receive({...f.hit,shot:9});f.receive({...f.hit,shot:9})
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})
test('sealed failure is immutable after late evidence or a later verdict',()=>{
  const f=fixture();const decision=createShotDecision();const first=decision.seal(f.capture())
  f.remote.emitted(10);f.report();f.receive();f.setScore(1);f.setTime(1000)
  assert.equal(decision.seal(f.capture()),first);assert.equal(first.ok,false)
})
test('an original failure remains failed despite complete matching evidence',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.receive();f.setScore(1)
  const sample=f.capture();sample.originals=[true,false,true]
  assert.equal(createShotDecision().seal(sample).ok,false)
})
test('bot decision does not require a score',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.receive()
  const sample=f.capture();sample.requireScore=false
  assert.equal(createShotDecision().seal(sample).ok,true)
})
test('text wrapper preserves this, all args, return and throw, clearing active identity',()=>{
  const f=fixture(),context={},sentinel=new Error('sentinel');let seen
  const text=f.remote.wrapText(function(...args){seen={self:this,args};return 71})
  assert.equal(text.call(context,JSON.stringify(f.hit),'extra'),71)
  assert.equal(seen.self,context);assert.equal(seen.args[1],'extra')
  const throwing=f.remote.wrapText(()=>{throw sentinel})
  assert.throws(()=>throwing(JSON.stringify(f.hit)),e=>e===sentinel)
  f.play('laserHit')
  assert.equal(f.remote.snapshot().events.filter(e=>e.kind==='sound').length,0)
})
test('audio/send wrappers preserve this, arguments, return and exceptions',()=>{
  const f=fixture(),context={};let seen
  for(const wrap of [fn=>f.remote.wrapAudio(fn),fn=>f.remote.wrapSend(fn,()=>2)]) {
    const fn=wrap(function(...args){seen={self:this,args};return 93})
    assert.equal(fn.call(context,'ignored',7),93);assert.equal(seen.self,context);assert.deepEqual(seen.args,['ignored',7])
    const error=new Error('original');assert.throws(()=>wrap(()=>{throw error})('ignored'),e=>e===error)
  }
})

test('duplicate accepted hit cannot supply a sound missing from the first callback',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.setScore(1)
  f.remote.wrapText(()=>{})(JSON.stringify(f.hit))
  f.receive()
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})

test('actual string fire and implicit-self hit invocations produce matching evidence',()=>{
  const f=fixture(),sendRemote=f.remote.wrapSend(()=>undefined,()=>2),sendLocal=f.local.wrapSend(()=>undefined,()=>1)
  sendRemote(JSON.stringify({type:'fire',shot:{id:10}}))
  sendLocal(JSON.stringify({type:'hit',shooter:2,shot:10}))
  f.receive();f.setScore(1)
  assert.equal(createShotDecision().seal(f.capture()).ok,true)
})
test('explicit bot victim is preserved instead of reporter identity',()=>{
  const f=fixture();f.local.begin('bot',2,65280);f.remote.begin('bot',2,65280)
  f.remote.wrapSend(()=>undefined,()=>2)(JSON.stringify({type:'fire',shot:{id:10}}))
  f.local.wrapSend(()=>undefined,()=>1)(JSON.stringify({type:'hit',shooter:2,shot:10,victim:65280}))
  f.receive({...f.hit,victim:65280})
  const sample=f.capture();sample.requireScore=false
  assert.equal(createShotDecision().seal(sample).ok,true)
})
test('silent no-op send is an attempt, never accepted transport evidence',()=>{
  const f=fixture();f.remote.wrapSend(()=>undefined,()=>2)(JSON.stringify({type:'fire',shot:{id:10}}))
  f.local.wrapSend(()=>undefined,()=>1)(JSON.stringify({type:'hit',shooter:2,shot:10}))
  f.setScore(1)
  assert.equal(f.local.snapshot().events[0].kind,'report-attempt')
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
})
test('repeated begin retains earlier attempts and evidence',()=>{
  const f=fixture();f.remote.emitted(9);f.remote.begin('human',2,1);f.remote.emitted(10)
  f.report();f.local.begin('human',2,1);f.receive();f.setScore(1)
  assert.deepEqual(f.remote.snapshot().emitted,[9,10])
  assert.equal(createShotDecision().seal(f.capture()).ok,true)
})
test('throw after sound rejects applied evidence and clears active hit',()=>{
  const f=fixture();f.remote.emitted(10);f.report();f.setScore(1)
  const error=new Error('after sound'),text=f.remote.wrapText(()=>{f.play('laserHit');throw error})
  assert.throws(()=>text(JSON.stringify(f.hit)),e=>e===error)
  assert.equal(f.remote.snapshot().events.some(e=>e.kind==='applied'),false)
  assert.equal(createShotDecision().seal(f.capture()).ok,false)
  const count=f.remote.snapshot().events.length;f.play('laserHit')
  assert.equal(f.remote.snapshot().events.length,count)
})
