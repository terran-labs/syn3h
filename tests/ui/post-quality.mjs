import { execFileSync } from 'node:child_process'
for (const backend of ['gpu', 'gl']) {
  execFileSync(process.execPath, ['tools/post-levels-check.mjs', process.env.SYN3H_URL, `output/playwright/post-quality-${backend}`, ...(backend === 'gl' ? ['--webgl'] : [])], { stdio: 'inherit' })
}
