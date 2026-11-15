import type { Plugin } from 'vite'
export function rapierWasmAsset(): Plugin
export function externaliseRapierWasm(code: string, loader: string): string
export function physicsEarlyFetchTag(fileNames: string[], base?: string): { tag: string; children: string; injectTo: 'head-prepend' }
