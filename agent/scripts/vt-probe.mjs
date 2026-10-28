// Live probe (Ticket 016 AC1): handshake with the real VT endpoint must
// return a sessionId, not an invalid_request error. Run `pnpm build` first.
// Usage: cd agent && node scripts/vt-probe.mjs
import { readFileSync, existsSync } from "node:fs";
import { VoiceTranscribeStream } from "../dist/observe.js";

const envPath = new URL("../.env", import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const vt = new VoiceTranscribeStream(() => {});
try {
  const sessionId = await vt.connect();
  console.log(`sessionId ${sessionId}`);
  console.log("PROBE PASS: handshake accepted");
} finally {
  vt.close();
}
