# Ticket 008 scope amendment

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Tolu approved a low-friction demo policy in which an explicitly connected participant may trigger one vision frame, without claiming owner-only authentication, and approved a private per-character observation sidecar to preserve full REQ-44 provenance without changing the frozen generic memory schema.

## Approved decisions

### Trigger and sender policy

- Keep the user flow low friction: anyone who is connected to the demo room may explicitly click **Look at this** and trigger exactly one frame.
- This is a participant-triggered demo feature, not an owner-authenticated operation. Do not describe a LiveKit participant name as proof of owner identity.
- Keep strict envelope validation, size/MIME bounds, per-trigger response correlation, no implicit/background capture, and frame zeroization. Reject malformed or oversized requests. No vision call occurs before the explicit UI action.
- Rate-limit or serialize triggers per participant/room so a guest cannot create concurrent, unbounded inference calls. The existing test budget authorizes no new live calls; new live tests require new explicit approval.

### Durable REQ-44 provenance

- Keep the Ticket 004 generic `MemoryRecord` schema and its frozen Merkle hashing/commitment protocol unchanged.
- Add a private, character-scoped vision observation sidecar keyed by the resulting memory-record ID. Persist only metadata needed for provenance: frame hash, SAM mask reference, observation timestamp, trigger ID, and the memory record ID. Do not persist raw image bytes, mask bitmap/payload, base64, or transcript.
- Write the normal memory extraction through the existing store, obtain the created record ID, then atomically link the sidecar metadata to that ID. Recovery must not leave a successful UI response with missing provenance: if sidecar persistence fails, return a visible failure or an explicit “observed but not durably recorded” state, not a success claim.
- Sidecar data remains local/private and is not placed on-chain. The on-chain boundary remains the existing committed memory hashes/roots only. Sidecar validation must be character/namespace bound, bounded in size, and covered by tamper/corruption tests.
- The sidecar is a Ticket 008 scope expansion, not an amendment to REQ-50/51 or the generic schema. If it cannot be implemented atomically without expanding the frozen store protocol further, stop and request a new owner decision rather than silently changing generic memory data.

## Verification and authorization boundary

- Offline tests must prove no frame/network action before a click, one bounded frame per trigger, strict trigger correlation, rejection of invalid/untrusted payload structure, frame zeroization, successful sidecar/record linkage, and failure behavior when persistence fails.
- A real SAM/Spark test on a useful public object-bearing fixture requires a fresh separate explicit call budget. The prior one-pair test authorization is spent. No personal-photo upload is authorized by this amendment.
- The app must label this feature as an explicit room-participant demo capability; do not claim owner-only authorization. A future authenticated owner-control requirement needs a separate token/auth design.
