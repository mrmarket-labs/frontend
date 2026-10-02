import { MAX_ADDRESSES, parseAddresses, scanPortfolio } from "@/lib/portfolio";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { addresses?: string } | null;
  const addresses = parseAddresses(body?.addresses ?? "");
  if (addresses.length === 0) return Response.json({ error: "Add at least one address." }, { status: 400 });
  if (addresses.length > MAX_ADDRESSES)
    return Response.json({ error: `Up to ${MAX_ADDRESSES} addresses at a time.` }, { status: 400 });
  return Response.json(await scanPortfolio(addresses));
}
