# Notes — Meta "Agents 101: Build a Multimodal AI Agent Pt. 1" (Vimeo live session)

**Source:** Vimeo 1239550947/045ee6e57e (Suraj Subramanian). Video is login-gated for download, so the transcript could not be extracted; the workshop's full substance is here via the page description and its official companion repo: https://github.com/meta-models/legal-agent-workshop (cloned to /tmp for review).
**Date:** 2026-10-27 · Author: AdaL (thinker)

## What the workshop teaches (from the repo, which IS the workshop)

1. **The Meta Model API is the OpenAI SDK.** `OpenAI(api_key=MODEL_API_KEY, base_url="https://api.meta.ai/v1")`, then `client.responses.create(model="muse-spark-1.3", ...)`. SDK-side retries for 429/503, 180s timeout, key never leaves the client.
2. **One agentic loop, one tool per turn.** System instructions are a versioned markdown file sent every turn; behavior changes are prompt changes, not code changes.
3. **Checklist → plan → investigate → memo.** Before touching documents the agent writes what must be proven and what evidence settles each item (4–8 items, must include counterevidence).
4. **Quote-checked facts.** Every recorded fact must copy a quote exactly from verified extracted text (Files API). Refusal if the quote isn't on the page.
5. **Verification layer OUTSIDE the agent's control.** Checks run in `verification/`, not in the loop; the agent cannot whitewash itself. Pre-built claim checks + two participant-built checks.
6. **Human-in-the-loop escalation & resume.** Run stops at `needs_input`; person releases evidence; `resume` continues the same run; `branch` replays from a checkpoint with verification on.
7. **Evidence honesty as a rule, not a vibe.** "Never guess… say so instead of filling the gap." Gaps are named, unproven items stay unproven.

## Mapping to SOULBOUND (validated + actionable)

- Our constitution already mirrors this workshop: quote/evidence honesty (non-negotiable 4), the `audit/` per-task receipts, AdaL-verify-not-vibes, oracle-gated mutations (agent cannot edit its own soul). Say this explicitly to judges — SOULBOUND is the Agents-101 discipline applied to a *persistent character*: the checklist is the memory journal, the memo is the dream-cycle delta, the verification layer is the Anchor program.
- **Adopt the client pattern verbatim** in `agent/agent_kit`-style plumbing: OpenAI SDK → `api.meta.ai/v1`, `muse-spark-1.3`, SDK retries, one-file-per-tool (`tools/definitions()` + `tools.run()`), one tool per turn.
- **Adopt run-on-disk progress** (`progress.py` pattern: `new_run / save_progress / load_progress / resume / branch`) for SOULBOUND sessions — gives free audit receipts and crash recovery on the VPS.
- **Diarization = the legal-agent's signature check analog.** Their `check_signatures` ↔ our owner-voice recognition (REQ-42). Same structure: verify identity before relying on the fact.
- **Cost note from workshop:** ~$7 expected token spend for the hands-on. Budget SOULBOUND demo runs accordingly; Spark Open (Baseten) for all background consolidation.
