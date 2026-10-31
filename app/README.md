# Ticket 015 — life & proof

Public read-only inspector: `/life`. Existing conversation remains at `/`.
The Paper research supplies the bone/moss visual hierarchy; no sample values,
character mascot, auth, wallet connection, trait editor or private memory text
were imported into the product.

## Run (from repository root)

```sh
pnpm build
# Separate terminal, same machine; private env file is never committed:
node --env-file=agent/.env agent/dist/life-server.js
# Separate terminal:
pnpm --filter app start
```

The read service binds **127.0.0.1:8787 only**. Set `LIFE_READ_PORT` in its
environment and `LIFE_READ_URL` in the app's server-only environment if changing
that port. App and service must share a host; do not expose the service publicly.
No `NEXT_PUBLIC` variable, signing key, private RPC URL or private storage path
is sent to the browser. The service does not start or modify the voice worker.

Read-service configuration (see `agent/.env.example`):
- `MEMORY_OWNER_ID`: canonical owner public key.
- `MEMORY_CHARACTER_ID`: decimal u64 character id, matching the private store.
- `MEMORY_STORE_PATH`: existing private store root, never a fixture or repo path.
- `MEMORY_COMMIT_RPC_URL`: HTTPS devnet RPC; default public devnet.
- Optional `LIFE_GENESIS_SIGNATURE`: birth transaction signature. Without it,
  inspect the oldest of at most 1000 config transactions; older/unavailable birth
  history remains unavailable. No genesis vector is hardcoded.

The read service never opens the store as a writer, acquires its writer lock,
seals epochs, broadcasts transactions, or loads signing keys. It validates a
fresh atomic store snapshot, schema, content hashes and manifest membership.
Only opaque IDs, epochs, leaf hashes and roots leave that projection (latest 20
sealed records). Proof verification rereads the selected epoch and a **fresh
confirmed** program/config/history snapshot, validates devnet, PDA bindings,
layout/discriminators and root progression, then runs the existing Keccak proof
verifier. The disposable tampered proof changes one byte, not the stored record.
RPC failures are unavailable, not invalid; a local seal without a committed root
has no inclusion verdict. Inclusion does not prove truth or complete capture.

Core Attributes use a bounded reader of the pinned mpl-core 0.12.1 Borsh layouts;
unknown layouts fail unavailable. Owner, config update authority and Attributes
plugin authority are checked. Only trait_vector, mood, life_stage and memory_epoch
are displayed. The birth vector comes from a successful, identity-bound on-chain
initialize_character instruction. Other birth values are not inferred. Unknown
future life-stage variants are unavailable until their actual schema is supported.

## Judge flow

1. Open `/life` from the conversation link, without login/wallet.
2. Compare the birth and current personality vectors; inspect the asset/birth
   transaction on devnet explorer. Only actual changed values are highlighted.
3. Select a sealed memory and click **Verify inclusion**. Read VALID and the
   confirmed slot; the measured browser duration includes the proxy/RPC call.
4. Click **Try a tampered copy**: INVALID is loud and text-labeled. Return to the
   original proof without changing any stored memory.
5. Stop the read service: refresh shows unavailable. Conversation code is
   unchanged. A missing receipt/cost is never displayed as zero or paid.

**Incremental dependency limits:** ticket 007's stage advancement and ticket 010's
receipt writer are not shipped. The deployed config currently supports Born.
The runtime/harness also does not persist a per-turn cost log. Thus model/cost
and append-only receipt panels deliberately say **not yet available**; their
empty arrays are not a functioning receipt/usage backend. Receipt rows use the
same markup for paid/unpaid. No facilitator-kill demonstration, paid receipt or
harness/page cost equality is claimed. Wiring those real writers requires their
own ticket or an explicit scope amendment, not invented JSON files or inference
instrumentation outside this ticket's read-endpoint scope.

## Checks

```sh
pnpm build
node agent/scripts/life.test.mjs
# Optional read-only live check, no model calls or signing:
node --env-file=agent/.env agent/scripts/life.test.mjs --live
curl -s localhost:3000/life | grep -c 'data-req-71'
```

The ticket's `diff <(harness log) <(page cost panel)` line contains descriptive
placeholders, not executable commands; its `cd agent && node agent/scripts/...`
also doubles the directory. The runnable harness is
`node agent/scripts/latency-harness.ts --turns 3` from root, but it makes billable
Meta calls and currently supplies no cost log to compare. It is not run merely
to manufacture unavailable cost evidence. No sub-2s result is claimed unless
measured end-to-end; production server avoids dev-route compilation latency.
