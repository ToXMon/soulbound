// Standalone, loopback-only READ service. No connection to the voice worker.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readLife, readProof, rpcReader } from "./life-read.js";

export function lifeServer(env: NodeJS.ProcessEnv = process.env) {
  let active = 0;
  return createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    const send = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.method !== "GET") { res.setHeader("allow", "GET"); send(405, { error: "Read-only endpoint." }); return; }
    if (active >= 4) { send(503, { error: "Read service busy. Retry." }); return; }
    active++;
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!["/life", "/proof"].includes(url.pathname)) { send(404, { error: "Not found." }); return; }
      const signal = AbortSignal.timeout(url.pathname === "/proof" ? 1400 : 4500);
      const rpc = rpcReader(env.MEMORY_COMMIT_RPC_URL ?? "https://api.devnet.solana.com", signal);
      if (url.pathname === "/life") send(200, await readLife(env, rpc));
      else {
        if ([...url.searchParams.keys()].some(k => !["id", "tampered"].includes(k)) ||
            !["0", "1"].includes(url.searchParams.get("tampered") ?? "0")) { send(400, { error: "Invalid proof request." }); return; }
        send(200, await readProof(env, rpc, url.searchParams.get("id") ?? "", url.searchParams.get("tampered") === "1"));
      }
    } catch { send(503, { error: "Read source unavailable. No verdict." }); }
    finally { active--; }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LIFE_READ_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("LIFE_READ_PORT must be 1024..65535");
  lifeServer().listen(port, "127.0.0.1", () => console.log("[life] loopback read service ready; no keys loaded, no writes"));
}
