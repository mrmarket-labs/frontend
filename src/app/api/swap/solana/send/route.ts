import { z } from "zod/v4";
import { rpc } from "@/lib/http";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const RequestSchema = z.object({
  signedTransaction: z.string().regex(/^[A-Za-z0-9+/=]{100,4000}$/),
});

/**
 * Broadcast a transaction the wallet already signed. Preflight was done when Jupiter built it;
 * skipping it here lets the client rebroadcast the same bytes every couple of seconds.
 */
export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid transaction." }, { status: 400 });
  try {
    const signature = await rpc<string>(SOLANA_RPC, "sendTransaction", [
      parsed.data.signedTransaction,
      { encoding: "base64", skipPreflight: true, maxRetries: 0, preflightCommitment: "confirmed" },
    ]);
    return Response.json({ signature });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not send the transaction." }, { status: 502 });
  }
}
