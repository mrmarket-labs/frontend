import { rpc } from "@/lib/http";

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

interface SignatureStatus {
  value: ({ confirmationStatus: "processed" | "confirmed" | "finalized"; err: unknown } | null)[];
}

export async function GET(request: Request) {
  const signature = new URL(request.url).searchParams.get("signature") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return Response.json({ error: "Invalid signature." }, { status: 400 });
  try {
    const res = await rpc<SignatureStatus>(SOLANA_RPC, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const s = res.value[0];
    if (!s) return Response.json({ status: "pending" });
    if (s.err) return Response.json({ status: "failed", error: JSON.stringify(s.err) });
    return Response.json({ status: s.confirmationStatus === "processed" ? "pending" : "confirmed" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "RPC error" }, { status: 502 });
  }
}
