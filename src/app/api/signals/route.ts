import { getSignals } from "@/lib/signal-readings";

export async function GET() {
  try {
    return Response.json(await getSignals());
  } catch (e) {
    const message = e instanceof Error ? e.message : "Signal readings unavailable";
    return Response.json({ error: message }, { status: 502 });
  }
}
