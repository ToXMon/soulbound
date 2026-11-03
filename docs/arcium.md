# Arcium private-memory feasibility (Ticket 014 — Day-0 spike + P0 probe)

- **Date:** 2026-10-31 (session 1: read-only spike, observations timestamped below; session 2: executed P0 probe, scratch `/tmp/014-p0-probe.WafT9I`)
- **POC:** Tolu
- **Author:** pi (doer). Session 1 was read-only: no code written, deployed, or transacted; the only project file created was this document. Session 2 wrote and executed probe circuits **outside the repo** (scratch dir, disposable container); repo changes remain docs-only. No real memory data was read; all circuits used synthetic inputs.
- **Status:** feasibility report for AdaL review — **not** acceptance evidence.
- **Update 2026-10-31 (session 2, probe executed):** the P0 probe ran in a disposable container (scratch `/tmp/014-p0-probe.WafT9I`). **B2 is RESOLVED by executed circuit evidence: Arcis `SHA3_256` implements NIST SHA3-256 padding, NOT Keccak-256** — the native in-circuit hasher cannot authenticate our committed Keccak-256 roots (§8 B2). Circuit costs measured from compiler artifacts: 256-byte encrypted record hash = 2.53B ACU unpacked / 1.23B ACU with `Pack<T>`; depth-16 sorted-pair Merkle fold = 12.7B ACU (§4a). Ciphertext wire expansion measured: 32 B per plaintext byte unpacked (a 64-B input = 64 ciphertexts); `Pack<[u8;256]>` = 10 ciphertexts (~26×, B7 §8). Localnet MPC execution not achieved on this host (AVX/surfpool toolchain wall, §8 B5); the CU-amount/ACU mapping and absolute fee remain unverified.

---

## TL;DR

GO (conditional) — revised after AdaL review and the executed session-2 probe (2026-10-31). The Arcium program is executable on Solana devnet **and** mainnet-beta, the documented devnet cluster `456` and mainnet cluster `2026` exist on-chain, and devnet hosts **1,402 MXE accounts** — existence/usage indicators only; **service reliability and live privacy remain unestablished** (no MPC or live-network execution by us). **Resolved by the probe (negative): hash compatibility** — Arcis's in-circuit `SHA3_256` is NIST SHA3-256, not the Keccak-256 our commitments use, so the native hasher cannot authenticate our roots and the §5 binding design is blocked pending a hash-strategy decision (§8 B2). **Measured (compiler artifacts / generated client types):** ACU circuit weights (§4a) and ciphertext wire expansion (§8 B7). **Still unverified:** the ACU→priced-CU mapping, the `cu_price` unit, the absolute fee, assembled-transaction size, and localnet/MPC reliability (§8 B5). **No per-computation cost estimate is given** — absent the unit mapping, ACU×`cu_price` arithmetic is not a valid estimate. The §5 design (exact-length hashing, sorted-pair fold, predicate bound to authenticated bytes, tri-state output) remains a *design*, not a demonstrated result. Issues requiring decisions before the full ticket executes: **(B1)** `arcium-anchor 0.16.0` pins `anchor-lang =1.0.2` exactly, conflicting with our deployed program's `=1.2.1` → build a companion MXE crate instead of modifying `programs/soulbound` (a ticket file-scope deviation only Tolu/AdaL can approve); **(B2, resolved negative)** hash strategy must be chosen (dual-commitment, protocol migration, or hand-rolled Keccak — §8 B2); **(B3)** GPL licensing on the TS client and `arcis` crate needs a conscious Tolu decision. Post-review additions: **(B6)** binding the predicate to the exact committed canonical bytes inside a fixed-shape circuit is an open design problem (§5); **(B7)** wire expansion measured; assembled-tx feasibility still unverified (§8 B7).

---

## 1. Primary sources used

