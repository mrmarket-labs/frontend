import { getPacfi, pacfiConfigured } from "@/lib/pacfi";

/** PACFI v1.0 from mrmarket-labs/indicators: the aggregate, its group contributions and daily history. */
export async function GET() {
  if (!pacfiConfigured) return Response.json({ error: "PACFI isn't set up on this server." }, { status: 503 });
  try {
    return Response.json(await getPacfi());
  } catch (e) {
    const message = e instanceof Error ? e.message : "PACFI unavailable";
    return Response.json({ error: message }, { status: 502 });
  }
}
