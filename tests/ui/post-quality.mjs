import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { execFileSync } from 'node:child_process'
for (const backend of ['gpu', 'gl']) {
  execFileSync(process.execPath, ['tools/post-levels-check.mjs', process.env.MIRA_URL, `output/playwright/post-quality-${backend}`, ...(backend === 'gl' ? ['--webgl'] : [])], { stdio: 'inherit' })
}
