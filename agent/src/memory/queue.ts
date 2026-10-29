// Bounded per-character post-turn queue: one job in flight, bounded capacity,
// per-job timeout, visible counters. Overflow is reported, never silent.
import type { Extractor, SourceTurn } from "./extract.js";
import type { MemoryStore } from "./store.js";

export interface MemoryJob { key: string; turns: SourceTurn[] }
export interface QueueStats { enqueued: number; completed: number; failed: number; droppedOverflow: number; pending: number; inFlight: boolean }

export class QueueFullError extends Error { constructor(cap: number) { super(`memory queue full (capacity ${cap})`); this.name = "QueueFullError"; } }

export class MemoryQueue {
  private q: MemoryJob[] = [];
  private running = false;
  private drainWaiters: (() => void)[] = [];
  private stats = { enqueued: 0, completed: 0, failed: 0, droppedOverflow: 0 };
  constructor(
    private store: MemoryStore,
    private extractor: Extractor,
    private opts: { capacity?: number; timeoutMs?: number; onError?: (e: Error, job: MemoryJob) => void } = {},
  ) {}
  get capacity() { return this.opts.capacity ?? 16; }
  get timeoutMs() { return this.opts.timeoutMs ?? 30_000; }

  /** Returns false on overflow (counted + reported via onError). Never throws into the voice path. */
  enqueue(job: MemoryJob): boolean {
    if (this.q.length + (this.running ? 1 : 0) >= this.capacity) {
      this.stats.droppedOverflow++;
      this.opts.onError?.(new QueueFullError(this.capacity), job);
      return false;
    }
    this.q.push(job);
    this.stats.enqueued++;
    void this.pump();
    return true;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.q.shift();
    if (!job) { this.notify(); return; }
    this.running = true;
    const t0 = performance.now();
    try {
      const prior = this.store.records.map((r) => ({ id: r.id, summary: r.summary, version: r.version }));
      const signal = AbortSignal.timeout(this.timeoutMs);
      const items = await this.extractor.extract(job.turns, prior, signal);
      await this.store.appendExtracted(job.key, items);
      this.stats.completed++;
      console.log(`[memory] job done key=${job.key} memories=${items.length} ms=${Math.round(performance.now() - t0)}`);
    } catch (e) {
      this.stats.failed++;
      console.log(`[memory] job FAILED key=${job.key} error=${(e as Error).message} ms=${Math.round(performance.now() - t0)}`);
      this.opts.onError?.(e as Error, job);
    } finally {
      this.running = false;
      void this.pump();
      this.notify();
    }
  }
  private notify() { if (!this.running && this.q.length === 0) { const w = this.drainWaiters.splice(0); w.forEach((f) => f()); } }

  /** Explicit flush (tests/demo) and bounded shutdown drain. Returns true if fully drained. */
  async flush(timeoutMs = 30_000): Promise<boolean> {
    if (!this.running && this.q.length === 0) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.drainWaiters.push(() => { clearTimeout(timer); resolve(true); });
      this.notify();
    });
  }
  getStats(): QueueStats { return { ...this.stats, pending: this.q.length, inFlight: this.running }; }
}

/** Publish first, enqueue second, never await extraction (voice-path contract). */
export async function publishThenEnqueue<T>(publish: () => Promise<T>, queue: MemoryQueue, job: MemoryJob): Promise<T> {
  const out = await publish();
  queue.enqueue(job);
  return out;
}
