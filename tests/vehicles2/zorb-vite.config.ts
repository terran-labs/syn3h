import { mergeConfig } from 'vite'
import lane from './vite.config'
// The lane config shares one optimizer cache; zorb captures use their own so they cannot
// collide with another worktree serving the lane config at the same time.
export default mergeConfig(lane, { cacheDir: '/tmp/syn3h-zorb/vite-cache' })
