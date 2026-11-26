import type { Plugin } from 'vite'
export declare const CARD: { width: number; height: number }
export declare const TAGLINE_SIZE: number
export declare const TAGLINE: string
export declare const SOURCE_NAME: string
export declare function pointAtCard(html: string, name: string): string
export declare function encodePng(rgba: Uint8Array, width: number, height: number): Buffer
export declare function renderShareCard(options?: { size?: number }): Promise<{ png: Buffer; name: string; glowEnd: number; baseline: number; width: number }>
export declare function shareCardAsset(): Plugin