| Source | Used for |
|---|---|
| https://docs.arcium.com/llms.txt | doc map; "live on Solana mainnet" claim; SDK package names |
| https://docs.arcium.com/developers/installation.md | toolchain prerequisites, arcup, supported platforms |
| https://docs.arcium.com/developers/deployment.md | cluster offsets, deploy cost estimate, MXE init prerequisites |
| https://docs.arcium.com/developers/core-concepts.md | offsets, comp-def/account model |
| https://docs.arcium.com/developers/computation-lifecycle.md | queue → MPC → verify → callback flow |
| https://docs.arcium.com/developers/encryption.md | X25519 + Rescue cipher, `Enc<Shared>`/`Enc<Mxe>`, sealing |
| https://docs.arcium.com/developers/arcis/input-output.md | who-sees-plaintext table, reveal/from_arcis rules |
| https://docs.arcium.com/developers/arcis/primitives.md | in-circuit SHA3-256/512, Ed25519, `cluster_sign` |
| https://docs.arcium.com/developers/program.md | `queue_computation`, `#[arcium_callback]`, `verify_output`, account sets |
| https://docs.arcium.com/developers/program/callback-accs.md | custom callback accounts (result storage) |
| https://docs.arcium.com/computations/pricing-and-incentives.md | fee formula |
| https://docs.arcium.com/developers/limitations.md | tx-size limit, Arcis language constraints |
| https://docs.arcium.com/developers/versioning.md + release-notes.md | v0.16.0 current (2026-10-23), compat policy, reader fee getters |
| https://docs.arcium.com/developers/js-client-library.md | client/reader/staking SDKs, `getComputationFee`, rent reclaim |
| npm registry `@arcium-hq/client@0.16.0` (package.json, `src/idl/arcium.json`, `src/pda.ts`, `src/constants.ts`, via unpkg, read-only) | program IDs, PDA seeds, Cluster IDL layout, GPL-3.0-only license |
| crates.io API (`arcium-anchor`, `arcium-client`, `arcium-macros`, `arcis`) | versions, exact anchor-lang pin, license metadata |
| docs.rs `arcis 0.16.0` | GPL-3.0-or-later license, SHA3_256 API surface |
| api.github.com/orgs/arcium-hq/repos | source-availability check |
| **Official agent skill** `arcium-hq/agent-skills` → `skills/arcium` (SKILL.md v2.2, MIT; targets v0.11.x — behind current v0.16.0; inspected read-only 2026-10-31, copy in scratch `arcium-skill/`) | ciphertext size formula (`32 B × scalar count`), Pack ~26× guidance, 1232-B output limit remedies, MPC cost model (comparisons expensive, both if/else branches execute), `cu_price_micro` queue arg naming; **silent on:** SHA3 padding, ACU→CU mapping, `cu_price` unit, AVX/platform constraints |
| Solana public RPCs (`getAccountInfo`, `getProgramAccounts`) | all on-chain observations |

## 2. Commands actually executed (sanitized) and observations

Everything below was run from this machine on 2026-10-31. "DOCS" = documentation claim; "OBSERVED" = read directly by the doer from public RPC / registry / docs responses on that date. These are preserved as **doer observations**, not independently re-verified evidence; AdaL's review is what downgrades or endorses them.

