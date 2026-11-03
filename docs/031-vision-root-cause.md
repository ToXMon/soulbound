# Vision root-cause evidence — transport size boundary

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Strong root-cause candidate for the owner's vision failure, established by code analysis: the browser sends the whole base64 frame envelope in ONE LiveKit `publishData` message, but the browser datachannel rejects messages above ~64 KiB — far below the app's 8 MiB guard and the worker's 12 MiB envelope bound. A real camera JPEG (typically 150–400 KiB → 200–530 KiB envelope) fails in `publishData`, `VisionTrigger.look()` catches, and the UI shows "unavailable" — no worker involvement, no paid calls, matching the observed failure. Live repro was blocked by a NEW transport outage (below).

## Evidence (code, verified this session)

- `app/app/vision-trigger.ts`: envelope = JSON `{version, trigger_id, mime, image_base64}`; `MAX_VISION_FRAME_BYTES = 8_000_000` client guard; `publishFrame` → single `room.localParticipant.publishData(envelope, {reliable:true, topic:"vision-frame"})` (app/app/page.tsx:553). Any throw → status `unavailable` (look() catch).
- `app/app/page.tsx:147-148`: frame = FULL video resolution JPEG quality 0.85 (no downscale). Typical 720p/1080p webcam JPEG ≈ 150–400 KiB → envelope ≈ 200–530 KiB.
- Worker `agent/src/vision/handler.ts`: `MAX_ENVELOPE_BYTES = 12_000_000` — accepts what the browser cannot send. The two bounds disagree by ~200×.
- LiveKit server v1.13.11 (pinned): no server-side size check (`pkg/rtc/transport.go` SendDataMessage passes bytes to pion datachannel); the ~64 KiB limit is the BROWSER datachannel send cap (SCTP). Prior live test used a 96×64 PNG (~2 KiB envelope) — it never exercised this boundary, which is why SAM's zero-mask result was a red herring for transport.
- Attempted empirical browser probe (publishData 30/63/64.1/100/400 KiB on a probe topic, zero inference) was blocked by the transport outage below.

## Fix design (next step, regression-tested)

Adaptive downscale in `captureVisionFrame`: canvas-render at bounded max dimension (start 768px, JPEG q0.85), rebuild envelope, step down (640/512/384, then lower q) until the ENVELOPE fits a conservative transport bound (≤48 KiB), never exceeding a bounded number of iterations. Add the bound as a shared constant mirrored in tests. SAM/Spark operate fine at ≤768px. No increase of any server limit. Regression test: envelope-size property at the real seam.

## NEW blocker discovered 2026-11-01 ~15:55 local: transport deployment unreachable

- App lease 29328587 containers healthy, but its cloudflared quick-tunnel had died (NXDOMAIN on the old URL). Recreated with akash/transport/start-app-tunnel.py → NEW URL: `https://notification-detective-cleaners-defendant.trycloudflare.com` (401 gate verified; browser re-authenticated from the private access.json).
- Transport lease 29328467 reports `ready_replicas: 1` on-chain, but its endpoints are DEAD from the internet: dedicated IP `194.107.163.5` does not answer ping/443, forwarded port `provider.h6i-dedicated.eu-se-1.digitalfrontier.so:32529` dead, `194-107-163-5.sslip.io` dead. Same provider host answered fine for the MMS test earlier today, so this is lease/IP-specific. **Voice, TURN and vision are all down until 29328467 is restarted** — restart regenerates the LiveKit key/cert and requires app credential refresh + worker restart (docs/027). NOT performed without owner go-ahead.

## Honest boundaries

- The size-mismatch diagnosis is code-established but NOT yet live-reproduced; the browser probe and the end-to-end fixture test (one bounded SAM+Spark pair within the existing $5 ceiling) must run once the transport is restored.
- The vision UI's failure surface should also be checked: a transport-level publish failure currently shows only generic "unavailable" — after the fix, verify the status text distinguishes capture vs transport failure honestly.
- App + worker are otherwise unchanged; owner-confirmed voice path is down only because of the transport outage, not any change made this session.
