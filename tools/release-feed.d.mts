import type { Plugin } from 'vite'
export interface FeedRelease { version: string; date: string; summary: string; digest: string; url: string }
export declare const FEED_FILE: string
export declare const SUMMARY_MAX: number
export declare function notesSummary(text: string): string
export declare function parseDigest(text: string): { summary: string; digest: string; problems: string[] }
export declare function productionDates(tsv: string): Map<string, string>
export declare function requireDigest(version: string, repo?: string): void
export declare function buildFeed(repo?: string, limit?: number, building?: string, now?: Date): { releases: FeedRelease[] }
export declare function pacificStamp(when: Date): string
export declare function releaseFeed(): Plugin
