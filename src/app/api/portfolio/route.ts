import { clientIp, hit, tooMany } from "@/lib/limits";
import { dict, localeFromRequest } from "@/lib/i18n";
import { MAX_ADDRESSES, parseAddresses, scanPortfolio } from "@/lib/portfolio";

export async function POST(request: Request) {
  const t = dict(localeFromRequest(request)).api;
  const limit = await hit(`scan:ip:${clientIp(request)}:${Math.floor(Date.now() / 3_600_000)}`, 60, 3600);
  if (!limit.ok) return tooMany(t.tooManyScans, limit.retryAfterSec);
  const body = (await request.json().catch(() => null)) as { addresses?: string } | null;
  const addresses = parseAddresses(body?.addresses ?? "");
  if (addresses.length === 0) return Response.json({ error: t.addOneAddress }, { status: 400 });
  if (addresses.length > MAX_ADDRESSES)
    return Response.json({ error: t.tooManyAddresses(MAX_ADDRESSES) }, { status: 400 });
  return Response.json(await scanPortfolio(addresses));
}
