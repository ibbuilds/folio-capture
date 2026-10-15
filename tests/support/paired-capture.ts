import type { Config } from '../../src/types.ts';
import type { RunOptions, RunSummary } from '../../src/pipeline.ts';
import { Workflow } from '../../src/workflow.ts';
import { AnalysisBridge } from '../../src/bridge.ts';
import { CRITERIA } from '../../src/quality.ts';
import { TAXONOMY } from '../../src/taxonomy.ts';
import { Store } from '../../src/store.ts';

/** Deterministic classifier client for browser contract fixtures. It performs the real pairing,
 * image-delivery and validated response protocol. Never use its judgments as aesthetic evidence. */
export async function runPairedFixture(
  config: Config,
  options: RunOptions = {},
  fixture:{qualify?:boolean}={},
): Promise<RunSummary> {
  const bridge = new AnalysisBridge(config),
    context = bridge.context();
  const workflow = new Workflow(config, { runOptions: options, waitMs: 100, idleMs: 120000 });
  const started = await workflow.start(context.contextId, context.clientId, {
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.source ? { source: options.source } : {}),
  });
  try {
    for (;;) {
      const next = await workflow.next(context.contextId, started.runId, started.clientId);
      if ('done' in next) {
        if (!next.done) continue;
        break;
      }
      const packet = next.packet;
      let offset = next.nextOffset,
        remaining = next.remaining;
      while (remaining) {
        const chunk = await bridge.images(packet.id, offset, 4,started.clientId);
        offset = chunk.nextOffset;
        remaining = chunk.remaining;
        workflow.touch(started.runId, started.clientId);
      }
      const id = packet.images[0].id;
      const value =
        packet.phase === 'classification'
          ? {
              labels: Object.keys(TAXONOMY)
                .filter((axis) =>
                  packet.scope === 'page'
                    ? axis !== 'section_purpose'
                    : !['experience', 'page_purpose', 'industry', 'audience'].includes(axis),
                )
                .map((axis) => ({
                  axis,
                  label: fixture.qualify&&axis==='visual_style'?'minimalism':fixture.qualify&&axis==='appearance'?'clean':'unknown',
                  evidenceIds: fixture.qualify&&['visual_style','appearance'].includes(axis)?[id]:[],
                  confidence: fixture.qualify&&['visual_style','appearance'].includes(axis)?'high':'low',
                  note: 'Synthetic fixture only',
                  ...(fixture.qualify&&axis==='visual_style'?{role:'primary'}:{}),
                })),
            }
          : {
              score: fixture.qualify?9:6,
              verdict: fixture.qualify?'accept':'reject',
              evidenceIds: [id],
              reasons: ['Synthetic contract classifier; no aesthetic evaluation'],
              weaknesses: fixture.qualify?[]:['Fixture is not an editorial reference'],
              criteria: Object.fromEntries(
                CRITERIA.map((criterion) => [
                  criterion,
                  { score: fixture.qualify?9:6, evidenceIds: [id], reason: 'Deterministic test response' },
                ]),
              ),
            };
      if(packet.phase==='classification'&&fixture.qualify)await bridge.concepts(started.clientId,[{axis:'visual_style',label:'minimalism'},{axis:'appearance',label:'clean'}]);
      await bridge.submit(packet.id, value, undefined, started.clientId);
    }
    const store = new Store(config.output);
    try {
      const summary = store.getJob('workflow', 'active')?.payload.summary as RunSummary | undefined;
      if (!summary)
        throw new Error(
          store.getJob('workflow', 'active')?.payload.reason ??
            'Fixture workflow produced no summary',
        );
      return summary;
    } finally {
      store.close();
    }
  } finally {
    await workflow.shutdown();
  }
}
