import type { Plugin } from 'vite'
export function bootBytes(): Plugin
export function startupFiles(bundle: Record<string, unknown>, publicFile: (url: string) => number | null): Map<string, number>
export function bootSetScript(files: Map<string, number>, bytes?: string | number): string
export function fillSlot(html: string, total: number): string
export function countedTotal(html: string, fileBytes: (name: string) => number): { inlined: number; counted: number; names: string[] }
export const VEIL_FONTS: string[]
