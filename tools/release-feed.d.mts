import type { Plugin } from 'vite'
export declare const FEED_FILE: string
export declare function parseNotes(text: string): { summary: string; notes: string }
export declare function productionDates(tsv: string): Map<string, string>
export declare function buildFeed(repo?: string, limit?: number): { releases: { version: string; date: string; summary: string; notes: string }[] }
export declare function releaseFeed(): Plugin
