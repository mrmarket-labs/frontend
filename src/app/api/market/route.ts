import { getMarketSnapshot } from "@/lib/market";

export async function GET() {
  try {
    return Response.json(await getMarketSnapshot());
  } catch (e) {
    const message = e instanceof Error ? e.message : "Market data unavailable";
    return Response.json({ error: message }, { status: 502 });
  }
}
