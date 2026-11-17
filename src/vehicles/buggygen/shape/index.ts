/** Shape handles for the generated buggy body: handles, the rig, the shaped build, parts that follow, seeds and share codes. */
export { HANDLES, defaultShape, clampShape, isDefaultShape, field, type Shape, type HandleId, type Handle } from './handles'
export { rig, applyMotion, type Rig, type Motion } from './rig'
export { FEATURE_RULES, findFeatures, type FeatureId } from './features'
export { shapedBody, shapedCage } from './body'
export { shapedParts, shapedSource } from './parts'
export { seedShape, mulberry32 } from './seed'
export { encodeShape, decodeShape, CODE_VERSION } from './code'
