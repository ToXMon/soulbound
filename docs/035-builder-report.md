# Ticket 035 builder report (corrected)

Date: 2026-11-02
Builder: pi CLI using DeepSeek V4 Pro via the development provider
Reviewer: AdaL
TL;DR: Fixed-reference support passes local tests; deployment and owner listening acceptance are separate gates.
Status: **Corrected — fd-based load, strict fmt validation, sanitized errors**

## Review FAIL items addressed

| # | Issue | Fix |
| --- | --- | --- |
| 1 | `readFileSync` reads unlimited file before size check | Replaced with `openSync → fstatSync → Buffer.alloc(capped) → readSync(loop) → closeSync(finally)`. Size is known from fstat before any allocation. |
| 2 | `catch` includes filesystem `error.message` leaking private path | `openSync` throw is caught and replaced with sanitized `"cannot open ref audio file"`. All other errors are path-free string literals. |
| 3 | `validateRefWav` accepts RIFF without proper fmt | Rewritten to enforce: AudioFormat=1 (PCM), channels=1 or 2, sample rate 8000–192000, bitsPerSample=16, blockAlign=channels×(bits/8), byteRate=sampleRate×blockAlign. Rejects duplicate/missing fmt/data chunks. |

## Files changed

| File | Change |
| --- | --- |
| `agent/src/tts-ref.ts` | Fd-based open/stat/read/close; fstat regular-file gate; sanitised errors; strict PCM16 fmt validation. |
| `agent/scripts/tts-provider.test.mjs` | Updated "rejects missing file" error regex; added 7 new tests: path-not-in-error, directory rejection, 4 malformed-fmt variants (non-PCM, bad channels, bad rate, blockAlign/byteRate mismatch). Renamed oversized test to clarify pre-allocation. |
| `docs/035-builder-report.md` | This file (corrected). |

## Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Explicit opt-in, no silent fallback. | **PASS.** Unchanged from original. |
| 2 | Bounded local WAV read; validate format/size; no remote fetch; pin digest; same ref every request. Never log paths/bytes. | **PASS.** Fd pipeline: open → fstat (size + regular-file check) → bounded allocate → bounded read from same fd → close. All errors sanitized — no path, no OS message. |
| 3 | One full-reply synthesis; fixed seed; WAV validation; cancellation; one audible path. Stable reference across differing text; rejection paths tested. | **PASS.** Unchanged pipeline. Rejection paths now cover malformed fmt, directory, oversized-pre-allocation, and path-leak verification. |
| 4 | Turn supersession NOT changed. | **CONFIRMED.** |
| 5 | Operator endpoint restoration required. | **NOT VERIFIED.** No running endpoint. |
| 6 | Docs distinguish implemented/deployed/tested/owner-listened. | **Partial.** Deployed and owner-listened pending. |

## What was NOT done

- No inference calls, deployment, Akash, git, audit, or secrets.
- No engine switch; VoxCPM2 remains the product renderer.
- No turn-supersession changes.