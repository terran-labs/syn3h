import test from 'node:test'
import assert from 'node:assert/strict'
import { planFinalWorkerCommand as plan } from './final-worker-command.mjs'
const trusted = { artifactRoot:'/frozen/build', toolRoot:'/tools/capsule', runnerRoot:'/owned/run', artifactSha256:'a'.repeat(64), toolSha256:'b'.repeat(64), accountId:'c'.repeat(32) }
test('fixed direct CLI and explicit environment, with no credential values', () => {
  const p = plan({mode:'dry'}, trusted)
  assert.equal(p.executable,'/tools/capsule/runtime/bin/node')
  assert.deepEqual(p.args.slice(-2), ['--outdir','/owned/run/dry-output'])
  assert.ok(p.args.includes('--no-bundle')); assert.ok(p.args.includes('--env-file'))
  assert.equal(p.env.NODE_OPTIONS,undefined); assert.equal(p.env.DYLD_LIBRARY_PATH,undefined)
  assert.equal(p.env.CLOUDFLARE_API_TOKEN,undefined); assert.deepEqual(p.requiredSecrets,[])
  assert.equal(p.launchAllowed,false); assert.equal(p.qualified,false)
})
test('unknown environment and argv inputs cannot enter a plan', () => {
  for (const key of ['env','args','execArgv','NODE_OPTIONS','proxy','cwd']) assert.throws(() => plan({mode:'dry',[key]:'hostile'},trusted))
  assert.throws(() => plan({mode:'dry'},{...trusted,env:{}}))
})
test('paths, identities and allocated port are constrained', () => {
  for (const artifactRoot of ['relative','/','/frozen/../build','/owned/run/child']) assert.throws(() => plan({mode:'dry'},{...trusted,artifactRoot}))
  assert.throws(() => plan({mode:'dry'},{...trusted,toolSha256:'missing'}))
  for (const port of [0,8787.5,65536,'5331']) assert.throws(() => plan({mode:'local',port},trusted))
  assert.ok(plan({mode:'local',port:5331},trusted).args.includes('127.0.0.1'))
})
test('upload adds only reviewed metadata and credential requirement', () => {
  const p=plan({mode:'upload',release:23,message:'Reviewed candidate',immediate:true},trusted)
  assert.deepEqual(p.requiredSecrets,['CLOUDFLARE_API_TOKEN'])
  assert.equal(p.env.CLOUDFLARE_ACCOUNT_ID,trusted.accountId)
  assert.deepEqual(p.args.slice(-2),['--durable-objects-code-update-mode','immediate'])
  assert.throws(() => plan({mode:'upload',release:23,message:'x\ny',immediate:true},trusted))
  assert.throws(() => plan({mode:'upload',release:23,message:'x',immediate:'true'},trusted))
})

test('every mode uses runner project and local persistence stays outside the copy', () => {
  for (const request of [{mode:'dry'}, {mode:'local',port:5331}, {mode:'upload',release:23,message:'Reviewed',immediate:false}]) {
    const p=plan(request,trusted)
    assert.equal(p.cwd,'/owned/run/project')
    assert.equal(p.sourceArtifactRoot,trusted.artifactRoot)
    assert.equal(p.args[p.args.indexOf('--config')+1],'/owned/run/project/wrangler.json')
    assert.ok(!p.args.some(arg => arg.startsWith(trusted.artifactRoot)))
    if(request.mode==='local') assert.equal(p.args[p.args.indexOf('--persist-to')+1],'/owned/run/state')
    else assert.ok(!p.args.includes('--persist-to'))
    assert.equal(p.launchAllowed,false)
  }
})
