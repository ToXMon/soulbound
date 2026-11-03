import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

const headers = { "Cache-Control": "private, no-store" };

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
  if (!apiKey || !apiSecret || (process.env.NODE_ENV === "production" && !url?.startsWith("wss://"))) {
    return NextResponse.json({ error: "Secure room configuration unavailable." }, { status: 503, headers });
  }
  const at = new AccessToken(apiKey, apiSecret, { identity: `guest-${crypto.randomUUID()}`, ttl: "10m" });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  return NextResponse.json({ token: await at.toJwt(), url }, { headers });
}
