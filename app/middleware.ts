import { NextRequest, NextResponse } from "next/server";

// Operator-only rehearsal admission, not production multi-user authentication.
export function middleware(request: NextRequest) {
  const user = process.env.DEMO_ACCESS_USER;
  const password = process.env.DEMO_ACCESS_PASSWORD;
  const enabled = Boolean(user && password && password.length >= 24);
  if (!enabled && process.env.NODE_ENV !== "production") return NextResponse.next();
  if (!enabled) return new NextResponse("Demo access is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  let supplied = "";
  try {
    const header = request.headers.get("authorization") ?? "";
    if (header.startsWith("Basic ")) supplied = atob(header.slice(6));
  } catch { /* deny malformed credentials */ }
  const expected = `${user}:${password}`;
  let difference = supplied.length ^ expected.length;
  for (let i = 0; i < Math.max(supplied.length, expected.length); i++) {
    difference |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  if (difference !== 0) return new NextResponse("Operator access required.", {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="SOULBOUND rehearsal", charset="UTF-8"', "Cache-Control": "no-store" },
  });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
