import { mergeConfig } from 'vite'
import base from '../../vite.config'
// Concurrent worktrees share node_modules, so their optimizer caches must not collide.
process.env.SYN3H_NO_ROOM_SERVER = '1'
export default mergeConfig(base, {cacheDir: '/tmp/syn3h-vehicles2-vite',server:{proxy:{'/ws':{target:`ws://127.0.0.1:${process.env.SYN3H_ROOM_PORT ?? '8787'}`,ws:true}}}})
