import { z } from "zod/v4";
import { authConfigured, buildSignInMessage, consumeNonce, newSession, sessionCookie, verifySignature } from "@/lib/auth";
import { clientIp, hit, tooMany } from "@/lib/limits";
import { scanPortfolio } from "@/lib/portfolio";

/** Wallets below this are refused: makes farming the advisor with throwaway wallets cost real money. */
const MIN_SIGNIN_USD = Number(process.env.MIN_SIGNIN_USD || 25);

const RequestSchema = z.object({
  kind: z.enum(["evm", "solana"]),
  address: z.string().min(32).max(64),
  nonce: z.string().min(40).max(120),
  issuedAt: z.string().datetime(),
  signature: z.string().min(64).max(200),
});

export async function POST(request: Request) {
  if (!authConfigured) return Response.json({ error: "Sign-in isn't configured on this server (AUTH_SECRET missing)." }, { status: 503 });
  const limit = await hit(`auth:verify:${clientIp(request)}`, 10, 3600);
  if (!limit.ok) return tooMany("Too many sign-in attempts. Try again later.", limit.retryAfterSec);

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid sign-in request." }, { status: 400 });
  const { kind, address, nonce, issuedAt, signature } = parsed.data;
  const validAddress = kind === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(address) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (!validAddress) return Response.json({ error: "Invalid address." }, { status: 400 });

  // Nonce first: a replayed or stale message fails before any crypto runs.
  if (!(await consumeNonce(nonce, issuedAt))) return Response.json({ error: "This sign-in request expired. Try again." }, { status: 400 });
  if (!verifySignature(kind, address, buildSignInMessage(address, nonce, issuedAt), signature))
    return Response.json({ error: "The signature doesn't match this wallet." }, { status: 401 });

  const { totalUsd } = await scanPortfolio([address]);
  if (totalUsd < MIN_SIGNIN_USD)
    return Response.json(
      { error: `This wallet holds less than $${MIN_SIGNIN_USD}. Sign in with a wallet that holds funds; watched addresses still count toward your portfolio.` },
      { status: 403 },
    );

  const session = newSession(address, kind);
  return Response.json({ address: session.address, kind }, { headers: { "set-cookie": await sessionCookie(session) } });
}
