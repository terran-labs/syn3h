import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { FINAL_CONFIG, assertFinalConfig, clientInventory, assertSelfContainedWorker, inspectFinalArtifact, prepareFinalArtifact } from './final-worker-artifact.mjs'
const hash = x => createHash('sha256').update(x).digest('hex')
test('final artifact binds approved bytes and policy without modifying snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'final-worker-')), snapshot = join(root, 'snapshot'), destination = join(root, 'final')
  try {
    mkdirSync(join(snapshot, 'dist/v/26.11.1518'), { recursive: true })
    writeFileSync(join(snapshot, 'dist/build.json'), JSON.stringify({version:'v26.11.1518',commit:'a'.repeat(40)}))
    writeFileSync(join(snapshot, 'dist/.assetsignore'), '*.map\n')
    writeFileSync(join(snapshot, 'dist/index.html'), 'current')
    writeFileSync(join(snapshot, 'dist/v/26.11.1518/index.html'), 'frozen')
    writeFileSync(join(snapshot, 'dist/unused.map'), 'diagnostic')
    writeFileSync(join(snapshot, 'wrangler.toml'), 'reviewed original')
    const workerBytes=Buffer.from('export default { fetch() { return new Response("ok") } }')
    const args={snapshot,destination,workerBytes,reviewedWorkerSha256:hash(workerBytes),
      reviewedSourceConfigSha256:hash('reviewed original'), reviewedClientManifest:clientInventory(snapshot).selected,
      provenance:{origin:'synthetic, not production evidence'}}
    await assert.rejects(prepareFinalArtifact({...args,reviewedWorkerSha256:'0'.repeat(64)}),/reviewed module/)
    const result=await prepareFinalArtifact(args)
    assert.equal(result.identity.version,'v26.11.1518')
    assert.ok(result.files.some(f=>f.path==='dist/v/26.11.1518/index.html'))
    assert.ok(result.files.some(f=>f.path==='dist/.assetsignore'))
    assert.equal(readFileSync(join(snapshot,'dist/unused.map'),'utf8'),'diagnostic')
    await assert.rejects(prepareFinalArtifact(args),/EEXIST/)
    writeFileSync(join(destination,'worker/worker.js'),'export default {}')
    assert.notEqual((await inspectFinalArtifact(destination)).identity.artifactSha256,result.identity.artifactSha256)
    writeFileSync(join(destination,'dist/.assetsignore'),'*.js\n')
    await assert.rejects(inspectFinalArtifact(destination),/upload policy/)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('configuration and unsupported module imports fail closed',async()=>{
  assertFinalConfig(FINAL_CONFIG)
  for(const extra of [{build:{command:'npm run build'}},{env:{production:{}}},{compatibility_flags:['nodejs_compat']},{no_bundle:false}])
    assert.throws(()=>assertFinalConfig({...FINAL_CONFIG,...extra}),/Unsupported/)
  for(const source of ['import x from "outside"; export default x','export {x} from "outside"','export default ()=>import("outside")','export default import.meta.url'])
    await assert.rejects(assertSelfContainedWorker(Buffer.from(source)),/self-contained/)
})
test('asset inventory rejects symlinks and unreviewed selection semantics',()=>{
  const root=mkdtempSync(join(tmpdir(),'final-assets-'))
  try {
    mkdirSync(join(root,'dist'));writeFileSync(join(root,'dist/.assetsignore'),'*.map\n')
    writeFileSync(join(root,'dist/_redirects'),'/old /new')
    assert.throws(()=>clientInventory(root),/routing directive/)
    rmSync(join(root,'dist/_redirects'));symlinkSync('/tmp',join(root,'dist/escape'))
    assert.throws(()=>clientInventory(root),/symlink/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('restricted asset selection agrees with installed Wrangler matcher', () => {
  // Evaluate only the bundled ignore package, never the Wrangler CLI or uploader.
  // A changed package boundary fails this test and requires uploader review.
  const require = createRequire(import.meta.url)
  const cli = readFileSync(join(require.resolve('wrangler/package.json'), '../wrangler-dist/cli.js'), 'utf8')
  const start = cli.indexOf('var require_ignore = __commonJS({')
  const end = cli.indexOf('\n// ', start)
  assert.ok(start >= 0 && end > start)
  const ignore = runInNewContext(cli.slice(start, end) + '\nrequire_ignore()', {
    __commonJS: definitions => () => { const module = { exports: {} }; Object.values(definitions)[0](module.exports, module); return module.exports },
    __name: fn => fn, init_import_meta_url() {}, process: {platform: 'darwin', env: {}}
  })
  const matcher = ignore().add(['/.assetsignore', '/_headers', '/_redirects', '*.map', ''])
  for (const name of ['chunks.map/nested.js', 'chunks.MAP/nested.js', 'file.MAP', 'file.Map'])
    assert.equal(matcher.test(name).ignored, true, name)
  const root = mkdtempSync(join(tmpdir(), 'selection-parity-'))
  try {
    mkdirSync(join(root, 'dist/assets'), { recursive: true })
    writeFileSync(join(root, 'dist/.assetsignore'), '*.map\n')
    const paths = ['index.html', 'assets/main.js', 'assets/main.js.map', 'assets/UPPER.JS', 'almost.map.js']
    for (const name of paths) writeFileSync(join(root, 'dist', name), name)
    assert.deepEqual(clientInventory(root).selected.map(r => r.path.slice(5)).sort(), paths.filter(p => !matcher.test(p).ignored).sort())
    for (const name of ['chunks.map', 'chunks.MAP']) {
      mkdirSync(join(root, 'dist', name)); writeFileSync(join(root, 'dist', name, 'nested.js'), 'nested')
      assert.throws(() => clientInventory(root), /map-suffixed asset directory/)
      rmSync(join(root, 'dist', name), { recursive: true })
    }
    for (const name of ['file.MAP', 'file.Map']) {
      writeFileSync(join(root, 'dist', name), 'map')
      assert.throws(() => clientInventory(root), /mixed-case map suffix/)
      rmSync(join(root, 'dist', name))
    }
  } finally { rmSync(root, {recursive: true, force: true}) }
})
