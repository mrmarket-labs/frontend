import { rpc } from "@/lib/http";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

interface SignatureStatus {
  value: ({ confirmationStatus: "processed" | "confirmed" | "finalized"; err: unknown } | null)[];
}

/**
 * Confirmation status plus whether the transaction can still land: once the chain passes the
 * transaction's lastValidBlockHeight an unconfirmed transaction is dead and safe to retry.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const signature = params.get("signature") ?? "";
  const lastValid = Number(params.get("lastValidBlockHeight") ?? 0);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return Response.json({ error: "Invalid signature." }, { status: 400 });
  try {
    const [res, blockHeight] = await Promise.all([
      rpc<SignatureStatus>(SOLANA_RPC, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]),
      lastValid ? rpc<number>(SOLANA_RPC, "getBlockHeight", [{ commitment: "confirmed" }]) : Promise.resolve(0),
    ]);
    const s = res.value[0];
    if (s?.err) return Response.json({ status: "failed", error: JSON.stringify(s.err) });
    if (s && s.confirmationStatus !== "processed") return Response.json({ status: "confirmed" });
    // A small grace window: block height and signature lookups can come from different nodes.
    const expired = lastValid > 0 && blockHeight > lastValid + 30;
    return Response.json({ status: expired ? "expired" : "pending" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "RPC error" }, { status: 502 });
  }
}
