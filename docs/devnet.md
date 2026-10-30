# SOULBOUND — devnet pins (Ticket 002)

Everything on this page was observed on devnet, not planned. Any value that could not be
verified is labelled **unverified** rather than filled in. Evidence folder:
`audit/002-anchor-genesis-mint/`.

## Pinned versions

The ticket requires the exact `anchor-lang` version chosen at kickoff to be recorded here.

```
PROGRAM_ID=BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd

anchor-lang   = 1.2.1     (pinned `=1.2.1` in programs/soulbound/programs/soulbound/Cargo.toml)
anchor-spl    = 1.2.1
anchor-cli    = 1.2.1
mpl-core      = 0.12.1    (Rust CPI; `anchor` feature deliberately NOT enabled — see Compatibility)
litesvm       = 0.18.1    (Rust; Agave 4.3.2 runtime)
solana-cli    = 4.3.2     (src:92555e42; client:Agave)
host rustc    = 1.99.1    (tests)
sbf rustc     = 1.95.0-dev (ships with solana-cli 4.3.2; constrains the program crate only)
```

### Toolchain constraint (found the hard way)

The program crate must keep `rust-version = "1.89.0"`. The SBF toolchain that ships with
solana-cli 4.3.2 is `rustc 1.95.0-dev`, so raising the workspace `rust-version` to the
`1.97.1` that LiteSVM/Agave demand for the **test** crate silently breaks `anchor build`
with:

```
error: rustc 1.95.0-dev is not supported by the following package:
  soulbound@0.1.0 requires rustc 1.97.1
```

`cargo test` still compiles in that state, so the failure is easy to miss. The pins are
therefore split: workspace/program `1.89.0`, `tests/Cargo.toml` `1.97.1`.

## Compatibility (the ticket's pre-flight gate)

Verified by compiling a real probe crate, not by reading docs:

| Pair | Result |
|---|---|
| anchor-lang 1.2.1 + anchor-spl 1.2.1 | resolves, compiles |
| anchor-lang 1.2.1 + spl-token-2022-interface 3 | compiles; `initialize_non_transferable_mint` available |
| anchor-lang 1.2.1 + mpl-core 0.12.1 (default features) | compiles; `CreateV1Builder` + `invoke` work |
| anchor-lang 1.2.1 + mpl-core `anchor` feature | **rejected** — pulls `anchor-lang 0.31`/`0.32` and `solana-program 2` alongside 1.2.1 / `solana-program 3` |

**Resolution:** enable only mpl-core's `borsh-v1` feature and drive the CPI with
`CreateV1Builder::instruction()` + `solana_program::program::invoke`. No Anchor downgrade,
no version skew. Token-2022 non-transferable and Metaplex Core CPI both work under the
pinned Anchor 1.x.

## Ticket 002 deployment (historical; Ticket 005 upgrade receipt below)

`solana program show BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd --url devnet`:

```
Program Id: BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: 6YtN1z61nFydyyyqYTnP85VVFtkDhkM9baHe8HiN6TbD
Authority: CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1
Last Deployed In Slot: 515950887
Data Length: 180392 (0x2c0a8) bytes
Balance: 0.9172702 SOL
```

- Deploy transaction: `47b5Skfpf2dqB4sZt1zUWpfkAk2a5aJtkLd846DEu5qw92EkkHFieCB4j2joccejyghkU8bWqE4Y9JMK89jhvrGq`
- Explorer: https://explorer.solana.com/tx/47b5Skfpf2dqB4sZt1zUWpfkAk2a5aJtkLd846DEu5qw92EkkHFieCB4j2joccejyghkU8bWqE4Y9JMK89jhvrGq?cluster=devnet

Deploy authority is the devnet keypair `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1`
(keypair file lives at `~/.config/solana/id.json`, outside the repo — never committed).

## Genesis character (live on devnet)

One real `initialize_character` call against the deployed program.

| Field | Value |
|---|---|
| tx | `BaswUiiqqgUx3pVXV52a3cT6ZFBAebxnRYgEbev9j5xC61Z1XCPnv1vABqK67A9KHTajsBED7v67vEm9wbJKTff` |
| character_id | `895354` |
| owner | `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1` |
| config PDA | `74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc` |
| Core asset | `8ra3ckcmgWRhFyWBiCz6KPLM76hugAYhjeEzZCxc8fHU` |
| receipt mint (Token-2022) | `KTDQzSUUiT62zdRPceSgzteo5VcfkCfya2otLGCS6YZ` |
| owner receipt ATA | `45GjZKzknQuHoNNRA8XpamEdPn9ZcjnYqwcbnMA7X5W9` |
| trait_vector | `genesis:calm,curious,bold` |

