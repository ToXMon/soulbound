# Ticket 034: vision frame transport bound

Date: 2026-11-02
POC: Tolu Shekoni
TL;DR: Fit explicitly captured camera frames into a conservative single-message LiveKit envelope, preserving privacy and the current voice path.

## Intent and requirements

Owner approved proceeding with the demo-readiness plan today. Preserve REQ-43/44/70 (explicit vision capture and provenance/privacy) and REQ-40/41 (voice unchanged). See docs/031-vision-root-cause.md; the size mismatch is code-established, not yet browser-reproduced.

## Files in scope

- app/app/page.tsx: only capture integration/imports needed for bounded JPEG encoding.
- app/app/vision-trigger.ts and app/app/vision-trigger.test.ts: enforce actual encoded-envelope limit before publish, and regression tests.
- New app/app/vision-frame.ts and app/app/vision-frame.test.ts: small reusable bounded canvas-encode helper and tests.
- docs/034-builder-report.md.

## Constraints

Execute as the separate pi doer using live-tested surplus/deepseek-v4-pro. Preserve ALL existing dirty work. No commits, push, staging, reset, stash, deployments, inference calls, mic/camera activation, secrets/env reads, personal memory access, new dependencies or changes outside scope. Do not edit ticket, audit, architecture or master state. Do not overwrite the room page wholesale. No model/inference/provider changes.

## Acceptance

1. Capture occurs only after existing explicit trigger. Temporary camera tracks and timeouts are still cleaned on every exit and late permission/cancel paths remain safe.
2. JPEG encoding starts at max dimension 768 without upscaling, preserves aspect ratio, and reduces dimension/quality through a finite bounded candidate sequence until the FULL JSON/base64 envelope fits 48 KiB (49152 bytes). Reserve for the maximum allowed trigger ID, or use actual envelope sizing. No multiple frame sends or chunking.
3. If no candidate fits, fail closed before publish. Never silently truncate bytes, bypass validation or send an oversized message. Rejected intermediate buffers are cleared where owned; returned still dimensions/blob match the transmitted frame and overlays.
4. Actual buildVisionFrameEnvelope rejects envelopes over 49152 bytes regardless of frame-byte guard, so alternate callers cannot bypass the bound. Preserve MIME/version/id validation, response correlation and privacy behavior. Existing oversized synthetic tests may need deliberate bound-aware updates.
5. Tests cover high-entropy/large encoded sizes via injected encoders, bounded attempts, dimensions/aspect ratio/no upscale, null encode/failure, fail closed, exact envelope boundary/base64 overhead and no publish on over-limit payload. No real camera/network in tests.
6. Existing trigger/portrait tests and app TypeScript check pass. Report precisely what was tested and what remains unverified. No live success claim.

## Verification

```sh
pnpm --filter app exec tsc --noEmit --incremental false
node --experimental-strip-types --test app/components/living-portrait/*.test.ts
cd app
out=$(mktemp -d /tmp/soulbound-034-tests.XXXXXX)
pnpm exec tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir "$out" --rootDir . --skipLibCheck app/vision-trigger.ts app/vision-trigger.test.ts app/vision-frame.ts app/vision-frame.test.ts
node --test "$out/app/vision-trigger.test.js" "$out/app/vision-frame.test.js"
cd ..
git diff --check
```

The reviewer independently executes these checks. Builder report belongs in docs/034-builder-report.md with date, POC and TL;DR. Do not touch shared generated Next configuration. Capture the actual doer session outside repo for later sanitized evidence packaging.
