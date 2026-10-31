import { getProof } from "../../../life/read";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url), id = url.searchParams.get("id") ?? "", tampered = url.searchParams.get("tampered") ?? "0";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !["0", "1"].includes(tampered))
    return Response.json({ error: "Invalid memory identifier or proof mode." }, { status: 400 });
  try { return Response.json(await getProof(id, tampered === "1"), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable", message: "Read service or RPC unavailable. No verdict. Retry.", elapsedMs: null },
    { status: 503, headers: { "cache-control": "no-store" } }); }
}
