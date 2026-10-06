import { z } from "zod/v4";
import { FEE_BPS, solanaFeeAccount } from "@/lib/fees";
import { getJson } from "@/lib/http";
import { clientIp, hit, tooMany } from "@/lib/limits";

// lite-api is keyless and rate-limited; api.jup.ag needs a key but has higher limits.
const JUPITER = process.env.JUPITER_API_KEY
  ? { base: "https://api.jup.ag/swap/v1", headers: { "x-api-key": process.env.JUPITER_API_KEY } }
  : { base: "https://lite-api.jup.ag/swap/v1", headers: {} as Record<string, string> };

const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_PRIORITY_FEE_LAMPORTS = 5_000_000; // 0.005 SOL cap on the priority fee

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RequestSchema = z.object({
  inputMint: z.string().regex(base58),
  outputMint: z.string().regex(base58),
  amount: z.string().regex(/^[1-9]\d{0,30}$/),
  userPublicKey: z.string().regex(base58),
  slippageBps: z.number().int().min(1).max(500).default(DEFAULT_SLIPPAGE_BPS),
});

interface JupQuote {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  platformFee: { amount: string; feeBps: number } | null;
  routePlan: { swapInfo: { label: string } }[];
  error?: string;
}
interface JupSwap {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  simulationError: { error: string } | null;
  error?: string;
}

export async function POST(request: Request) {
  const limit = await hit(`swap:ip:${clientIp(request)}:${Math.floor(Date.now() / 3_600_000)}`, 120, 3600);
  if (!limit.ok) return tooMany("Too many quote requests. Try again in a few minutes.", limit.retryAfterSec);
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid swap request." }, { status: 400 });
  const { inputMint, outputMint, amount, userPublicKey, slippageBps } = parsed.data;

  try {
    // Jupiter only accepts a fee when we can name a token account for it.
    const feeAccount = (await solanaFeeAccount(inputMint)) ?? (await solanaFeeAccount(outputMint));
    const params = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps) });
    if (feeAccount) params.set("platformFeeBps", String(FEE_BPS));
    const quote = await getJson<JupQuote>(`${JUPITER.base}/quote?${params}`, { headers: JUPITER.headers });
    if (quote.error) return Response.json({ error: quote.error }, { status: 502 });

    const swap = await getJson<JupSwap>(`${JUPITER.base}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json", ...JUPITER.headers },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        ...(feeAccount && { feeAccount }),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_FEE_LAMPORTS, priorityLevel: "high" },
        },
      }),
    });
    if (swap.error) return Response.json({ error: swap.error }, { status: 502 });
    if (swap.simulationError)
      return Response.json({ error: `Swap would fail: ${swap.simulationError.error}` }, { status: 409 });

    return Response.json({
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      minOutAmount: quote.otherAmountThreshold,
      priceImpactPct: Number(quote.priceImpactPct) * 100,
      feeBps: quote.platformFee?.feeBps ?? 0,
      feeAmount: quote.platformFee?.amount ?? "0",
      feeMint: quote.platformFee ? (feeAccount && (await solanaFeeAccount(inputMint)) ? inputMint : outputMint) : null,
      route: [...new Set(quote.routePlan.map((r) => r.swapInfo.label))],
      networkFeeLamports: swap.prioritizationFeeLamports + 5000,
      swapTransaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not get a quote." }, { status: 502 });
  }
}
