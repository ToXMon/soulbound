import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

// Starter-pattern token endpoint: the server signs, the browser never sees the secret.
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room") ?? "soulbound";
  const name = req.nextUrl.searchParams.get("name") ?? `guest-${Math.random().toString(36).slice(2, 8)}`;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set (see .env.example)" }, { status: 500 });
  }
  const at = new AccessToken(apiKey, apiSecret, { identity: name });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return NextResponse.json({ token: await at.toJwt() });
}
