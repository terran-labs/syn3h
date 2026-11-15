// Compatibility entry point for the explicit procedural brand export.
import { execFileSync } from 'node:child_process'
execFileSync('npx', ['tsx', 'tools/brand/generate.ts', ...process.argv.slice(2)], { stdio: 'inherit' })
