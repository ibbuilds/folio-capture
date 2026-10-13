import { randomUUID } from 'node:crypto';
import type { Config } from './types.ts';
import { runPipeline, type RunOptions, type RunSummary } from './pipeline.ts';
import { AnalysisBridge, BRIDGE_CONTEXT_ID } from './bridge.ts';
import { Store } from './store.ts';
import { canonicalUrl, delay, errorMessage, hash, now } from './utils.ts';

type StartOptions = { source?: string; limit?: number };
type Phase = 'reviewing' | 'collecting' | 'completed' | 'needs-attention' | 'paused' | 'failed';
type RunState = {
  runId: string;
  clientId: string;
  ownerPid: number;
  fingerprint: string;
  phase: Phase;
  options: StartOptions;
  startedAt: string;
  updatedAt: string;
  captureId?: string;
  reason?: string;
  summary?: RunSummary;
};
type ActiveRun = {
  state: RunState;
  abort: AbortController;
  advance?: () => void;
  task: Promise<void>;
  lastActivity: number;
  timer: ReturnType<typeof setInterval>;
  receiptAt: number;
};
const activeRuns = new Map<string, ActiveRun>();
export type WorkflowDependencies = {
  pipeline?: typeof runPipeline;
  runOptions?: RunOptions;
  startOptions?: StartOptions;
  waitMs?: number;
  idleMs?: number;
  connectionMs?: number;
};

/** A chat initiates the run once. Collection waits at published-page boundaries for review.
 * No model calls, UI automation or automatic ChatGPT turn creation occur here. */
