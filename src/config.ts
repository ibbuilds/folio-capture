import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { publicUrl } from './utils.ts';
import type { Config } from './types.ts';

export const DEFAULT_PROFILES = [
  { id: 'desktop-wide', width: 1920, height: 1080, dpr: 2, isMobile: false, hasTouch: false },
  { id: 'desktop', width: 1440, height: 1000, dpr: 2, isMobile: false, hasTouch: false },
  { id: 'tablet-landscape', width: 1024, height: 768, dpr: 2, isMobile: true, hasTouch: true },
  { id: 'tablet', width: 768, height: 1024, dpr: 2, isMobile: true, hasTouch: true },
  { id: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true },
  { id: 'mobile-small', width: 360, height: 800, dpr: 2, isMobile: true, hasTouch: true },
];
const positive = z.number().int().positive();
const sourceSchema = z.union([z.string(), z.object({ url: z.string(), kind: z.enum(['auto','page','library','site']).default('auto'), name: z.string().optional(), maxPages: positive.max(1000).optional(), maxDepth: z.number().int().min(0).max(10).optional(), expectedHttpStatus: z.literal(404).optional(), preserveSelectors: z.array(z.string()).optional(), dismissSelectors: z.array(z.string()).optional() }).strict()]);
const configSchema = z.object({
  output: z.string().default('./output'), freshnessDays: positive.default(730), sources: z.array(sourceSchema).min(1),
  profiles: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), width: positive.max(7680), height: positive.max(7680), dpr: z.number().min(1).max(3), isMobile: z.boolean(), hasTouch: z.boolean() }).strict()).min(1).default(DEFAULT_PROFILES),
  capture: z.object({
    navigationTimeoutMs: positive.default(45000), mediaTimeoutMs: positive.default(10000), settleTimeoutMs: positive.default(10000),
    screenshotTimeoutMs: positive.default(15000), attemptTimeoutMs: positive.default(300000), maxAttempts: positive.max(5).default(2),
    maxScrollSteps: positive.default(200), explorationTimeoutMs: positive.default(120000), contextPixels: z.number().int().min(0).max(500).default(64),
    frameOverlap: z.number().min(0.05).max(0.5).default(0.15), cleanupPasses: positive.max(5).default(3), cleanupTimeoutMs: positive.default(10000),
    preserveSelectors: z.array(z.string()).default([]), dismissSelectors: z.array(z.string()).default([]),
    thumbnails:z.boolean().default(false),
  }).strict().prefault({}),
  discovery: z.object({ navigationTimeoutMs: positive.default(45000), settleTimeoutMs: positive.default(10000), plateauChecks: positive.default(3), maxScrollSteps: positive.default(500), maxDurationMs: positive.default(1800000), minDelayMs: positive.default(1000), maxEntries: positive.optional() }).strict().prefault({}),
  quality: z.object({ maxImages: positive.max(100).default(24), quarantineDays: positive.default(30) }).strict().prefault({}),
  collection: z.object({ originalMode:z.enum(['page','site']).default('site'),maxPages:positive.max(1000).default(25),maxDepth:z.number().int().min(0).max(10).default(2),reviewBatchPages:positive.max(10).default(3) }).strict().prefault({}),
  classifier: z.object({ runner: z.enum(['mcp','codex']).default('mcp'), command: z.string().default('codex'), model: z.string().default('gpt-6.1-sol'), reasoning: z.enum(['low','medium','high','xhigh']).default('high'), timeoutMs: positive.default(900000), maxAttempts: positive.max(3).default(2), mcpReviewProfile:z.string().min(1).max(100).optional() }).strict().prefault({}),
}).strict();

export function parseConfig(raw: unknown, base = process.cwd()): Config {
  const parsed = configSchema.parse(raw);
  if (new Set(parsed.profiles.map(p => p.id)).size !== parsed.profiles.length) throw new Error('Capture profile IDs must be unique.');
  return { ...parsed, output: resolve(base, parsed.output), sources: parsed.sources.map(s => typeof s === 'string' ? { url: publicUrl(s), kind: 'auto' as const } : { ...s, url: publicUrl(s.url) }) };
}

export async function loadConfig(path = 'sources.yaml'): Promise<Config> {
  const absolute = resolve(path);
  return parseConfig(parse(await readFile(absolute, 'utf8')), dirname(absolute));
}
