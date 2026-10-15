import type { Browser } from 'playwright';

export type CaptureStatus = 'complete' | 'incomplete' | 'blocked' | 'failed';
export type JobStatus = 'pending' | 'running' | 'complete' | 'incomplete' | 'blocked' | 'failed' | 'unsupported';
export type Rect = { x: number; y: number; width: number; height: number };
export type CaptureProfile = { id: string; width: number; height: number; dpr: number; isMobile: boolean; hasTouch: boolean };
export type Source = { url: string; kind: 'auto' | 'page' | 'library' | 'site'; name?: string; maxPages?: number; maxDepth?: number; expectedHttpStatus?:404; preserveSelectors?: string[]; dismissSelectors?: string[] };
export type CaptureSettings = {
  navigationTimeoutMs: number; mediaTimeoutMs: number; settleTimeoutMs: number;
  screenshotTimeoutMs: number; attemptTimeoutMs: number; maxAttempts: number;
  maxScrollSteps: number; explorationTimeoutMs: number; contextPixels: number;
  frameOverlap: number; cleanupPasses: number; cleanupTimeoutMs: number;
  preserveSelectors: string[]; dismissSelectors: string[];
};
export type DiscoverySettings = {
  navigationTimeoutMs: number; settleTimeoutMs: number; plateauChecks: number;
  maxScrollSteps: number; maxDurationMs: number; minDelayMs: number; maxEntries?: number;
};
export type ClassifierSettings = { runner: 'mcp' | 'codex'; command: string; model?: string; reasoning?: 'low' | 'medium' | 'high' | 'xhigh'; timeoutMs: number; maxAttempts: number; mcpReviewProfile?:string };
export type Config = {
  output: string; freshnessDays: number; sources: Source[]; profiles: CaptureProfile[];
  capture: CaptureSettings; discovery: DiscoverySettings; classifier: ClassifierSettings;
  quality?: { maxImages: number; quarantineDays: number };
  collection?: { originalMode: 'page' | 'site'; maxPages: number; maxDepth: number; reviewBatchPages?: number };
};
export type Intervention = { at: string; frameUrl: string; action: string; target: string; method: string; verified: boolean; note?: string };
export type EvidenceItem = { id: string; regionId?: string; kind: string; value: unknown };
export type CaptureIssue = { message: string; regionId?: string };
export type ImageFrame = {
  path: string; thumbnail: string; width: number; height: number; sha256: string;
  bounds: Rect; scrollY: number; kind: 'static' | 'scroll-state' | 'viewport-fallback';
};
export type Region = {
  id: string; order: number; title: string; selector?: string; roleHint?: string;
  bounds: Rect; captureBounds: Rect; method: 'semantic' | 'inferred' | 'viewport-fallback';
  boundaryConfidence: 'high' | 'medium' | 'low'; frames: ImageFrame[]; evidenceIds: string[];
  referenceKind?: 'section' | 'page-context';
};
export type ViewportCapture = {
  profile: CaptureProfile; status: CaptureStatus; requestedUrl: string; finalUrl: string;
  title: string; capturedAt: string; pageHeight: number; regions: Region[];
  evidence: EvidenceItem[]; warnings: string[]; issues?: CaptureIssue[]; interventions: Intervention[];
  coverage: Array<{ start: number; end: number }>; stoppingReason: string;
  environment: Record<string, unknown>; overview?: string;
};
export type CaptureOptions = {
  browser: Browser; url: string; profile: CaptureProfile; settings: CaptureSettings;
  outputDir: string; onProgress?: (message: string) => void; signal?: AbortSignal;
  onNavigation?:(finalUrl:string)=>Promise<void>;
  expectedHttpStatus?:404;
};
export type Provenance = { seedUrl: string; listingUrl?: string; detailUrl?: string; discoveredAt: string; sourceLabels: string[]; previewUrl?: string; resolutionPath?: string[]; navigationPath?: string[]; expectedHttpStatus?:404 };
export type PageManifest = {
  schemaVersion: 1; pageId: string; captureId: string; captureSignature: string;
  requestedUrl: string; title: string; capturedAt: string; status: CaptureStatus;
  reviewStatus: 'unreviewed' | 'needs-review' | 'approved'; provenance: Provenance[];
  variants: ViewportCapture[];
};
export type DiscoveredEntry = { id: string; seedUrl: string; listingUrl: string; detailUrl: string; title: string; discoveredAt: string; originalUrl?: string; previewUrl?: string; sourceLabels?: string[] };
export type DiscoveryEvent =
  | { type: 'entry'; entry: DiscoveredEntry }
  | { type: 'end'; reason: 'explicit_end' | 'observed_plateau' | 'incomplete'; error?: string; collections: string[]; discovered: number; interventions?: Intervention[]; warnings?: string[] };
export type ResolvedReference = { originalUrl: string; title: string; sourceLabels: string[]; previewUrl?: string; metadata: Record<string, unknown> };
export type DiscoveryOptions = { browser: Browser; seed: Source; settings: DiscoverySettings; cleanupSettings?: CaptureSettings; onProgress?: (message: string) => void; signal?: AbortSignal };
export type TaxonomyAxis = 'experience' | 'page_purpose' | 'section_purpose' | 'composition' | 'visual_style' | 'appearance' | 'typography' | 'color_palette' | 'density' | 'imagery' | 'surface_treatment' | 'industry' | 'audience' | 'interaction_pattern' | 'aesthetic_substyle' | 'cross_collection' | 'visual_anchor' | 'experience_mode' | 'platform_provenance' | 'contextual_influence' | 'behavior';
export type Label = {
  axis: TaxonomyAxis; label: string; regionId: string | null; evidenceIds: string[];
  provenance: 'source' | 'measured' | 'heuristic' | 'model' | 'human';
  confidence: 'high' | 'medium' | 'low'; note: string;
  conceptId?: string; role?: 'primary' | 'secondary';
};
export type Classification = {
  schemaVersion: 1; taxonomyVersion: string; promptVersion: string; captureId: string;
  status: 'heuristic' | 'enriched' | 'pending' | 'needs-review'; runner: string;
  model: string; createdAt: string; cacheKey: string; labels: Label[];
  sourceLabels: Array<{ label: string; evidenceId: string }>; observedFlows: unknown[];
  warnings: string[];
};
