import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

const headers = { "Cache-Control": "private, no-store" };

// Production signaling must be wss://. The one exception is a loopback ws://
// URL for running the container image on the same machine as the browser: it
// is unreachable from any other host, so it cannot leak a token over the network.
function signalingAllowed(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "wss:" || (u.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const baseRoom = process.env.DEMO_ROOM ?? "soulbound";
  if (req.nextUrl.searchParams.get("room") && req.nextUrl.searchParams.get("room") !== baseRoom) {
    return NextResponse.json({ error: "Room unavailable." }, { status: 403, headers });
  }
  // One room per join. LiveKit dispatches the agent only when a room is
  // created, so a room that outlives a worker restart (or a stale tab) would
  // otherwise leave every later guest alone with no character (observed live
  // 2026-11-03). Rooms empty out on their own.
  const room = `${baseRoom}-${crypto.randomUUID().slice(0, 8)}`;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_PUBLIC_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || (process.env.NODE_ENV === "production" && !signalingAllowed(url))) {
    return NextResponse.json({ error: "Secure room configuration unavailable." }, { status: 503, headers });
  }
  const at = new AccessToken(apiKey, apiSecret, { identity: `guest-${crypto.randomUUID()}`, ttl: "10m" });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return NextResponse.json({ token: await at.toJwt(), url }, { headers });
}