- Asset explorer: https://explorer.solana.com/address/8ra3ckcmgWRhFyWBiCz6KPLM76hugAYhjeEzZCxc8fHU?cluster=devnet
- Mint explorer: https://explorer.solana.com/address/KTDQzSUUiT62zdRPceSgzteo5VcfkCfya2otLGCS6YZ?cluster=devnet

Observed on-chain after the mint:

- asset owned by the Core program (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`), 234 bytes
- asset carries `SOULBOUND Character` + `life_stage=born`, `mood=curious`, `memory_epoch=0`,
  `trait_vector=genesis:calm,curious,bold`
- receipt mint owned by Token-2022, `"extension": "nonTransferable"`
- owner ATA holds exactly `1` (decimals 0); mint authority revoked
- config PDA owned by the program, 154 bytes, `life_stage=Born`, `memory_epoch=0`

## Verification commands

```bash
# program is executable on devnet
solana program show BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd --url devnet

# local LiteSVM suite (REQ-01, 02, 03, 05, 06, 07)
cd programs/soulbound && anchor build && cargo test -p tests -- --nocapture --test-threads=1
```

**Note on the ticket's verification command.** The ticket lists
`anchor test --skip-local-validator` as the LiteSVM runner. With anchor-cli 1.2.1 that
command still tries to *deploy to a live cluster* (`Deploying cluster: http://127.0.0.1:8899`)
and fails on a missing `ANCHOR_WALLET`; it does not execute the LiteSVM suite. The suite is
`tests/` (Rust, litesvm 0.18.1) and is run with `cargo test -p tests`, wired as
`[scripts] test` in `programs/soulbound/Anchor.toml`. The ticket text is left untouched —
this is a ticket/CLI mismatch for AdaL to amend.

## Ticket 005 offline baseline (historical)

The observations and unapproved estimates in this section predate the finalized
upgrade recorded below; they are retained as the pre-upgrade baseline.

The program ID, `CharacterConfig` layout (154 bytes), config seeds and genesis
assets above are unchanged. The new instruction/IDL are local only; no upgrade
or memory-root transaction was authorized or broadcast during offline work.
IDL snapshot: `programs/soulbound/idl/soulbound.json` (compare to generated IDL
after `anchor build`). The amendment at `964556a` adds `rotate_runtime_signer`:
owner + replacement signatures, no-op rejection, and `RuntimeSignerRotated` event.
Rotation changes only the existing runtime field, with no reallocation/history
mutation. The lost genesis runtime is not silently replaced. See
`docs/005-committer-runbook.md` before any action.

Read-only observations on 2026-10-30 (confirmed slot 516617433; balances can change):
- Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Existing program is executable; upgrade authority remains
  `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1`.
- Config `74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc` still binds owner
  `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1` and character `895354`.
- Its actual **runtime signer** is
  `f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt` (NOT the owner).
- Derived history `BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p` is absent.
- Owner wallet balance: 4.072202160 SOL. No funding was requested/performed.
- History allocation: 6,189 bytes; RPC rent 0.032090360 SOL.
- Unsigned two-signer commit fee quote: 0.000010000 SOL (slot 516617605).
  First-history maximum estimate: 0.032100360 SOL, before any future fee changes.

After the rotation amendment, the local binary is 227,544 bytes versus the
existing 180,392-byte deployment. Updated read-only rent quotes (2026-10-30,
confirmed balance slot 516631171) supersede the earlier pre-rotation estimate:
minimum new ProgramData rent is 1.156802360 SOL versus its existing
0.917270200 SOL: **at least 0.239532160 SOL additional rent**. Owner balance
was still 4.072202160 SOL. An exact-sized temporary deployment buffer would
require 1.156761720 SOL
(refund/peak funding depends on the approved deploy procedure). Upload/extend/
upgrade transaction fees are **not yet estimated**. These are read-only cost
inputs, not an approved transaction plan. Recheck binary size, authority,
balances, rent, buffer sizing and fees, present the exact sequence to Tolu, and
WAIT for approval before extension, deployment, upgrade or funding. Do not
mount signing keys for offline checks. The genesis script discarded its runtime
private key (`/tmp/mint/mint-genesis.mjs:21`, corroborated by the 002 session log).
The amendment authorizes creation of a NEW dedicated replacement key on Tolu's
Mac only, followed by a separately approved owner + replacement rotation. No key
was created on the VPS. The insecure `/tmp/mint/deployer.json` copy remains a
separate approval-gated remediation proposal, not an action taken here. Real
session data stays Mac-local; no Neon integration.

### Mac replacement runtime key (creation record; installed by rotation below)

Public address: `2CU934FR5LwgnngkBYTH2yzYvJ7UeXvSNYUnaoZBd6HM`.
Created on Tolu's Mac with seed output suppressed and persisted in a private
Mac-local key file. No existing key was overwritten. FileVault was observed on.
The secret was not transferred or printed. A secure local backup remains an
operator responsibility. It was initially only a proposed replacement; the
separately approved dual-signature installation is recorded below.

Local amendment artifact SHA-256:
- Binary: `15eef67ee87b8d87ffe669d3178c1d0319d458eea2ead3c59b3b04cc95b43d77`
- IDL: `f08d3cfe192e38bdcf893184e1d1b29b801493f6497a7442dd75ff2246c87be9`

The binary hash now also matches the deployed bytes verified in the receipt below.
The IDL hash identifies the checked-in build snapshot, not an on-chain IDL publication.

## Ticket 005 approved upgrade — finalized 2026-10-30

Doer cross-provider verification, not independent ticket acceptance. Source basis:
`964556a` plus the uncommitted 005 implementation/amendment handoff. Subsequent
separately approved rotation and real-memory root receipts appear below. Final
ticket closure still requires VPS key-exposure remediation and independent
review; this upgrade receipt alone does not complete Ticket 005.

- Upgrade transaction: `3nmoSZdaYvajSPkn9Ci291rzKpuNncMyTD5M8Mc1MkNHKJUtbxh74jaG4jvLr4ffu7uWN1FAvgbUnzorJGWTYJHo`.
- Explorer: https://explorer.solana.com/tx/3nmoSZdaYvajSPkn9Ci291rzKpuNncMyTD5M8Mc1MkNHKJUtbxh74jaG4jvLr4ffu7uWN1FAvgbUnzorJGWTYJHo?cluster=devnet
- Finalized upgrade slot: **516875467**. Readback observed at
  **2026-10-30T19:16:08.942Z** through public devnet RPC, independently of the
  private QuickNode endpoint used for the transaction receipt.
- Same executable program ID, ProgramData address and upgrade authority as above.
  ProgramData is now **227,589 bytes** (45 metadata + 227,544 executable bytes),
  holds **1.156802360 SOL**, and its executable SHA-256 exactly matches
  `15eef67ee87b8d87ffe669d3178c1d0319d458eea2ead3c59b3b04cc95b43d77`.
- Extension transaction: `x3SH6AdZYR7wWHVLk5S4FY76KV9QRQo58DJdSCsMFMRnBjF61gTbmEhiRoQZDpWW73sPw3gjgu5buvsLM6Ccpf7`,
  finalized slot **516874314**, exactly **47,152 bytes**. The loader legitimately
  updates its deployment-slot metadata during extension; authority and old
  executable bytes were unchanged, and the added tail was zero-filled.
- Buffer `Fe5ckKfdHAxn9crQhfNvdVjo7Vd92218jexgYtMZmAYD` is closed; its
  **1.156761720 SOL** deposit was refunded to the owner/payer.
- Across the upgrade procedure: **228 successful transactions**; total fees
  **0.001145000 SOL**, permanent additional rent **0.239532160 SOL**, net cost
  **0.240677160 SOL**, peak requirement **1.397438880 SOL**. Final owner balance:
  **3.831525000 SOL**. No extra wallet funding was performed.
- Program account, 154-byte config, Core asset, receipt mint and receipt ATA
  exactly match their pre-upgrade snapshots. History PDA is still absent.
  At this upgrade readback, runtime was still
  `f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt`; the replacement was installed
  only by the separately approved rotation below.
- Upload used the pinned Docker CLI's default TPU transport. A local deployment-only
  RPC adapter forwarded oversized public account/status reads intact to public
  devnet RPC, preserving feature verification; other requests, including signed
  submissions, used private QuickNode. Both upstream genesis hashes were checked.
  No signing keys were mounted in the adapter, no adapter port was published,
  and no private endpoint URL is recorded here. No product voice/model path changed.
- Post-upgrade unsigned rotation simulation succeeded: **4,684 CU**, fee
  **0.000010000 SOL**, additional rent **0 SOL**. The subsequent rotation below
  was executed only after separate owner + replacement approval.
- VPS deployer-key exposure remediation remains separately approval-gated and
  unperformed; the upgrade does not remediate that exposure.

## Ticket 005 approved runtime rotation — finalized 2026-10-30

- Transaction: `2pASnTptr18YfTspMBs2f4DJWWvKb57Wnr92bJCJeKTeQDJgUBZ2T5KaiHNw7V6JRZKsv1nvgfdam5XhJ8UhuZyV`.
- Explorer: https://explorer.solana.com/tx/2pASnTptr18YfTspMBs2f4DJWWvKb57Wnr92bJCJeKTeQDJgUBZ2T5KaiHNw7V6JRZKsv1nvgfdam5XhJ8UhuZyV?cluster=devnet
- Finalized slot **516879577**; cross-provider readback observed at
  **2026-10-30T19:31:50.079Z**. Actual fee **0.000010000 SOL**, additional rent
  **0 SOL**. Owner/payer balance after rotation: **3.831515000 SOL**.
- Both owner and replacement signatures verified in the actual transaction.
  Old runtime: `f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt`.
  Installed runtime: **`2CU934FR5LwgnngkBYTH2yzYvJ7UeXvSNYUnaoZBd6HM`**.
  The replacement remains Mac-only and has **0 SOL**; no funding was needed.
- Only config bytes **48..80** changed. Config metadata, every other serialized
  field, memory epoch, program bytes/authority, genesis assets/receipt and absent
  history were verified unchanged against the pre-rotation expectations.
- Actual `RuntimeSignerRotated` event decoded and matched config, old signer,
  new signer and chain timestamp **1793388476**.
- The single broadcast initially returned pending. A read-only CLI restart
  reconciled the new signer; no second broadcast or re-sign was performed.
- This is doer cross-provider verification, not independent acceptance. The
  subsequently approved real-memory root is recorded below; independent review
  and separately gated VPS key-exposure remediation remain open.

## Ticket 005 real Meta memory root — finalized 2026-10-30

Doer live checks, not independent acceptance. No fixture records were used.

- Transaction: `5bBDiPfw89cUouLJMzZjrxt7fhWbSTnFspdP6TS1sLaqvMcEo3ubN1SVoupL7psRXbim51JX1vaT2xJc7Rwd5mdQ`.
- Explorer: https://explorer.solana.com/tx/5bBDiPfw89cUouLJMzZjrxt7fhWbSTnFspdP6TS1sLaqvMcEo3ubN1SVoupL7psRXbim51JX1vaT2xJc7Rwd5mdQ?cluster=devnet
- Finalized slot **516893750**; public devnet RPC readback observed at
  **2026-10-30T20:35:41.812Z**, separately from the private QuickNode transaction
  receipt. Both providers' devnet genesis hashes were verified.
- Character **895354**, config `74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc`,
  history `BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p`, epoch **0**.
  Exact root:

  ```text
  67929cc8390f37f570f24420c3c83c7e176afbdfd14b751e5b837d9704a2092c
  ```

- The user-performed LiveKit voice session produced **2 completed extraction
  jobs and 2 persisted records** through the existing non-contributor Meta Spark
  structured extractor. Shutdown reported complete drain, **0 failed**, **0
  overflow drops**, **0 pending**. The worker was stopped before sealing; store
  validation matched processed jobs and record provenance to the completed jobs.
- The authenticated runtime and owner/payer both signed. The actual signed
  instruction matched the approved config/history, epoch and exact 32 root bytes.
  History contains **one entry**, with chain timestamp **1793391886**; the decoded
  actual `MemoryRootCommitted` event matches config, epoch, root and timestamp.
- First history allocation: **6,189 bytes**, rent **0.032090360 SOL**. Actual fee:
  **0.000010000 SOL**. Total **0.032100360 SOL**, exactly the separately approved
  cap. Owner/payer balance after commit: **3.799414640 SOL**.
- The one broadcast initially returned pending. Read-only CLI restart reconciled
  the exact history entry without re-signing/resending. Finalized history-address
  lookup contains only this transaction.
- Post-finalization separate protocol recomputation matched both content hashes
  and the Merkle root; both inclusion proofs verified. For each record, changing
  a committed field, changing that field and recomputing its hash, and changing
  the proof leaf all failed verification. Only aggregate results/root were
  exported; summaries and provenance remain in private Mac-local storage.
- Program bytes/deployment slot/authority, genesis assets/receipt and all other
  config fields were preserved. `config.memory_epoch` matches the accepted first
  epoch **0**; zero is valid and does not imply an empty history.
- This proves integrity/membership, not truth, complete capture of every spoken
  conversation, or conversational recall. VPS deployer-key exposure remediation
  is still separately approval-gated and unperformed; AdaL's independent review
  and final ticket acceptance remain open. No push or completion commit is claimed.

## Reproducing (Ticket 002 historical deploy procedure; approval required)

```bash
cd programs/soulbound
anchor build                                  # SBF program + target/idl/soulbound.json
cargo test -p tests -- --test-threads=1       # LiteSVM suite, no validator needed
solana program deploy target/deploy/soulbound.so \
  --program-id target/deploy/soulbound-keypair.json --url devnet
```

`tests/fixtures/mpl_core.so` is a dump of the live Core program
(`solana program dump CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d tests/fixtures/mpl_core.so --url devnet`)
so the LiteSVM suite exercises the real program binary, not a mock.
