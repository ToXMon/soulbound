"use client";
import { useState } from "react";
import type { ProofResult } from "./read";
import styles from "./life.module.css";

type Memory = { id: string; epoch: number; hash: string; root: string };
export default function Verify({ memories, unavailable, requestedId }: { memories: Memory[]; unavailable: boolean; requestedId?: string }) {
  const [id, setId] = useState(requestedId ?? memories[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ProofResult & { totalMs?: number; tampered?: boolean }) | null>(null);
  const selected = memories.find(m => m.id === id);
  async function verify(tampered: boolean) {
    if (busy || !id) return;
    setBusy(true); setResult(null);
    const start = performance.now();
    try {
      const response = await fetch("/api/life/proof?id=" + encodeURIComponent(id) + "&tampered=" + Number(tampered),
        { cache: "no-store", signal: AbortSignal.timeout(1850) });
      const data = await response.json() as ProofResult;
      if (!data || !["valid", "invalid", "unavailable", "not-committed", "not-found"].includes(data.status)) throw new Error("Unavailable");
      setResult({ ...data, totalMs: Math.round(performance.now() - start), tampered });
    } catch { setResult({ status: "unavailable", message: "Verification unavailable or timed out. No verdict. Retry.", elapsedMs: 0,
      totalMs: Math.round(performance.now() - start), tampered }); }
    finally { setBusy(false); }
  }
  return <section className={styles.proof} aria-labelledby="memory-title" aria-busy={busy}>
    <div className={styles.sectionHeading}><h2 id="memory-title">A memory without the memory.</h2><span className={styles.eyebrow}>Hashes only · public</span></div>
    <p>Check that a memory commitment belongs to a root recorded on Solana. The content stays private. Inclusion does not prove the memory is true.</p>
    {requestedId && <p role="status">{selected ? `Exact conversation memory selected: ${selected.id}. Verify inclusion below; selection alone is not a chain verdict.` : "The requested conversation memory is not in this read projection. No unrelated memory has been selected and no proof verdict is available."}</p>}
    {selected ? <>
      <div className={styles.commitment}>
        <label>Sealed memory · epoch {selected.epoch}
          <select value={id} disabled={busy} onChange={e => { setId(e.target.value); setResult(null); }}>
            {memories.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        </label>
        <div><span>Local sealed root · not yet checked on-chain</span><code className={styles.hash}>{selected.root}</code></div>
      </div>
      <details className={styles.details}><summary>Show selected leaf hash</summary><code className={styles.hash}>{selected.hash}</code></details>
    </> : <p className={styles.empty}>{unavailable ? "Memory proof source unavailable. No private storage has been exposed." : "No sealed memories yet. An open epoch cannot be verified against a committed root."}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={!selected || busy} onClick={() => void verify(false)}>{busy ? "Checking committed root…" : "Verify inclusion →"}</button>
      <button type="button" className={styles.secondary} disabled={!selected || busy} onClick={() => void verify(true)}>Try a tampered copy</button>
    </div>
    <div className={result?.status === "invalid" ? styles.invalid : result?.status === "valid" ? styles.valid : styles.verdict}
      role={result?.status === "invalid" ? "alert" : "status"} aria-live={result?.status === "invalid" ? "assertive" : "polite"} aria-atomic="true">
      {busy ? "Checking a fresh confirmed on-chain root. No verdict yet." : result ? <>
        <strong>{result.message}</strong>
        {result.tampered && <span>Tampered-copy test · one proof byte changed. The stored memory is untouched.</span>}
        {result.totalMs !== undefined && <span>{result.totalMs} ms from click to result{result.totalMs >= 2000 ? " · over the 2-second demo target" : ""}</span>}
        {result.slot !== undefined && <span>Confirmed slot {result.slot}</span>}
      </> : "Not checked in this session."}
    </div>
    {result?.proof && <details className={styles.details}><summary>Inspect the public proof</summary><pre>{JSON.stringify({ root: result.root, ...result.proof }, null, 2)}</pre></details>}
  </section>;
}
