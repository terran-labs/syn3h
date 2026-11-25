import type { Plugin } from 'vite'
export interface FeedChange { title: string; commit: string }
export interface FeedBeta { version: string; date: string; summary: string; digest: string; url: string; changes?: FeedChange[] }
export interface FeedRelease { version: string; date: string; summary: string; digest: string; url: string; channel?: 'production' | 'beta'; betas?: FeedBeta[]; changes?: FeedChange[] }
export declare const FEED_FILE: string
export declare const SUMMARY_MAX: number
export declare function notesSummary(text: string): string
export declare function parseDigest(text: string): { summary: string; digest: string; problems: string[] }
export declare function productionDates(tsv: string): Map<string, string>
export declare function requireDigest(version: string, repo?: string): void
export declare function readBetas(tsv: string): { version: string; commit: string; date: string }[]
export declare function buildFeed(repo?: string, limit?: number, building?: string, now?: Date): { build?: string; releases: FeedRelease[] }
export declare function pacificStamp(when: Date): string
export declare function releaseFeed(): Plugin
