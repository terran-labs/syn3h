import { mergeConfig } from 'vite'
import base from '../../vite.config'
// Concurrent worktrees share node_modules, so their optimizer caches must not collide.
process.env.SYN3H_NO_ROOM_SERVER = '1'
export default mergeConfig(base, {cacheDir: '/tmp/syn3h-vehicles2-vite'})
