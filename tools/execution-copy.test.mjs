import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FINAL_CONFIG, inspectFinalArtifact } from './final-worker-artifact.mjs'
import { inventoryExecutionTree, prepareExecutionCopy, verifyExecutionCopy } from './execution-copy.mjs'
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'execution-copy-')))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const source=path.join(root,'source'), runner=path.join(root,'runner')
  fs.mkdirSync(source); fs.mkdirSync(path.join(source,'worker')); fs.mkdirSync(path.join(source,'dist')); fs.mkdirSync(path.join(source,'dist/empty'))
  fs.writeFileSync(path.join(source,'worker/worker.js'),'export default { fetch() { return new Response("ok") } }')
  fs.writeFileSync(path.join(source,'wrangler.json'),JSON.stringify(FINAL_CONFIG))
  fs.writeFileSync(path.join(source,'provenance.json'),'{}')
  fs.writeFileSync(path.join(source,'dist/build.json'),JSON.stringify({version:'v26.11.1518',commit:'a'.repeat(40)}))
  fs.writeFileSync(path.join(source,'dist/.assetsignore'),'*.map\n')
  fs.writeFileSync(path.join(source,'dist/app.js'),'void 0')
  fs.writeFileSync(path.join(source,'dist/app.js.map'),'{}')
  return {root,source,runner}
}
async function inputs(f) {
  return {...f, expectedArtifactSha256:(await inspectFinalArtifact(f.source)).identity.artifactSha256,
    expectedInventorySha256:inventoryExecutionTree(f.source).sha256}
}
test('complete independent copy preserves modes despite umask and includes empty directories',async t=>{
  const f=fixture(t); fs.chmodSync(path.join(f.source,'dist/app.js'),0o751)
  const args=await inputs(f), old=process.umask(0o077)
  let r
  try {r=await prepareExecutionCopy(args)} finally {process.umask(old)}
  assert.equal(fs.statSync(path.join(r.project,'dist/app.js')).mode&0o777,0o751)
  assert.equal(r.original.sha256,r.copied.sha256)
  assert.ok(r.copied.rows.some(x=>x.path==='dist/empty'&&x.type==='directory'))
  assert.equal(verifyExecutionCopy(r).endpointEquality,true)
  assert.equal(r.launchAllowed,false)
  assert.throws(()=>verifyExecutionCopy(JSON.parse(JSON.stringify(r))))
})
test('provenance, excluded map and empty-directory mutations all invalidate postcheck',async t=>{
  for(const name of ['provenance.json','dist/app.js.map','dist/empty']) {
    const f=fixture(t),r=await prepareExecutionCopy(await inputs(f))
    if(name==='dist/empty') fs.rmdirSync(path.join(r.project,name))
    else fs.appendFileSync(path.join(r.project,name),'changed')
    assert.throws(()=>verifyExecutionCopy(r))
  }
})
test('source change during asynchronous inspection fails before accepted copy',async t=>{
  const f=fixture(t),args=await inputs(f)
  const pending=prepareExecutionCopy(args)
  fs.appendFileSync(path.join(f.source,'provenance.json'),' ')
  await assert.rejects(pending)
})
test('fresh paths and ordinary ancestors are required',async t=>{
  const f=fixture(t),args=await inputs(f)
  fs.mkdirSync(f.runner)
  await assert.rejects(prepareExecutionCopy(args))
  const link=path.join(f.root,'link'); fs.symlinkSync(f.source,link)
  assert.throws(()=>inventoryExecutionTree(link))
  await assert.rejects(prepareExecutionCopy({...args,runner:path.join(link,'runner')}))
  await assert.rejects(prepareExecutionCopy({...args,runner:path.join(f.source,'runner')}))
})
test('hardlinks and privilege bits are rejected',t=>{
  const f=fixture(t)
  fs.linkSync(path.join(f.source,'dist/app.js'),path.join(f.root,'alias'))
  assert.throws(()=>inventoryExecutionTree(f.source))
  fs.unlinkSync(path.join(f.root,'alias'))
  fs.chmodSync(path.join(f.source,'dist/app.js'),0o4755)
  assert.throws(()=>inventoryExecutionTree(f.source))
})
test('ordinary root scratch and separate state additions are permitted',async t=>{
  const f=fixture(t),r=await prepareExecutionCopy(await inputs(f))
  fs.mkdirSync(path.join(r.project,'.wrangler/tmp'),{recursive:true})
  fs.writeFileSync(path.join(r.project,'.wrangler/tmp/generated'),'scratch')
  fs.writeFileSync(path.join(r.state,'data'),'state')
  assert.equal(verifyExecutionCopy(r).endpointEquality,true)
})
test('scratch links, hardlinks and lookalike prefixes are rejected',async t=>{
  for(const kind of ['symlink','hardlink','prefix','nested']) {
    const f=fixture(t),r=await prepareExecutionCopy(await inputs(f))
    fs.mkdirSync(path.join(r.project,'.wrangler'))
    if(kind==='symlink') fs.symlinkSync(r.source,path.join(r.project,'.wrangler/link'))
    if(kind==='hardlink') fs.linkSync(path.join(r.project,'dist/app.js'),path.join(r.project,'.wrangler/alias'))
    if(kind==='prefix') fs.mkdirSync(path.join(r.project,'.wrangler-other'))
    if(kind==='nested') fs.mkdirSync(path.join(r.project,'dist/.wrangler'))
    assert.throws(()=>verifyExecutionCopy(r))
  }
})
test('original source and state root are still checked after preparation',async t=>{
  const f=fixture(t),r=await prepareExecutionCopy(await inputs(f))
  fs.appendFileSync(path.join(r.source,'dist/app.js.map'),' ')
  assert.throws(()=>verifyExecutionCopy(r))
  const g=fixture(t),s=await prepareExecutionCopy(await inputs(g))
  fs.rmdirSync(s.state); fs.symlinkSync(s.source,s.state)
  assert.throws(()=>verifyExecutionCopy(s))
})
