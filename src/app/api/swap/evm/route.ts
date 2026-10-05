import { z } from "zod/v4";
import { FEE_BPS, FEE_WALLET_EVM } from "@/lib/fees";
import { EVM_CHAIN_IDS } from "@/lib/tokens";

const ZEROX_API_KEY = process.env.ZEROX_API_KEY || "";
const DEFAULT_SLIPPAGE_BPS = 50;

const address = /^0x[0-9a-fA-F]{40}$/;
const RequestSchema = z.object({
  chainId: z.coerce.number().refine((id) => Object.values(EVM_CHAIN_IDS).includes(id)),
  sellToken: z.string().regex(address),
  buyToken: z.string().regex(address),
  sellAmount: z.string().regex(/^[1-9]\d{0,40}$/),
  taker: z.string().regex(address),
});

interface ZeroXQuote {
  liquidityAvailable: boolean;
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  transaction: { to: string; data: string; value: string; gas: string | null; gasPrice: string };
  issues?: { allowance: { spender: string; actual: string } | null; balance: { expected: string; actual: string } | null };
  fees?: { integratorFee: { amount: string; token: string } | null };
  route?: { fills: { source: string }[] };
}

export async function GET(request: Request) {
  if (!ZEROX_API_KEY)
    return Response.json({ error: "EVM swaps aren't enabled yet: the server has no 0x API key." }, { status: 503 });
  const parsed = RequestSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid swap request." }, { status: 400 });
  const { chainId, sellToken, buyToken, sellAmount, taker } = parsed.data;

  const params = new URLSearchParams({
    chainId: String(chainId),
    sellToken,
    buyToken,
    sellAmount,
    taker,
    slippageBps: String(DEFAULT_SLIPPAGE_BPS),
  });
  if (FEE_WALLET_EVM) {
    params.set("swapFeeRecipient", FEE_WALLET_EVM);
    params.set("swapFeeBps", String(FEE_BPS));
    params.set("swapFeeToken", sellToken);
  }

  try {
    const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${params}`, {
      headers: { "0x-api-key": ZEROX_API_KEY, "0x-version": "v2" },
      signal: AbortSignal.timeout(15_000),
    });
    const quote = (await res.json()) as ZeroXQuote & { message?: string; name?: string };
    if (!res.ok) return Response.json({ error: quote.message ?? `0x responded ${res.status}` }, { status: 502 });
    if (!quote.liquidityAvailable) return Response.json({ error: "No liquidity for this pair right now." }, { status: 409 });
    if (quote.issues?.balance)
      return Response.json({ error: "The wallet doesn't hold enough of the token to sell." }, { status: 409 });

    return Response.json({
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      minBuyAmount: quote.minBuyAmount,
      feeBps: quote.fees?.integratorFee ? FEE_BPS : 0,
      feeAmount: quote.fees?.integratorFee?.amount ?? "0",
      route: [...new Set(quote.route?.fills.map((f) => f.source) ?? [])],
      allowance: quote.issues?.allowance ?? null,
      transaction: quote.transaction,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not get a quote." }, { status: 502 });
  }
}