1. `curl docs.arcium.com/{llms.txt,<pages>.md}` — fetched the pages in §1. DOCS.
2. `curl registry.npmjs.org/@arcium-hq%2fclient` → **OBSERVED:** `latest = 0.16.0`, `license = GPL-3.0-only`. `@arcium-hq/reader@0.16.0` exists. There is no `@arcium-hq/arcium-cli` package (CLI ships via `arcup`, not npm).
3. `curl crates.io/api/v1/crates/arcium-anchor(/0.16.0/dependencies)` → **OBSERVED:** newest `0.16.0` (updated 2026-10-23); dependencies pin `anchor-lang =1.0.2` **exactly** (and all `anchor-*` sub-crates `=1.0.2`); also `arcium-client =0.16.0`, `arcium-macros =0.16.0`, `solana-alt-bn128-bls ^0.1.0` (BLS on alt_bn128 — used for cluster signature verification). `arcium-anchor`, `arcium-client`, `arcium-macros` publish with **no license metadata** on crates.io; docs.rs shows `arcis 0.16.0` = **GPL-3.0-or-later**.
4. `curl unpkg.com/@arcium-hq/client@0.16.0/src/idl/arcium.json` → **OBSERVED:** Arcium program address `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` (IDL `metadata.version` 0.16.0); staking program `ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq`. Cluster account layout contains `cluster_size: u16`, `cu_price: u64`, `nodes: Vec<NodeRef>`, `bls_public_key`, etc.
5. `curl -X POST https://api.devnet.solana.com` / `api.mainnet-beta.solana.com` `getAccountInfo(Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ)` → **OBSERVED 16:47 UTC:** executable on **both** networks (owner `BPFLoaderUpgradeab1e…`, programdata accounts present).
6. Derived cluster PDAs with a dependency-free Node script reimplementing `findProgramAddress` (SHA-256 + ed25519 off-curve check; derivation matches the SDK's own `pda.ts`, which uses `PublicKey.findProgramAddressSync`): seeds `[b"Cluster", u32_le(offset)]` →
   - devnet cluster 456 → `DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95` (bump 255)
   - mainnet cluster 2026 → `6CR3Mop3B9iSWGwBFdyaJXt3egFueX6DzhtyvVMqEd1D` (bump 253)
   - singletons: FeePool `G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC`, ClockAccount `7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot`.
7. `getAccountInfo` on both cluster PDAs, borsh-parsed against the shipped IDL — **OBSERVED 2026-10-31T16:52:45Z:**
   - **devnet 456:** account exists, owner = Arcium program, discriminator matches; `cluster_size = 2`, `nodes_len = 2`, `activation_epoch = 0`, `deactivation_epoch = u64::MAX` (active, no deactivation scheduled), **`cu_price = 1`**, `last_updated_epoch = 578`, `max_capacity = 0` (semantics not documented).
   - **mainnet-beta 2026:** same shape; `cluster_size = 3`, `nodes_len = 3`, **`cu_price = 1`**, `last_updated_epoch = 549`.
   - The accounts existing at the derived addresses with the right owner+discriminator empirically confirms the PDA derivation.
8. `getProgramAccounts` (devnet, memcmp on MXEAccount discriminator, zero-length dataSlice) → **OBSERVED:** **1,402 MXE accounts** exist on devnet — an existence/usage indicator only, not a reliability demonstration.
9. `curl api.github.com/orgs/arcium-hq/repos` → **OBSERVED:** public repos are forks/libraries/examples/`setup-arcium`/`arcium-checksums`; the core on-chain Arcium program source is **not** publicly listed → the on-chain verifier is effectively a closed binary we must trust.

No installs, no script execution from the network, no transactions, no wallet use. Fetching the `arcup` installer (`install.arcium.com`) was **not** executed (kickoff rule); docs-only.

## 3. Networks, clusters, versions, program addresses (consolidated)

| Item | Value | Claim vs observed |
|---|---|---|
| Networks | Solana devnet + mainnet-beta ("live on mainnet") | mainnet claim DOCS; devnet+mainnet program executability OBSERVED |
| Devnet cluster offset | `456` | DOCS; account exists OBSERVED |
| Mainnet cluster offset | `2026` | DOCS; account exists OBSERVED |
| Arcium program | `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ` | OBSERVED executable both nets |
| Staking program | `ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq` | OBSERVED in shipped staking IDL (account not separately fetched) |
| Coordinated release | **v0.16.0** (2026-10-23): CLI, Rust crates, TS packages, arx-node image | OBSERVED (npm + crates.io + release notes) |
| Rust crates | `arcium-anchor/arcium-client/arcium-macros/arcis` all `=0.16.0`; `arcium-anchor` pins `anchor-lang =1.0.2` | OBSERVED |
| TS SDKs | `@arcium-hq/client`, `@arcium-hq/reader`, `@arcium-hq/staking` `0.16.0` | OBSERVED |
| Toolchain | `arcup` version manager (prebuilt: x86_64 Linux, aarch64 macOS; **no Windows**); prereqs: Rust, **Solana CLI 3.1.10**, Yarn, **Anchor 1.0.2**, Docker + Compose | DOCS |
| Local dev | `arcium test` spins a local cluster (legacy validator default; Surfpool preview); `arcium localnet --skip-keygen` reuses cached MXE keys | DOCS |

**MXE setup prerequisites (DOCS, deployment.md):** program built with `arcium build`; keypair with ~2–5 SOL; reliable RPC (docs warn default public RPCs drop deploy transactions — Helius/Triton/QuickNode recommended); **the deploying program must retain its upgrade authority** (immutable programs can never init an MXE); `--recovery-set-size` ≥ 4 (CLI enforces per cluster); then one-time computation-definition init (circuit on-chain or off-chain URL + `circuit_hash!`); `Arcium.toml [clusters.devnet] offset = 456`.

## 4a. Measured circuit costs (session 2 probe, compiler artifacts — ACU unit as printed by the Arcis compiler)

Compiled and executed in a disposable linux/amd64 container (arcium 0.16.0; synthetic inputs only). ACU→CU-amount mapping and absolute fees remain **unverified** (no comp-def init ran — localnet blocked, §8 B5).

| Circuit | Input shape | Weight (ACU) |
|---|---|---|
| `hash_probe` | plaintext `[u8;64]` | 35,328 |
| `hash_probe_enc` | `Enc<Shared,[u8;64]>` (64 ciphertexts) | 1,017,745,014 |
| `hash_record` | `Enc<Shared,[u8;256]>` (256 ciphertexts) | 2,528,440,014 |
| `hash_packed` | `Enc<Shared, Pack<[u8;256]>>` (10 ciphertexts) | 1,227,161,510 |
| `merkle_fold` | depth-16 sorted-pair fold, encrypted leaf+path (576 ciphertexts) | 12,686,513,964 |
| `add_together` (template) | 2 encrypted u8 | 309,437,174 |

Read: input decryption/secret-sharing dominates (a plaintext 64-B hash is 35k ACU vs 1.02B with an encrypted input); `Pack<T>` roughly halves cost for a 256-B record and is mandatory for wire size (§8 B7); a depth-16 fold is ~790M ACU/level. (The official skill's cost model corroborates the shape: comparisons are expensive, arithmetic nearly free, and both branches of a secret `if/else` execute — consistent with the compare-swap mux dominating the fold.) **No fee estimate is derived from these numbers:** the ACU→priced-CU-amount mapping and the `cu_price` unit are both unverified (no comp-def init has run — localnet blocked, §8 B5), so any ACU×`cu_price` arithmetic would be invalid and none is given.

## 4b. Costs (docs-derived, read-only)

**Formula (DOCS, pricing-and-incentives.md):** customer charge = `cluster cu_price × computation-definition CU amount` + `priority price × CU` + callback priority cost + **fixed callback submission reserve** (scales with cluster node count). CU price is voted per cluster per epoch; per-computation `execution_fee` is stored on the ComputationAccount and readable post-hoc via `@arcium-hq/reader getComputationFee` (v0.11+). Queued computations expire after 180 slots; expired fees are reclaimable, and per-computation account rent is reclaimable via `claimComputationRent`.

**Observed quote (read-only, 2026-10-31T16:52Z, public RPC, my parse of the shipped IDL):**
- devnet cluster 456: `cu_price = 1`
- mainnet cluster 2026: `cu_price = 1`
- **Unit caveat:** the IDL field is a bare `u64` with no documented unit. Hints only (still unverified): `queue_computation`'s priority arg is documented in code comments as *micro*lamports, and the official agent skill names the queue-side price arg `cu_price_micro`. **Exact unit: unverified. The ACU→CU-amount mapping is likewise unverified** (circuits are compiled and ACU weights measured, §4a, but no comp-def init has run to record a priced CU amount). With two unverified quantities multiplied, the absolute per-computation fee is unknown — no fee estimate or "negligible"/"trivial" cost claim is made.
- **Unavailable without transacting:** the absolute per-computation total (needs our compiled circuit's CU amount + the node-count-scaled callback reserve, whose constant is not in the docs pages read). The honest path to the ticket's "one real fee quote": after the first live devnet computation in the build phase, read `execution_fee` off the ComputationAccount / `getComputationFee` and record it here. A minimal `add_together`-class circuit is the closest public reference point, but its CU amount is not published in the pages read.
- **One-time deploy:** DOCS estimate ~2–5 SOL on devnet (program deploy + MXE/comp-def account init). Devnet SOL is faucet-obtainable; mainnet is out of scope for the demo.

## 5. Smallest encrypted-memory challenge (design)

**Circuit (Arcis, one comp-def) — revised per AdaL review 2026-10-31.** The circuit must reproduce the *deployed* commitment protocol in `agent/src/memory/merkle.ts` + `canonical.ts` **exactly**; it may not substitute a different tree scheme. That protocol is:

- leaf = **Keccak-256** of the record's exact canonical-JSON bytes (`canonicalJson` of the record **excluding `content_hash`**: recursively sorted keys, UTF-8, `JSON.stringify` primitives, no normalization), hashed at **real byte length**.
- leaves sorted ascending in byte order (duplicates kept); pair hashing is **sorted-pair**: `keccak256(min(a,b) ‖ max(a,b))` — there are **no positional/index bits** to authenticate.
- single-leaf tree → root = leaf (unhashed); odd levels duplicate the last node; proof depth must equal `expectedDepth(leafCount)` exactly.
- A valid proof authenticates **membership** of the leaf — not a unique position and not the total leaf count (the on-chain history stores `(epoch, root, timestamp)` only; `leafCount`/`leafIndex` are consistency-checked client metadata, never independently authenticated).

Consequences for the circuit shape (Arcis constraints: fixed-shape circuits, no `String`/`Vec`, `for` with fixed bounds only):

- `Rec` = the canonical JSON bytes as a fixed-max-size `[u8; N]` array **plus real length** `len: u16`. The leaf hash must cover **exactly `rec[0..len]`** — hashing the padded N-byte buffer would commit to different bytes than the deployed protocol and is forbidden. Since the Arcis `SHA3_256` circuit shape is fixed at compile time, length-exact hashing means the circuit must apply the SHA3/Keccak padding rule in-circuit at the real-length position (multiplexer-selected), or an equivalent construction that is *proven byte-identical* at the probe. **Fixed arrays must not change commitment semantics.**
- `Path` = fixed-depth sibling array `[ [u8;32]; D ]` + `leaf_count: u64` (+ `leaf_index: u64` for the odd-duplication position check). No index bits drive hashing order: each level compares-and-swaps the pair into byte order before hashing. Per level: if `level_size` is odd and the node is last, sibling must equal the node (duplication rule); `level_size = ceil(level_size/2)`; enforce `D == expectedDepth(leaf_count)`.
- `bound = (root' == root)` where `root'` is recomputed as above. Single-leaf case: root must equal the leaf directly.

**Predicate binding (soundness requirement from review):** the predicate must be evaluated over the *same authenticated bytes* that were hashed — attaching separately-supplied parsed fields as circuit inputs is **unsound** (they are uncommitted). Candidate approaches, all open until probed (B6): (a) in-circuit anchored extraction — locate `"<key>":<value>` inside the authenticated canonical bytes at a JSON-structural boundary (canonical form fixes key order and serialization, so the search pattern is deterministic) and evaluate the predicate on the extracted bytes; (b) evaluate the predicate over fixed byte-ranges only if record serialization is additionally constrained at commit time (would amend 004/005 artifacts — needs approval); (c) compile a small fixed predicate set whose parameters are *also* hashed into the authenticated output tuple. Arbitrary user questions remain a non-goal.

**Output (tri-state, fully bound):** `(bound: bool, verdict: bool, epoch: u64, root: [u8;32], predicate_id: u8, predicate_params_hash: [u8;32], nonce: u64, recipient: [u8;32])` — `bound=false` means the binding failed (tamper / wrong epoch / non-membership) and **must** surface as loud TAMPER per REQ-55, distinct from `bound=true ∧ verdict=false` (a legitimate "no" answer). The request `nonce`, `predicate_id` **and its parameters**, and the disclosure `recipient` (zero for non-disclosure) are included so the cluster-signed tuple cannot be replayed across requests, questions, or recipients. (Optionally `cluster_sign(SHA3(...))` over the tuple; the standard `SignedComputationOutputs` verification already authenticates outputs — belt-and-braces, decide at probe.)

**Who encrypts / who sees plaintext:** the SOULBOUND agent backend is the client: ephemeral X25519 keypair → ECDH with the MXE cluster public key → Rescue-encrypts `Rec` and `Path` (`@arcium-hq/client`). **The backend therefore necessarily handles memory plaintext at challenge time — no backend-blindness is claimed or achievable in this architecture.** Plaintext visibility per Arcium's own table: `Enc<Shared, T>` = client + MXE-collective; Arx nodes see only secret shares (dishonest-majority model). Epoch/root/predicate travel as **plaintext** args (they are already public on-chain). The *design goal* is that no Arcium node, account, or log line ever carries memory content; that goal is only *established* by the REQ-53 marker audit in the test phase — an architectural sketch alone proves no privacy property.

**Predicate:** `predicate_id` selects among 2–3 fixed predicates compiled into the circuit (demo: "mood tag equals X" / "created_after timestamp T" on a fixed field). Arbitrary user questions are a non-goal.

**Output decryption:** none needed for the verdict — it is deliberately revealed. For the opt-in disclosure beat, the circuit instead re-encrypts ("sealing", encryption/sealing.md) the single disclosed element to the *recipient's* X25519 key; the recipient decrypts one element, never the store.

**Authenticated callback:** Arx cluster submits the result to the Arcium program, which verifies it and CPIs our `#[arcium_callback]` instruction; the handler runs `SignedComputationOutputs::verify_output(&cluster_account, &computation_account)` (BLS cluster signature; `solana-alt-bn128-bls` dep confirms the scheme) and only then writes the result account. v0.14.1+ rules: first callback instruction must target the owning MXE; callback accounts cannot be signers. Mempool expiry: 180 slots — demo UX must tolerate ~1–2 min worst case.

**Cryptographic binding (the point the kickoff says labeling fails):**
1. **Queue side:** the queue instruction takes the soulbound `MemoryRootHistory` PDA as a read-only account, verifies `account.owner == SOULBOUND_PROGRAM_ID` and that `(epoch, root)` is an entry — so the public inputs are anchored to committed on-chain state, not client claims.
2. **In circuit:** the Merkle root would be **recomputed from the encrypted content + path under the exact deployed protocol** (Keccak-256 at real length, sorted pairs, odd duplication, exact depth) and compared to the anchored `root`. **BLOCKED: B2 resolved negative — the native in-circuit hasher is NIST SHA3-256, so this recompute cannot match our Keccak-256 commitments** (§8 B2); the binding also still requires B6 (predicate evaluated over the authenticated bytes, not uncommitted parsed fields). Design property to be demonstrated after a hash-strategy decision, not an achieved result.
3. **Output side:** the cluster-signed output tuple contains `(bound, verdict, epoch, root, predicate_id, predicate_params_hash, nonce, recipient)`; the callback writes a `ChallengeResult` PDA `seeds = [b"challenge", config, computation_offset]` storing the full tuple plus `{config, computation_account, timestamp}`, and must verify the tuple's `nonce`/predicate/recipient against the original queue-request state (no cross-request, cross-question, or cross-recipient replay). The tuple a judge sees on a public explorer is exactly the tuple the cluster signed, and the root in it is exactly the one in the on-chain history at that epoch. A bare boolean "labeled" with a root would prove nothing; here the boolean is *causally downstream* of the root check inside MPC — if B2/B6 are resolved and demonstrated.
4. **Honesty boundary:** this proves the challenged bytes *are the committed leaf*. It does not prove the leaf was truthful when written (garbage-in) — same boundary as the base Merkle REQs.

**Private-default selective disclosure:** default state: every memory is only ever client-encrypted per challenge; nothing is world-readable beyond today's existing roots. Opt-in: owner flags one memory `shareable` (app-level bit, off-chain record metadata); a disclosure challenge runs the circuit with a sealing recipient key; output = one re-encrypted element + the signed inclusion tuple; the disclosure link carries ciphertext + result-account address; the recipient verifies the MXE-signed result against the on-chain root and decrypts exactly one element. The full store never appears in any account, payload, or log.

## 6. Integration seams + ticket 007 conflicts (minimal repo inspection)

Inspected only: `programs/soulbound` lib/state/commit_memory_root/Cargo.toml, ticket 007, `docs/devnet.md`, `BUILD.md`, and the hash imports of `agent/src/memory/merkle.ts`.

- **Seam A (read-only, no soulbound change):** `MemoryRootHistory` PDA `seeds=[b"memory_roots", config]`, entries `(epoch, root, timestamp)`; discriminator computable from the deployed IDL (`programs/soulbound/idl`). The companion program parses it read-only with an owner check. `CharacterConfig` PDA `seeds=[b"character", owner, character_id_le]` for the `config` link.
- **Seam B (new code, ticket scope `agent/mx/`):** challenge client (encrypt/queue/await finalization via `@arcium-hq/client`), reusing the existing committer's canonical record bytes. Our Merkle leaf/parent rule is **Keccak-256** (`js-sha3` in `agent/src/memory/merkle.ts`) — see B2.
- **Seam C (docker):** `BUILD.md`'s `sb-anchor:1.2.1` runner pattern extends to an arcium layer (arcup + CLI + arx node for localnet). Host VPS has no toolchain; Arcium prereqs pin **Solana CLI 3.1.10 / Anchor 1.0.2** vs our image's **4.3.2 / 1.2.1** — resolve in the image, not on the host.
- **Ticket 007 (crank-heartbeat, not yet executed):** both tickets list `programs/soulbound/` in scope. **Conflict dissolves if 014 is implemented as a separate companion crate** (B1): 007 touches the soulbound program; 014 would add `programs/soulbound-mx/` + `agent/mx/` + tests and never reopen the deployed program. If 014 were instead forced *into* the soulbound crate (ticket's literal file scope), it would (a) require downgrading a deployed program's anchor pin, (b) collide with 007's edits to `lib.rs/state.rs/error.rs`, and (c) demand a full redeploy + re-verification. Strongly recommend the companion-crate deviation.

## 7. Test plan — fake-MXE vs live evidence kept apart

**Tier 1 — deterministic offline (CI, no network, no docker):**
- Pure-Rust unit tests of the mirrored circuit logic (Keccak/SHA3 recompute, path fold, predicate, tamper→false) over synthetic fixed records.
- LiteSVM tests of the companion program's *own* logic: queue-instruction constraint that rejects a `(epoch, root)` pair absent from a fabricated history account; result-account PDA/state machine; REQ-55 abort→explicit-error mapping. Arcium accounts are fabricated fixtures — **all Tier-1 evidence must be labeled "fake-MXE"** and never cited as network proof.
- Plaintext audit (REQ-53): synthetic marker string through the whole path; grep accounts/payloads/logs proves CLEAN.

**Tier 2 — arcium localnet (docker, real MPC, still not "live"):** `arcium test` against a local arx node; exercises real keygen/encryption/callback. Evidence labeled "localnet".

**Tier 3 — live devnet (the ticket's live acceptance):** smallest real-network test = deploy companion to devnet (retain upgrade authority), init one comp-def, commit a synthetic root via existing `commit_memory_root`, queue one challenge on cluster 456, await callback, then: `solana account <challenge-result-pda> --url devnet` (or `getAccountInfo`) + `getComputationFee` for the real fee + explorer links recorded here. One intact-memory true verdict + one tampered-memory loud failure.

## 8. Blockers, unresolved issues, and wording that cannot be proven

- **B1 (structural, needs approval):** `arcium-anchor 0.16.0` pins `anchor-lang =1.0.2`; our deployed program pins `=1.2.1`. They cannot coexist in one crate. Ticket file scope says `programs/soulbound/`; required deviation is a new `programs/soulbound-mx/` companion crate on the Arcium-pinned toolchain. **AdaL/Tolu must amend/approve scope before build.**
- **B2 (soundness — RESOLVED 2026-10-31 by executed probe, outcome blocks the native-binding design):** Arcis `SHA3_256` is **NIST SHA3-256**, not Keccak-256. Evidence: compiled probe circuits executed locally via the arcis testing harness (the harness loads and evaluates the same compiled circuit artifacts the network runs) — executed digests for 4 synthetic inputs (2 plaintext-input vectors, 2 encrypted-input) all matched NIST SHA3-256 and none matched Keccak-256 (e.g. `"abc"\0…` to 64 B → executed `2cabfc6a…a8ebafc1` = NIST SHA3-256, vs Keccak-256 `ec2c0d88…f7cc29bb`); vectors + logs in scratch dir. **Consequence:** the in-circuit root recompute in §5 cannot authenticate our Keccak-256 commitments with the native hasher. Options, all needing AdaL/Tolu decision: **(a)** dual-commitment at commit time (add a NIST-SHA3 tree root alongside the Keccak root — amends the 004/005 artifacts and the frozen memory schema); **(b)** hand-rolled Keccak-f[1600] permutation in Arcis (possible in principle; CU cost unmeasured, certainly several× the native hash — a depth-16 fold would very likely become impractical); **(c)** client-side root check (weakens binding — rejected); **(d)** migrate the commitment protocol to NIST SHA3-256 wholesale (amends frozen schema + all committed artifacts; REQ-level change).
- **B3 (licensing, Tolu decision):** `@arcium-hq/client` GPL-3.0-only; `arcis` GPL-3.0-or-later; the Rust integration crates carry no license metadata on crates.io. Shipping GPL client code in the repo/product path needs a conscious call.
- **B4 (trust, unfixable by us):** the Arcium on-chain program source is not public; result verification trusts Arcium's deployed binary + the cluster's BLS key. Devnet cluster 456 has **2 nodes** (mainnet 2026 has 3): REQ-53's "no single node sees plaintext" holds cryptographically (secret sharing), but collusion resistance of a 2-node, likely vendor-operated devnet cluster is demo-grade, not production MPC. Judges should hear this stated plainly.
- **B5 (tooling):** Arcium prereqs (Solana CLI 3.1.10, Anchor 1.0.2, Docker, Yarn) diverge from our pinned image (4.3.2/1.2.1); arcup needs a network install step in a new docker layer. Mac (aarch64) is a supported arcup target; Windows is not. **Session-2 finding (localnet blocked on this host):** no aarch64-linux arcup/CLI binaries exist → linux/amd64 container under Rosetta, and there the agave `solana-test-validator` aborts (`missing AVX support` — Rosetta provides no AVX); the Surfpool preview backend fails against Arcium CLI 0.16.0 (`surfnet_getSurfnetInfo` runbook error, tried surfpool 1.7.0 and 1.6.1). **Localnet execution therefore requires a native x86_64 Linux host (or Arcium toolchain fix) — the remaining CU-amount/execution-fee observations are deferred to that environment.** The official agent skill (v0.11.x-targeted) documents localnet operation but has **no platform/AVX guidance** — this constraint is our finding, absent from official sources.
- **B6 (soundness, open design problem — added post-review):** binding the predicate to the exact authenticated canonical bytes inside a fixed-shape MPC circuit. JSON field extraction in-circuit is heavy; the naive shortcut (client supplies parsed fields alongside the bytes) is unsound and rejected. Options in §5; resolution is part of the P0/P1 probe, not assumed.
- **B7 (feasibility — MEASURED 2026-10-31):** the generated client types for `Enc<Shared, [u8; 64]>` show **one 32-byte ciphertext per plaintext byte** (64 ciphertexts = 2,048 B of args — already over the 1,232-byte tx limit before accounts). This matches the official agent skill's formula: `ciphertext_size = 32 B × number_of_scalar_values`. `Pack<[u8; 256]>` measured at **10 ciphertexts (~26× compression**, matching both the docs claim and the skill's packing pattern) and ~half the ACUs of the unpacked form. The skill likewise confirms the ~1,232-B output limit and names Pack/splitting as the remedy. Estimated single-tx budget for one challenge (packed record 320 B + packed depth-16 path 544 B + pubkey/nonce/plaintext params ~113 B + ~11 account keys ~353 B + signature 64 B): **~1.4 KB — over the 1,232-B limit** at depth 16; fits at depth ≲ 12 only with an address lookup table (~1.11 KB estimated) or ≲ 10 without (~1.21 KB estimated). Estimates from measured per-element costs, not an assembled transaction — but the direction is clear: **epoch size, record size, and packing are coupled design constraints**, and depth-16 (65k memories/epoch) does not fit a single queue transaction as sketched. Design alternatives if deeper trees are needed: deliver the path via a separate mechanism, hash-together commitments, or smaller epochs.
- **Wording in ticket 014 that cannot be proven as written:**
  1. Intent: "no single node — **and not even our backend** — sees plaintext." Not achievable in this architecture: the backend is the encrypting client and necessarily holds plaintext at challenge time. What *is* provable (and what REQ-53's test column actually says): no Arcium node sees plaintext; no plaintext in any account/payload/log. Recommend AdaL correct the intent sentence. **This document's own claims have been corrected accordingly (§5); no backend-blindness or generic privacy claim is asserted anywhere here.**
  2. "Signed result lands on-chain linked to epoch and root" is provable **only with** the in-circuit root recompute + queue-side history anchoring (§5). A design that merely stores a boolean next to root/epoch fields is not proof — concur with the kickoff.
  3. The ticket's spike clause "if the network cannot demonstrate one end-to-end challenge reliably" cannot be settled read-only: 1,402 devnet MXEs and fresh cluster epochs are strong liveness evidence, but reliability is only demonstrable by the Tier-3 live test itself.
  4. Acceptance item "one real fee quote for a challenge computation" is not obtainable so far: session 1 gave the observed `cu_price` field + formula + deploy estimate; session 2 measured ACU weights (§4a); the absolute per-computation figure requires the ACU→CU-amount mapping and a priced unit, both unverified — marked unavailable rather than estimated.
- **Also noted (spec hygiene, not ours to edit):** `docs/architecture.md` labels both Heartbeat (line 21) and Private memory challenge (line 222) "UC-7", and UC-6 appears twice.

## 9. Proposed implementation sequence (post-approval)

1. **P0 probe (EXECUTED 2026-10-31, scratch dir `/tmp/014-p0-probe.WafT9I`, disposable linux/amd64 container):** toolchain stood up (arcup 0.16.0, Solana 3.1.10, Anchor 1.0.2, all pins per docs); 6 probe circuits compiled and their compiled artifacts executed locally via the arcis testing harness. Resolved B2 (NIST SHA3-256 — see §8 B2), measured ACU weights (§4a) and wire expansion (§8 B7). **Not achieved:** localnet MPC run (AVX/surfpool wall, §8 B5), hence ACU→CU-amount mapping, real `execution_fee`, and an assembled queue-transaction measurement remain open — next probe iteration needs a native x86_64 Linux host (or a fixed Arcium/surfpool pairing). Distinguish: compiled-artifact execution (done, settles padding) vs MPC network execution (not done).
2. **Companion crate** `programs/soulbound-mx/` (anchor 1.0.2 + arcium-anchor 0.16.0): `queue_challenge` (history-anchored) + `challenge_callback` (`verify_output` → `ChallengeResult` PDA) + the Arcis circuit from §5.
3. **Tier-1 offline suite** (fake-MXE, deterministic, REQ-55 loud-failure cases) + REQ-53 marker audit.
4. **Tier-2 localnet**, then **Tier-3 devnet live**: one true verdict, one tamper failure, real fee via `getComputationFee`, explorer links appended here.
5. **Selective disclosure beat:** shareable flag + sealing-recipient challenge + disclosure link (FEATURED demo moment).
6. Only then touch nothing of 007/022 — the companion design keeps those files untouched.

## 10. Verdict

**GO (conditional)** — revised after the executed probe. The headline is now **B2's resolution**: Arcis's native hasher is NIST SHA3-256, so the §5 binding design cannot authenticate our Keccak-256 commitments as-is; a hash-strategy decision (dual-commitment, protocol migration, or hand-rolled Keccak) is required before any integration work. Circuit costs are now measured (§4a) and ciphertext wire expansion is measured (§8 B7: packing mandatory; assembled-transaction size is only estimated from those measurements — not assembled — with depth-16 estimated over the 1,232-B limit). On-chain reads still show existence/liveness indicators only; **service reliability is not established**; absolute fees remain **unverified** (ACU→CU mapping and price unit unknown, localnet blocked on this host). The offline/live test separation is clean.

**Exact approval requested from Tolu (via AdaL):**
1. **Hash strategy (top blocker, from B2's negative resolution):** dual-commitment at commit time / migrate the commitment protocol to NIST SHA3-256 / hand-rolled in-circuit Keccak / rescope (§8 B2). No integration before this.
2. Approve the **companion-crate deviation** (`programs/soulbound-mx/`, anchor 1.0.2) in place of the ticket's literal `programs/soulbound/` scope — or direct the alternative (downgrade the deployed program, accepting redeploy + 007 collision).
3. Rule on **GPL-3.0** client/arcis licensing for this repo.
4. Decide whether to provision a **native x86_64 Linux environment** for the remaining measurements (ACU→CU mapping, priced fee, assembled tx, localnet MPC run) — blocked on this Apple-Silicon host (§8 B5).
5. Confirm devnet-only scope for the hackathon demo (mainnet cluster 2026 exists but is out of scope).

Only Tolu may downgrade scope; if any of 1–5 is declined, this ticket cannot proceed as ratified and should be re-scoped in writing first.
