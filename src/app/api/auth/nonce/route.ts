import { authConfigured, issueNonce } from "@/lib/auth";
import { clientIp, hit, tooMany } from "@/lib/limits";
import { dict, localeFromRequest } from "@/lib/i18n";

export async function GET(request: Request) {
  const t = dict(localeFromRequest(request)).api;
  if (!authConfigured) return Response.json({ error: t.signInNotConfigured }, { status: 503 });
  const limit = await hit(`auth:nonce:${clientIp(request)}`, 30, 3600);
  if (!limit.ok) return tooMany(t.tooManySignIns, limit.retryAfterSec);
  return Response.json(await issueNonce());
}
