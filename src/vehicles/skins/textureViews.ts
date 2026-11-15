import * as T from 'three/webgpu'

/** The part of TextureLoader this needs, so a test can stand in for the network. */
export interface ImageTextureLoader { load(url: string, onLoad?: (texture: T.Texture) => void): T.Texture }

/**
 * Load one image and return `count` textures showing it, so each can have its own repeat,
 * offset or wrapping.
 *
 * Do not get the extra ones with `texture.clone()` on a texture that is still loading:
 * `Texture.copy` marks the clone for upload at once, while its image is still null, and the
 * renderer then throws on the first frame drawn before the image arrives ("Cannot read
 * properties of null (reading 'complete')"). Whether that happens is a race with the network.
 * The views made here stay unmarked until the image is in, then share its source, so the
 * image is uploaded once.
 */
export function loadTextureViews(url: string, count: number, loader: ImageTextureLoader = new T.TextureLoader()): T.Texture[] {
  const views = Array.from({ length: Math.max(0, count - 1) }, () => new T.Texture())
  const base = loader.load(url, loaded => {
    for (const view of views) { view.source = loaded.source; view.needsUpdate = true }
  })
  return [base, ...views]
}
