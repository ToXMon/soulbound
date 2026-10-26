# Ticket 008: eyes-sam

**Intent:** "Look at this." An explicit UI trigger captures ONE approved webcam frame, SAM 3.1 segments it, Spark receives the mask + image and produces a structured observation, which lands in the memory graph with full provenance. Never continuous capture.

**Implements REQs:** REQ-43, REQ-44

**Files in scope:** `app/` (trigger button + frame capture), `agent/vision/` (new), `agent/memory/` (observation record type only)

**Non-goals:** continuous video analysis, face recognition, tracking across frames (SAM video tracking is v2).

**Constraints:**
- Load `meta-model-api` (SAM via `meta-sam` SDK; vision input to Spark as base64).
- No frame leaves the browser without the explicit trigger event (REQ-43 — test asserts no network call without trigger).
- Observation record must carry `frame_hash`, mask ref, timestamp (REQ-44).
- Privacy: frame is processed and discarded; only the structured observation persists (D2).

**Acceptance criteria (each observable):**
- [ ] Clicking "look at this" with an object → mask overlay shown → character comments on the correct object
- [ ] Memory record written with provenance fields (REQ-44)
- [ ] No network call to SAM/vision without trigger (REQ-43 — verify via devtools log assertion in test)
- [ ] A later "what did I show you?" recalls the object (integration with 004)

**Verification:**
```bash
node agent/scripts/vision-demo.ts --fixture app/fixtures/plant.jpg --out audit/008-eyes-sam/verify.txt
```

**Evidence:** `audit/008-eyes-sam/`

---
*Refresh before execution.*
