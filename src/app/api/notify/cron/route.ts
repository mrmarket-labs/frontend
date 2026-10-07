import { notifyAll } from "@/lib/notify/deliver";

export const maxDuration = 60;

/** Runs once a day from vercel.json; Vercel authenticates it with CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await notifyAll();
    if (report.errors.length) console.error("[notify] delivery errors:", report.errors);
    return Response.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[notify] run failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
