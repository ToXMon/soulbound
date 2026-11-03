import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const room = process.env.DEMO_ROOM ?? "soulbound";
  if (req.nextUrl.searchParams.get("room") && req.nextUrl.searchParams.get("room") !== room) {
    return NextResponse.json({ error: "Room unavailable." }, { status: 403, headers });
  }
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
