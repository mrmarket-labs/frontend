import { authConfigured, issueNonce } from "@/lib/auth";
import { clientIp, hit, tooMany } from "@/lib/limits";

export async function GET(request: Request) {
  if (!authConfigured) return Response.json({ error: "Sign-in isn't configured on this server (AUTH_SECRET missing)." }, { status: 503 });
  const limit = await hit(`auth:nonce:${clientIp(request)}`, 30, 3600);
  if (!limit.ok) return tooMany("Too many sign-in attempts. Try again later.", limit.retryAfterSec);
  return Response.json(await issueNonce());
}
