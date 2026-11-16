import type * as THREE from 'three/webgpu'

/**
 * Compile something before it is first drawn, a slice per frame, instead of in the frame
 * that first meets it (see Game.compileAhead). Modules without a Game (warm-ups in the
 * vehicle and gear code, which also run in labs) reach the running game's compiler here.
 * Returns null when no game has registered one: the caller then warms by drawing, as before.
 */
let compiler: ((object: THREE.Object3D) => Promise<void>) | null = null
export function setCompiler(next: ((object: THREE.Object3D) => Promise<void>) | null): void { compiler = next }
export function compileAhead(object: THREE.Object3D): Promise<void> | null { return compiler ? compiler(object) : null }
