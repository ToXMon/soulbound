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

## Deployed program

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

## Reproducing

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
