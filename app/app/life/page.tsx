import Link from "next/link";
import { getLife } from "./read";
import Verify from "./verify";
import styles from "./life.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Life & proof · SOULBOUND", description: "Inspect public traits, memory inclusion proofs and economic receipts. Private memories remain private." };
const explorer = (id: string) => "https://explorer.solana.com/address/" + encodeURIComponent(id) + "?cluster=devnet";
const names: Record<string, string> = { trait_vector: "Personality vector", mood: "Mood", life_stage: "Life stage", memory_epoch: "Attribute epoch" };

export default async function LifePage() {
  const data = await getLife(), chain = data?.chain;
  const current = chain?.attributes.find(a => a.key === "trait_vector")?.value ?? null;
  const changed = current !== null && chain?.genesisVector !== null && chain?.genesisVector !== undefined ? current !== chain.genesisVector : null;
  const attributes = chain?.attributes ?? [];
  return <main className={styles.page}>
    <a className={styles.skip} href="#evidence">Skip to evidence</a>
    <header className={styles.nav}>
      <Link className={styles.brand} href="/" aria-label="SOULBOUND conversation"><svg aria-hidden="true" width="30" height="30" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M16 25V13m0 4C8 17 8 9 8 9s8-1 8 8Zm0-4c0-7 8-7 8-7s0 7-8 7Z" fill="currentColor"/></svg>SOULBOUND <span>/ Life &amp; proof</span></Link>
      <div className={styles.navActions}><Link href="/">← Back to conversation</Link><form action="/life"><button className={styles.refresh} type="submit">Refresh live reads</button></form></div>
    </header>
    {!data && <p role="status" className={styles.unavailable}>Live read service unavailable. No cached or sample values are being presented as live. You can still return to the conversation.</p>}
    <section className={styles.intro} aria-labelledby="life-title">
      <div><h1 id="life-title">A life you can inspect.</h1><p>Personality, memory commitments and the cost of each thought. Nothing taken on faith.</p></div>
      <div className={styles.stage}><span className={styles.stageBadge}>Life stage · {chain?.stage ?? "unavailable"}</span><span>Solana devnet · read-only</span>
        {chain && <span>Confirmed slot {chain.slot}</span>}
        {data && <time dateTime={data.checkedAt}>{chain ? "Checked" : "Read attempted"} at {data.checkedAt.slice(11, 19)} UTC</time>}
      </div>
    </section>
    <div id="evidence" className={styles.evidence} tabIndex={-1}>
      <Verify memories={data?.memories ?? []} unavailable={!data || data.memoriesUnavailable} />
      <section className={styles.traits} aria-labelledby="traits-title">
        <div className={styles.sectionHeading}><h2 id="traits-title">How it’s changing</h2><span className={styles.eyebrow}>On-chain · read-only</span></div>
        {attributes.length ? <>
          <div className={styles.tableScroll}><table className={styles.traitTable}><caption className={styles.srOnly}>Genesis trait vector compared with current Core Attributes</caption>
            <thead><tr><th scope="col">Attribute</th><th scope="col">At birth</th><th scope="col">Now</th></tr></thead>
            <tbody>{attributes.map(a => <tr key={a.key}>
              <th scope="row">{names[a.key] ?? a.key}</th>
              <td>{a.key === "trait_vector" ? chain?.genesisVector === "" ? "(empty vector)" : chain?.genesisVector ?? "Unavailable" : "Not in birth instruction"}</td>
              <td className={a.key === "trait_vector" && changed ? styles.changed : undefined}>{a.value}{a.key === "trait_vector" && changed !== null && <span className={styles.changeLabel}>{changed ? "Changed since birth" : "Unchanged since birth"}</span>}</td>
            </tr>)}</tbody>
          </table></div>
          {chain?.genesisVector == null && <p className={styles.note}>Genesis comparison unavailable: the birth transaction could not be retrieved and validated. Current values are not used as a substitute.</p>}
        </> : <p className={styles.empty}>Current Core Attributes unavailable. No invented personality values or trait changes are shown.</p>}
        <p className={styles.note}>Only the personality vector is supplied in the birth instruction. Other genesis values are not inferred. Values cannot be edited here.</p>
        <div className={styles.textLinks}>{chain && <a href={explorer(chain.asset)} target="_blank" rel="noreferrer">View character on explorer ↗</a>}{chain?.genesisSignature && <a href={"https://explorer.solana.com/tx/" + encodeURIComponent(chain.genesisSignature) + "?cluster=devnet"} target="_blank" rel="noreferrer">Inspect birth transaction ↗</a>}</div>
      </section>
    </div>
    <div className={styles.economics}>
      <section data-req-71 aria-labelledby="cost-title">
        <div className={styles.sectionHeading}><h2 id="cost-title">The cost of a thought</h2><span className={styles.eyebrow}>Most recent turns</span></div>
        <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Model identity and per-turn inference cost in USD</caption><thead><tr><th scope="col">Turn</th><th scope="col">Model identity</th><th scope="col">Cost / USD</th></tr></thead>
          <tbody>{data?.turns.length ? data.turns.map(t => <tr key={t.id}><td><code>{t.id}</code></td><td><code>{t.model}</code></td><td>{t.costUsd ?? "Unavailable"}</td></tr>) : <tr><td colSpan={3} className={styles.empty}>Not yet available. The runtime does not expose a per-turn model/cost log.</td></tr>}</tbody></table></div>
        <p className={styles.note}>No configured model name is presented as an observed turn. Inference usage cost and payment settlement are different measures.</p>
      </section>
      <section aria-labelledby="receipts-title">
        <div className={styles.sectionHeading}><h2 id="receipts-title">Its wallet, accounted for</h2><span className={styles.eyebrow}>Append-only receipts</span></div>
        <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Paid and unpaid wallet receipts with identical prominence</caption><thead><tr><th scope="col">Request</th><th scope="col">Settlement</th><th scope="col">Amount</th><th scope="col">Transaction</th></tr></thead>
          <tbody>{data?.receipts.length ? data.receipts.map(r => <tr key={r.id}><td><code>{r.id}</code></td><td><strong>{r.status}</strong></td><td>{r.amount ?? "Unavailable"}<span className={styles.changeLabel}>{r.network}</span></td><td>{r.transactionUrl && /^https:\/\/(?:sepolia\.)?basescan\.org\/tx\/0x[0-9a-f]{64}$/i.test(r.transactionUrl) ? <a href={r.transactionUrl} rel="noreferrer" target="_blank">View transaction ↗</a> : "Not settled"}</td></tr>) : <tr><td colSpan={4} className={styles.empty}>Not yet available. The x402 receipt writer has not shipped (ticket 010).</td></tr>}</tbody></table></div>
        <p className={styles.note}>Payment failure must never stop speech. Paid and unpaid receipts use the same layout; missing data is never labeled paid.</p>
      </section>
    </div>
    <footer className={styles.footer}><p>Public view: identifiers, hashes and proofs only.<br />No transcripts, private summaries or raw media.</p><p>Unavailable ≠ invalid<br />Local seal ≠ on-chain commitment</p>{chain && <a href={explorer(chain.history)} target="_blank" rel="noreferrer">View root history ↗</a>}</footer>
  </main>;
}
