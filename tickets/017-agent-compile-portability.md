# Ticket 017: agent-compile-portability

**Intent:** Ticket 001/016's agent code compiles on the VPS (pinned lockfile) but not on Tolu's Mac (drifted dependency resolution): `AudioStream` not async-iterable in the installed SDK types, and `ImportMeta.filename` missing. Make `agent/` compile portably across SDK minor drift and Node versions so the round-trip test can run anywhere.

**Implements REQs:** REQ-40 harness portability (no REQ changes)

**Files in scope:** `agent/src/index.ts`, `agent/tsconfig.json`, `agent/package.json` (devDeps only if strictly needed)

**Non-goals:** no behavior changes, no protocol changes, no app/ changes.

**Constraints:**
- Replace `import.meta.filename` with `fileURLToPath(import.meta.url)` (fileURLToPath is already imported in index.ts).
- AudioStream iteration: keep `for await` but cast through the SDK's own exported type or a minimal local `AsyncIterable<AudioFrame>` shape so it compiles against both 0.13.x typings and drifted installs. Do NOT swap the streaming mechanism.
- If a type-only import is needed, prefer `import type` so runtime is untouched.
- Run `pnpm install --frozen-lockfile` first; if the lockfile cannot be honored on this machine, note the resolved @livekit/agents + @livekit/rtc-node + typescript versions in your output.

**Acceptance criteria (each observable):**
- [ ] `pnpm build` exits 0 on this machine (tsc clean)
- [ ] Worker starts against local LiveKit dev server and logs `registered worker`
- [ ] No runtime behavior change: harness still passes against the fixture (spot: `node --import ./polyfill-error-event.mjs dist/index.js` boots without error)

**Verification (exact commands AdaL will run):**
```bash
cd agent && pnpm build && echo BUILD_OK
timeout 10 node --import ./polyfill-error-event.mjs dist/index.js dev 2>&1 | grep -m1 "registered worker"
```

**Evidence:** `audit/017-agent-compile-portability/{muse-session.log, review.md, verify.txt}`
