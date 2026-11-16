// Pure command construction only. This is not an executor or an acceptance gate.
import { posix as path } from 'node:path'

function exact(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error(`Unsupported ${label} fields`)
}
function absolute(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' ||
      /[\x00-\x1f\x7f]/.test(value) || path.normalize(value) !== value) throw new Error('Expected normalized absolute path')
  return value
}
function inside(parent, child) { return child.startsWith(parent + '/') }
function separate(a, b) { return a !== b && !inside(a,b) && !inside(b,a) }
function digest(value) { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Missing reviewed digest') }

/**
 * Trusted paths and digests must come from independent inspection, never evidence.
 * Lexical paths cannot prove absence of symlinks or native dependencies. A future
 * executor must recheck those and byte manifests before using any returned plan.
 * Credentials are deliberately absent: only required secret names are returned.
 */
export function planFinalWorkerCommand(request, trusted) {
  exact(trusted, ['artifactRoot','toolRoot','runnerRoot','artifactSha256','toolSha256','accountId'], 'trusted input')
  const artifact = absolute(trusted.artifactRoot), tool = absolute(trusted.toolRoot), runner = absolute(trusted.runnerRoot)
  if (!separate(artifact, tool) || !separate(artifact, runner) || !separate(tool, runner)) throw new Error('Artifact, tool and runner roots must be separate')
  digest(trusted.artifactSha256); digest(trusted.toolSha256)
  if (typeof trusted.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(trusted.accountId)) throw new Error('Invalid reviewed account target')
  const mode = request?.mode
  const fields = mode === 'local' ? ['mode','port'] : mode === 'dry' ? ['mode'] : mode === 'upload' ? ['mode','release','message','immediate'] : []
  if (!fields.length) throw new Error('Unsupported operation')
  exact(request, fields, 'request')
  const executable = `${tool}/runtime/bin/node`
  const cli = `${tool}/node_modules/wrangler/wrangler-dist/cli.js`
  const envFile = `${runner}/empty.env`
  const project = `${runner}/project`
  const args = [cli, mode === 'local' ? 'dev' : 'deploy', '--config', `${project}/wrangler.json`, '--no-bundle', '--env-file', envFile]
  const env = {
    HOME: `${runner}/home`, XDG_CONFIG_HOME: `${runner}/config`, XDG_CACHE_HOME: `${runner}/cache`,
    TMPDIR: `${runner}/tmp`, PATH: `${tool}/runtime/bin`, CI: 'true', WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  }
  const requiredSecrets = []
  if (mode === 'local') {
    if (!Number.isInteger(request.port) || request.port < 1024 || request.port > 65535) throw new Error('Invalid allocated port')
    args.push('--local','--ip','127.0.0.1','--port',String(request.port),'--persist-to',`${runner}/state`)
  } else if (mode === 'dry') args.push('--dry-run','--outdir',`${runner}/dry-output`)
  else {
    if (!Number.isSafeInteger(request.release) || request.release < 1 || typeof request.immediate !== 'boolean' ||
        typeof request.message !== 'string' || !request.message.trim() || request.message.length > 512 || /[\x00-\x1f\x7f]/.test(request.message)) throw new Error('Invalid release metadata')
    args.push('--tag', `release-${request.release}`, '--message', request.message)
    if (request.immediate) args.push('--durable-objects-code-update-mode','immediate')
    env.CLOUDFLARE_ACCOUNT_ID = trusted.accountId
    requiredSecrets.push('CLOUDFLARE_API_TOKEN')
  }
  return {
    executable, args, cwd: project, sourceArtifactRoot: artifact, env, requiredSecrets,
    artifactSha256: trusted.artifactSha256, toolSha256: trusted.toolSha256,
    emptyEnvFile: envFile, qualified: false, launchAllowed: false,
    blockers: ['Verify artifact and complete tool manifests, links and native dependencies',
      'Verify fresh nonsymlink runner directories and empty regular env file',
      'Verify complete independent copy inventory including provenance, excluded files, directories and modes',
      'Recheck original and copy inventories; permit only reviewed scratch additions',
      'Complete mode-specific allocation and acceptance gates'],
  }
}
