import { getFx } from "@/lib/fx";

export async function GET() {
  try {
    return Response.json(await getFx());
  } catch (e) {
    const message = e instanceof Error ? e.message : "Exchange rates unavailable";
    return Response.json({ error: message }, { status: 502 });
  }
}
