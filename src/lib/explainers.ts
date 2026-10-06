export interface Explainer {
  /** What the asset actually is, in plain language. */
  what: string;
  /** Who or what you are trusting by holding it. */
  trust?: string;
}

const EXPLAINERS: Record<string, Explainer> = {
  BTC: {
    what: "Bitcoin itself, held on the Bitcoin network. Supply is capped at 21 million coins and no company issues it.",
    trust: "Nobody stands behind it. Whoever holds the keys holds the coins, and a lost key cannot be recovered.",
  },
  ETH: {
    what: "The native coin of Ethereum. It pays for every transaction on the network and is the asset most Ethereum apps are built around.",
    trust: "No issuer stands behind it. Its value rests on Ethereum continuing to be used.",
  },
  SOL: {
    what: "The native coin of Solana. It pays for transactions on the network and can be staked to help secure it.",
    trust: "No issuer stands behind it. Its value rests on Solana continuing to be used, and the network has had outages in the past.",
  },
  USDC: {
    what: "A dollar stablecoin issued by Circle, designed to stay at $1 and backed by cash and short-term US Treasuries. This is the cash part of a portfolio.",
    trust: "That means trusting Circle to hold the reserves and honour redemptions. Circle can freeze USDC at an address, and the price has briefly slipped below $1 before.",
  },
  USDT: {
    what: "A dollar stablecoin issued by Tether, designed to stay at $1. Tether reports reserves held mostly in US Treasuries, alongside other assets.",
    trust: "That means trusting Tether's reserves and its reporting of them. Tether can freeze USDT at an address.",
  },
  CBBTC: {
    what: "Real bitcoin held by Coinbase, issued as a token on Ethereum and other chains. One cbBTC is meant to equal one BTC and is redeemable with them.",
    trust: "That means trusting Coinbase to hold the bitcoin and honour redemptions. Unlike native BTC, it is a claim on a company.",
  },
  WBTC: {
    what: "Bitcoin held by custodians led by BitGo, issued as a token on Ethereum. One WBTC is meant to equal one BTC.",
    trust: "That means trusting the custodians to hold the bitcoin and the merchants who mint and redeem it. Unlike native BTC, it is a claim on those companies.",
  },
  WSTETH: {
    what: "Ether staked through Lido, wrapped as a token. It earns Ethereum staking rewards, so one wstETH slowly becomes worth more ETH over time.",
    trust: "That means trusting Lido's smart contracts and the node operators it uses. It can trade below the ETH it represents, and exiting to plain ETH can mean waiting in a withdrawal queue.",
  },
  JITOSOL: {
    what: "SOL staked through Jito's stake pool, issued as a token. It collects staking rewards, so one JitoSOL slowly becomes worth more SOL over time.",
    trust: "That means trusting the stake pool's smart contracts and validators. It can trade below the SOL it represents.",
  },
  LINK: {
    what: "The token of Chainlink, a network that feeds outside data such as prices into smart contracts. LINK is what the network's node operators are paid and staked in.",
    trust: "It is not a share in a company and carries no claim on revenue. Its value depends on demand for the network.",
  },
  AAVE: {
    what: "The governance token of Aave, a lending protocol on Ethereum and other chains. Holders vote on how the protocol is run.",
    trust: "It is not a share in a company. Its value depends on the protocol's use and on decisions made by its governance.",
  },
  JUP: {
    what: "The governance token of Jupiter, the exchange aggregator on Solana that this app routes Solana swaps through. Holders vote on how it is run.",
    trust: "It is not a share in a company. Its value depends on Jupiter's use and on decisions made by its governance.",
  },
  PAXG: {
    what: "A gold token issued by Paxos. Each PAXG stands for one fine troy ounce of a gold bar held in a professional vault in London.",
    trust: "That means trusting Paxos and its vault custodian to hold the gold. Redeeming for physical bars is only practical in large amounts.",
  },
  XAUT: {
    what: "A gold token issued by a Tether company. Each XAUT stands for one fine troy ounce of a gold bar held in a vault in Switzerland.",
    trust: "That means trusting Tether to hold the gold. Redeeming for physical bars is only practical in large amounts.",
  },
};

/** What each xStock tracks: the underlying share or fund. */
const XSTOCKS: Record<string, string> = {
  SPYX: "the SPDR S&P 500 ETF, a fund holding the 500 largest US public companies",
  QQQX: "the Invesco QQQ ETF, a fund holding the 100 largest non-financial companies listed on Nasdaq",
  NVDAX: "one share of Nvidia",
  AAPLX: "one share of Apple",
  GOOGLX: "one share of Alphabet, Google's parent company",
  TSLAX: "one share of Tesla",
  COINX: "one share of Coinbase",
  MSTRX: "one share of Strategy, formerly MicroStrategy",
  CRCLX: "one share of Circle, the issuer of USDC",
};

/** Plain-language explainer for an instrument the app can buy; null when there is nothing honest to say. */
export function explain(symbol: string): Explainer | null {
  const key = symbol.trim().toUpperCase();
  if (EXPLAINERS[key]) return EXPLAINERS[key];
  const underlying = XSTOCKS[key];
  if (underlying)
    return {
      what: `A token that tracks ${underlying}. The issuer, Backed, holds the real shares with a custodian and issues the token against them.`,
      trust: "It is a claim on the issuer, not a share certificate in your name, and it carries no voting rights. Issuer and legal-structure risk sit on top of the equity risk. It is not offered to US persons.",
    };
  return null;
}
