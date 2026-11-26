/**
 * The share card's mark and glow, exactly as the earlier cards drew them: logoSvg's 'card'
 * layout (src/ui/brand/LogoMark.ts), the call tools/brand/generate.ts makes. Writes, into the
 * directory given, sky.svg (the mark and glow on the old card's starfield), mark.svg (the same
 * mark and glow on nothing) and box.json (the mark's box). Used by tools/lobby-captures.mjs.
 *
 *   npx tsx tools/brand/card-svg.ts <directory>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { logoBox, logoSvg } from '../../src/ui/brand/LogoMark'

const dir = process.argv[2]
if (!dir) throw new Error('usage: npx tsx tools/brand/card-svg.ts <directory>')
const width = 1200, height = 630
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/sky.svg`, logoSvg({ width, height, layout: 'card', space: true }))
writeFileSync(`${dir}/mark.svg`, logoSvg({ width, height, layout: 'card', space: false }))
writeFileSync(`${dir}/box.json`, JSON.stringify(logoBox(width, height, 'card')))
