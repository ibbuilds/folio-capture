import type { EvidenceItem, ImageFrame, Label, PageManifest } from './types.ts';
import { idFor } from './utils.ts';

export type ReferenceSubject = {
  id: string; siteId: string; pageId: string; captureId: string; parentId: string;
  scope: 'page' | 'section'; profileId: string; viewport: 'desktop' | 'tablet' | 'mobile';
  regionId?: string; sectionId?: string; order?: number; title: string;
  frames: ImageFrame[]; evidence: EvidenceItem[]; captureIssues: string[];
};
export type QualityPass = {
  score: number; verdict: 'accept' | 'reject' | 'uncertain' | 'repair';
  evidenceIds: string[]; reasons: string[]; weaknesses: string[];
  criteria: Record<string, { score: number; evidenceIds: string[]; reason: string }>;
};
export type QualityRecord = {
  schemaVersion: 2; subjectId: string; cacheKey: string; rubricVersion: string;
  verdict: 'accepted' | 'rejected' | 'uncertain' | 'pending' | 'repair';
  assessedAt: string; experimental: true; reasons: string[];
  model: string; reasoning: string; reportedModels: string[];
  inspectedImages: string[]; assessment?: QualityPass; critique?: QualityPass;
};
export type ScopedClassification = {
  taxonomyVersion: string; promptVersion: string; cacheKey: string; model: string;
  taxonomyFingerprint?: string;
  reportedModel?: string; classifiedAt: string; labels: Label[]; inspectedImages: string[];
};
export type ReferenceRecord = {
  schemaVersion: 2; subject: ReferenceSubject; directory: string; sourceUrl: string;
  quality: QualityRecord; classification?: ScopedClassification;
  classificationHistory?: ScopedClassification[];
  qualityHistory?: QualityRecord[];
  pruned?: { at: string; paths: string[] };
};

export function referenceSubjects(manifest: PageManifest): ReferenceSubject[] {
  const siteId = idFor(new URL(manifest.requestedUrl).origin);
  const subjects: ReferenceSubject[] = [];
  for (const variant of manifest.variants) {
    const viewport = variant.profile.width <= 600 ? 'mobile' : variant.profile.width <= 1100 ? 'tablet' : 'desktop';
    const pageVariantId = idFor([manifest.captureId, 'page', variant.profile.id]);
    const common = { siteId, pageId: manifest.pageId, captureId: manifest.captureId, profileId: variant.profile.id, viewport } as const;
    // Unlocalized capture warnings cannot safely be interpreted as design weaknesses.
    const issues = variant.warnings.filter(w => !/^(Capture coverage contains gaps|Exploration limit reached)/.test(w));
    if (variant.status === 'blocked' || variant.status === 'failed') issues.push(`Capture ${variant.status}`);
    if (variant.interventions.some(i => !i.verified)) issues.push('Unverified nuisance intervention');
    let covered = 0;
    for (const range of [...variant.coverage].sort((a,b) => a.start-b.start)) {
      if (range.start > covered + 2) break;
      covered = Math.max(covered, range.end);
    }
    const frames = variant.regions.flatMap(r => r.frames);
    subjects.push({ ...common, id: pageVariantId, parentId: manifest.pageId, scope: 'page', title: variant.title,
      frames, evidence: variant.evidence, captureIssues: [...issues, ...(variant.status !== 'complete' || covered < variant.pageHeight - 2 ? ['Incomplete page coverage'] : [])] });
    for (const region of variant.regions) {
      // Cross-viewport correspondence is explicitly inferred; never transfers labels or acceptance.
      const sectionId = idFor([manifest.pageId, region.selector || [region.title, region.order]]);
      const regionCovered = variant.coverage.some(r => r.start <= region.bounds.y + 2 && r.end >= region.bounds.y + region.bounds.height - 2);
      subjects.push({ ...common, id: idFor([manifest.captureId, 'section', variant.profile.id, region.id]),
        parentId: sectionId, sectionId, scope: 'section', regionId: region.id, title: region.title, order: region.order,
        frames: region.frames, evidence: variant.evidence.filter(e => e.regionId === region.id),
        captureIssues: [...issues, ...(!regionCovered ? ['Incomplete section coverage'] : [])] });
    }
  }
  return subjects;
}

export function subjectImageId(subject: ReferenceSubject, frame: ImageFrame): string {
  return `image:${subject.id}:${frame.sha256}`;
}
