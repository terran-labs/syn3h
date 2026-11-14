import { mergeConfig } from 'vite'
import base from '../../vite.config'
// Concurrent worktrees share node_modules, so their optimizer caches must not collide.
export default mergeConfig(base, {cacheDir: '/tmp/syn3h-vehicles2-vite'})
