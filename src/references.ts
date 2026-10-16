import type { EvidenceItem, ImageFrame, Label, PageManifest, Region, ViewportCapture } from './types.ts';
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
  reviewProfile?:string;
  inspectedImages: string[]; assessment?: QualityPass; critique?: QualityPass;
  reviewRevision?: number;
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
  classificationRevision?: number;
  pruned?: { at: string; paths: string[] };
};

/** A viewport that claims to contain the entire semantic section must contain
 * its observed DOM too. This catches stale-scroll crops without guessing style. */
export function sectionEvidenceIssues(variant:Pick<ViewportCapture,'evidence'>,region:Pick<Region,'id'|'bounds'|'referenceKind'>):string[] {
  const source=variant.evidence.find(item=>item.regionId===region.id&&item.kind==='region-dom')?.value as {text?:string}|undefined;
  if(region.referenceKind!=='section'||!source?.text?.trim())return [];
  for(const item of variant.evidence.filter(item=>item.regionId===region.id&&item.kind==='capture-state')){
    const state=item.value as {method?:string;bounds?:Region['bounds'];dom?:{scope?:string;text?:string;headings?:unknown[];media?:unknown[]}};
    if(state.method==='complete-section'||!state.bounds||!state.dom||state.dom.scope!=='visible-frame')continue;
    const a=state.bounds,b=region.bounds;
    if(a.y<=b.y+1&&a.y+a.height>=b.y+b.height-1&&a.x<=b.x+1&&a.x+a.width>=b.x+b.width-1&&
      !state.dom.text?.trim()&&!state.dom.headings?.length&&!state.dom.media?.length)
      return ['Recorded viewport evidence contains none of the complete section content; the screenshot requires recapture.'];
  }
  return [];
}

export function referenceSubjects(manifest: PageManifest): ReferenceSubject[] {
  const siteId = idFor(new URL(manifest.requestedUrl).origin);
  const subjects: ReferenceSubject[] = [];
  for (const variant of manifest.variants) {
    const viewport = variant.profile.width <= 600 ? 'mobile' : variant.profile.width <= 1100 ? 'tablet' : 'desktop';
    const pageVariantId = idFor([manifest.captureId, 'page', variant.profile.id]);
    const common = { siteId, pageId: manifest.pageId, captureId: manifest.captureId, profileId: variant.profile.id, viewport } as const;
    // Unlocalized capture warnings cannot safely be interpreted as design weaknesses.
    const coverageWarning=(message:string)=>/^(Capture coverage contains gaps|Exploration limit reached)/.test(message);
    // Old unscoped warnings remain conservative; new issues identify the affected section.
    const scoped=[...variant.issues??[],...variant.regions.flatMap(region=>sectionEvidenceIssues(variant,region).map(message=>({regionId:region.id,message})))];
    const legacy=variant.warnings.filter(w=>!coverageWarning(w)&&!scoped.some(issue=>issue.message===w));
    const globalIssues=[...legacy,...scoped.filter(issue=>!issue.regionId&&!coverageWarning(issue.message)).map(issue=>issue.message)];
    if (variant.status === 'blocked' || variant.status === 'failed') globalIssues.push(`Capture ${variant.status}`);
    if (variant.interventions.some(i => !i.verified)) globalIssues.push('Unverified nuisance intervention');
    const issues=[...new Set([...globalIssues,...scoped.filter(issue=>!coverageWarning(issue.message)).map(issue=>issue.message)])];
    let covered = 0;
    for (const range of [...variant.coverage].sort((a,b) => a.start-b.start)) {
      if (range.start > covered + 2) break;
      covered = Math.max(covered, range.end);
    }
    const frames = variant.regions.flatMap(r => r.frames);
    subjects.push({ ...common, id: pageVariantId, parentId: manifest.pageId, scope: 'page', title: variant.title,
      frames, evidence: variant.evidence, captureIssues: [...issues, ...(variant.status !== 'complete' || covered < variant.pageHeight - 2 ? ['Incomplete page coverage'] : [])] });
    for (const region of variant.regions) {
      if(region.referenceKind==='page-context')continue;
      // Cross-viewport correspondence is explicitly inferred; never transfers labels or acceptance.
      const sectionId = idFor([manifest.pageId, region.selector || [region.title, region.order]]);
      const regionCovered = variant.coverage.some(r => r.start <= region.bounds.y + 2 && r.end >= region.bounds.y + region.bounds.height - 2);
      subjects.push({ ...common, id: idFor([manifest.captureId, 'section', variant.profile.id, region.id]),
        parentId: sectionId, sectionId, scope: 'section', regionId: region.id, title: region.title, order: region.order,
        frames: region.frames, evidence: variant.evidence.filter(e => e.regionId === region.id),
        captureIssues: [...new Set([...globalIssues,...scoped.filter(issue=>issue.regionId===region.id).map(issue=>issue.message), ...(!regionCovered ? ['Incomplete section coverage'] : [])])] });
    }
  }
  return subjects;
}

export function subjectImageId(subject: ReferenceSubject, frame: ImageFrame): string {
  return `image:${subject.id}:${frame.sha256}`;
}