export class Workflow {
  readonly config: Config;
  readonly bridge: AnalysisBridge;
  readonly dependencies: WorkflowDependencies;
  constructor(config: Config, dependencies: WorkflowDependencies = {}) {
    this.dependencies = dependencies;
    this.config = { ...config, classifier: { ...config.classifier, runner: 'mcp' } };
    this.bridge = new AnalysisBridge(this.config);
  }
  private persist(state: RunState, status: 'running' | 'complete' | 'incomplete' | 'failed') {
    state.updatedAt = now();
    const store = new Store(this.config.output);
    try {
      const job = store.job('workflow', 'active', state);
      store.finish(job, status, { phase: state.phase }, state.reason, state.phase);
      const history = store.job('workflow-history', state.runId, state);
      store.finish(history, status, { phase: state.phase }, state.reason, state.phase);
    } finally {
      store.close();
    }
  }
  private own(runId: string, clientId: string) {
    const active = activeRuns.get(this.config.output);
    if (!active || active.state.runId !== runId || active.state.clientId !== clientId)
      throw new Error('This chat does not own an active run. Call start_run to resume saved work.');
    active.lastActivity = Date.now();
    if (active.lastActivity - active.receiptAt >= 1000) {
      const store = new Store(this.config.output);
      try {
        const client = store.getJob('mcp-client', clientId)!;
        store.job('mcp-client', clientId, { ...client.payload, lastSeen: now() });
        active.receiptAt = active.lastActivity;
      } finally {
        store.close();
      }
    }
    return active;
  }
  private async waitForReview(active: ActiveRun, captureId?: string) {
    active.state.phase = 'reviewing';
    active.state.captureId = captureId;
    await new Promise<void>((accept, reject) => {
      const abort = () => {
        active.advance = undefined;
        reject(active.abort.signal.reason);
      };
      active.advance = () => {
        active.abort.signal.removeEventListener('abort', abort);
        active.advance = undefined;
        active.state.phase = 'collecting';
        this.persist(active.state, 'running');
        accept();
      };
      active.abort.signal.addEventListener('abort', abort, { once: true });
      this.persist(active.state, 'running');
      if (active.abort.signal.aborted) abort();
    });
  }
  async start(contextId: string, clientId: string, options: StartOptions = {}) {
    options = { ...this.dependencies.startOptions, ...options };
    if (this.dependencies.startOptions?.limit && options.limit)
      options.limit = Math.min(this.dependencies.startOptions.limit, options.limit);
    if (
      this.dependencies.startOptions?.source &&
      options.source !== this.dependencies.startOptions.source
    )
      throw new Error('This engine is restricted to the source selected in its startup command.');
    if (contextId !== BRIDGE_CONTEXT_ID) throw new Error('Call get_context first.');
    if (!/^[a-f0-9]{64}$/.test(clientId)) throw new Error('Use clientId from get_context.');
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1))
      throw new Error('limit must be a positive integer.');
    if (
      options.source &&
      !this.config.sources.some((s) => canonicalUrl(s.url) === canonicalUrl(options.source!))
    )
      throw new Error('Source must already be configured in sources.yaml.');
    const fingerprint = hash({
      config: this.config,
      options,
      refresh: Boolean(this.dependencies.runOptions?.refresh),
      classifyOnly: Boolean(this.dependencies.runOptions?.classifyOnly),
      reassess: Boolean(this.dependencies.runOptions?.reassess),
    });
    const previous = activeRuns.get(this.config.output);
    if (previous) {
      if (previous.state.clientId !== clientId)
        throw new Error(
          'Another ChatGPT conversation owns this run. Resume there or wait for its idle pause.',
        );
      if (previous.state.fingerprint !== fingerprint)
        throw new Error('An active run cannot change its source or limits. Stop it first.');
      previous.lastActivity = Date.now();
      return this.describe(previous.state);
    }
    const store = new Store(this.config.output);
    try {
      store.assertWorkflowAccess();
      store.acquireLock();
      const client = store.getJob('mcp-client', clientId);
      if (
        !client ||
        client.payload.contextId !== contextId ||
        Date.now() - Date.parse(client.payload.issuedAt) > this.config.classifier.timeoutMs
      )
        throw new Error(
          "Pairing requires clientId from this engine's get_context. Refresh the plugin connection and call get_context again. No collection started.",
        );
      const stale = store.getJob('workflow', 'active');
      if (stale?.status === 'running') {
        const abandoned = {
          ...stale.payload,
          phase: 'paused',
          reason: 'engine_interrupted',
          updatedAt: now(),
        } as RunState;
        this.persist(abandoned, 'incomplete');
      }
      const state: RunState = {
        runId: randomUUID(),
        clientId,
        ownerPid: process.pid,
        fingerprint,
        phase: 'reviewing',
        options,
        startedAt: now(),
        updatedAt: now(),
      };
      const active: ActiveRun = {
        state,
        abort: new AbortController(),
        task: Promise.resolve(),
        lastActivity: Date.now(),
        timer: setInterval(() => {}, 60000),
        receiptAt: Date.now(),
      };
      store.job('mcp-client', clientId, {
        ...client.payload,
        runId: state.runId,
        pairedAt: now(),
        lastSeen: now(),
      });
      store.finish(client, 'complete');
      clearInterval(active.timer);
      const idleMs = this.dependencies.idleMs ?? this.config.classifier.timeoutMs;
      active.timer = setInterval(
        () => {
          if (
            Date.now() - active.lastActivity >=
            (state.phase === 'collecting' ? (this.dependencies.connectionMs ?? 60000) : idleMs)
          ) {
            state.reason = 'chat_idle';
            active.abort.abort(
              new Error('ChatGPT stopped requesting work; saved progress is paused.'),
            );
          }
        },
        Math.min(
          10000,
          Math.max(10, idleMs / 2),
          Math.max(10, (this.dependencies.connectionMs ?? 60000) / 2),
        ),
      );
      active.timer.unref();
      activeRuns.set(this.config.output, active);
      active.task = this.execute(active); // First await installs the backlog review gate synchronously.
      return this.describe(state);
    } finally {
      store.close();
    }
  }
  private async execute(active: ActiveRun) {
    const { state } = active;
    const external = this.dependencies.runOptions?.signal;
    const cancel = () => active.abort.abort(external?.reason ?? new Error('Interrupted'));
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    try {
      await this.waitForReview(active); // Drain saved reviews before collecting another page.
      const summary = await (this.dependencies.pipeline ?? runPipeline)(this.config, {
        ...this.dependencies.runOptions,
        ...state.options,
        retry: true,
        workflowId: state.runId,
        signal: active.abort.signal,
        assertClassifierActive: () => {
          if (
            activeRuns.get(this.config.output) !== active ||
            active.abort.signal.aborted ||
            Date.now() - active.lastActivity >= (this.dependencies.connectionMs ?? 60000)
          ) {
            active.state.reason = 'classifier_disconnected';
            active.abort.abort(new Error('Paired classifier disconnected; collection paused.'));
            active.abort.signal.throwIfAborted();
          }
        },
        log: this.dependencies.runOptions?.log ?? ((message) => console.error(message)),
        onCaptureReady: (captureId) => this.waitForReview(active, captureId),
      });
      state.summary = summary;
      const snapshot = await this.bridge.status();
      summary.classified = snapshot.classified;
      summary.pendingClassification =
        snapshot.counts.pending + Math.max(0, snapshot.counts.accepted - snapshot.classified);
      const exceptional =
        summary.failed +
        summary.blocked +
        summary.incomplete +
        summary.unresolved +
        summary.unsupported +
        snapshot.counts.pending +
        snapshot.counts.repair;
      state.phase = summary.interrupted
        ? 'paused'
        : exceptional || summary.queued || snapshot.exceptions.length
          ? 'needs-attention'
          : 'completed';
      state.reason ??= summary.interrupted
        ? 'interrupted'
        : state.phase === 'needs-attention'
          ? 'Recorded exceptions or collection bounds; inspect status.'
          : undefined;
      this.persist(state, state.phase === 'completed' ? 'complete' : 'incomplete');
    } catch (error) {
      state.phase = active.abort.signal.aborted ? 'paused' : 'failed';
      state.reason ??= errorMessage(error);
      this.persist(state, state.phase === 'paused' ? 'incomplete' : 'failed');
    } finally {
      external?.removeEventListener('abort', cancel);
      clearInterval(active.timer);
      if (activeRuns.get(this.config.output) === active) activeRuns.delete(this.config.output);
    }
  }
  private describe(state: RunState) {
    return {
      runId: state.runId,
      clientId: state.clientId,
      phase: state.phase,
      captureId: state.captureId,
      reason: state.reason,
      next: 'Continue get_packet with contextId, runId and clientId. Inspect every image; submit_result; repeat, including waiting responses, until done. No per-design user prompt is needed.',
    };
  }
  touch(runId?: string, clientId?: string) {
    if (activeRuns.has(this.config.output)) {
      if (!runId || !clientId)
        throw new Error("Supply this chat's runId and clientId while an automatic run is active.");
      this.own(runId, clientId);
    } else {
      const store = new Store(this.config.output);
      try {
        store.assertWorkflowAccess();
      } finally {
        store.close();
      }
    }
  }
  async next(contextId: string, runId?: string, clientId?: string) {
    if (contextId !== BRIDGE_CONTEXT_ID) throw new Error('Call get_context first.');
    if (!runId && !activeRuns.has(this.config.output)) {
      this.touch();
      return this.bridge.next(contextId);
    }
    if (!runId || !clientId) throw new Error('Supply runId and clientId from start_run.');
    const deadline = Date.now() + (this.dependencies.waitMs ?? 3000);
    for (;;) {
      const active = activeRuns.get(this.config.output);
      if (!active) {
        const store = new Store(this.config.output);
        try {
          const state = store.getJob('workflow', 'active')?.payload as RunState | undefined;
          if (state?.runId !== runId || state.clientId !== clientId)
            throw new Error('Unknown run.');
          store.assertWorkflowAccess();
          if (state.phase === 'collecting' || state.phase === 'reviewing') {
            state.phase = 'paused';
            state.reason = 'engine_interrupted';
            this.persist(state, 'incomplete');
          }
          return {
            done: true,
            ...this.describe(state),
            next:
              state.phase === 'completed'
                ? 'Local catalog exported.'
                : 'Saved progress remains resumable; inspect status for exceptions.',
          };
        } finally {
          store.close();
        }
      }
      this.own(runId, clientId);
      if (active.state.phase === 'reviewing') {
        const packet = await this.bridge.next(contextId);
        if (!('done' in packet)) return { ...packet, workflow: this.describe(active.state) };
        active.advance?.(); // bridge.next has released its writer lock before collection resumes.
      }
      if (Date.now() >= deadline)
        return {
          done: false,
          waiting: true,
          runId,
          clientId,
          phase: active.state.phase,
          next: 'Collection is in progress. Continue get_packet; do not stop or claim completion.',
        };
      await delay(50);
    }
  }
  async stop(runId: string, clientId: string) {
    if (!activeRuns.has(this.config.output)) {
      const store = new Store(this.config.output);
      try {
        const state = store.getJob('workflow', 'active')?.payload as RunState | undefined;
        if (
          state?.runId === runId &&
          state.clientId === clientId &&
          state.phase !== 'collecting' &&
          state.phase !== 'reviewing'
        )
          return {
            stopped: true,
            runId,
            progress: 'Saved captures, results and jobs are retained.',
          };
      } finally {
        store.close();
      }
    }
    const active = this.own(runId, clientId);
    active.state.reason = 'user_stopped';
    active.abort.abort(new Error('Stopped by user'));
    await active.task;
    return { stopped: true, runId, progress: 'Saved captures, results and jobs are retained.' };
  }
  async shutdown() {
    const active = activeRuns.get(this.config.output);
    if (!active) return;
    active.state.reason = 'engine_stopped';
    active.abort.abort(new Error('Local bridge stopped'));
    await active.task;
  }
}
