import { VersionedTransaction } from "@solana/web3.js";
import { AppError } from "../i18n";
import type { Eip1193Provider, WalletAddress } from "./types";
import { WALLETCONNECT_KEY, walletConnectEnabled, walletConnectProvider } from "./walletconnect";

/**
 * One entry per installed wallet, whatever chains it speaks. Phantom, OKX Wallet, Binance Wallet
 * and MetaMask are all multi-chain now, so the same wallet announces itself on several standards
 * and we fold those announcements back together by name.
 */
export interface DiscoveredWallet {
  /** Stable id persisted as `Wallet.provider`: "phantom", "okx", "binance", "metamask", … */
  key: string;
  name: string;
  icon: string;
  evm?: { rdns: string; provider: Eip1193Provider };
  solana?: SolanaProvider;
  bitcoin?: BitcoinProvider;
}

export interface SolanaProvider {
  /** Connected addresses; prompts the wallet unless `silent`. */
  connect(silent?: boolean): Promise<string[]>;
  signTransaction(tx: Uint8Array, address: string): Promise<Uint8Array>;
  signMessage(message: Uint8Array, address: string): Promise<Uint8Array>;
}

export interface BitcoinProvider {
  requestAccounts(): Promise<WalletAddress[]>;
}

/* --- Naming ------------------------------------------------------------------ */

/** EIP-6963 rdns values that don't normalise to the wallet's Wallet Standard name. */
const RDNS_KEYS: Record<string, string> = {
  "app.phantom": "phantom",
  "com.okex.wallet": "okx",
  "com.binance.wallet": "binance",
  "io.metamask": "metamask",
  "com.coinbase.wallet": "coinbase",
  "com.trustwallet.app": "trust",
};

/** "OKX Wallet" → "okx", "Binance Wallet" → "binance", "Phantom" → "phantom". */
export function walletKey(name: string, rdns?: string): string {
  if (rdns && RDNS_KEYS[rdns]) return RDNS_KEYS[rdns];
  const key = name.toLowerCase().replace(/wallet/g, "").replace(/[^a-z0-9]/g, "");
  return key || rdns || "injected";
}

/* --- Registry ------------------------------------------------------------------ */

const wallets = new Map<string, DiscoveredWallet>();
const listeners = new Set<() => void>();
let started = false;

function upsert(key: string, patch: Partial<DiscoveredWallet> & { name: string }) {
  const existing = wallets.get(key);
  wallets.set(key, {
    key,
    name: existing?.name ?? patch.name,
    icon: existing?.icon || patch.icon || "",
    evm: patch.evm ?? existing?.evm,
    solana: patch.solana ?? existing?.solana,
    bitcoin: patch.bitcoin ?? existing?.bitcoin ?? bitcoinProviderFor(key),
  });
  listeners.forEach((l) => l());
}

/* EIP-6963: EVM wallets announce themselves, so MetaMask, Rabby, OKX, Binance etc. need no SDKs. */
interface AnnounceEvent extends Event {
  detail: { info: { rdns: string; name: string; icon: string }; provider: Eip1193Provider };
}

/* Wallet Standard: the Solana equivalent. Phantom, OKX, Binance, Solflare, Backpack all register. */
interface WsAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
}
interface WsWallet {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly WsAccount[];
  features: {
    "standard:connect"?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WsAccount[] }> };
    "solana:signTransaction"?: {
      signTransaction(input: { transaction: Uint8Array; account: WsAccount; chain?: string }): Promise<readonly { signedTransaction: Uint8Array }[]>;
    };
    "solana:signMessage"?: { signMessage(input: { message: Uint8Array; account: WsAccount }): Promise<readonly { signature: Uint8Array }[]> };
  };
}
interface WsRegisterEvent extends Event {
  detail: (api: { register(...wallets: WsWallet[]): () => void }) => void;
}

const isSolanaChain = (c: string) => c.startsWith("solana:");

function wrapSolana(w: WsWallet): SolanaProvider {
  const accountFor = async (address: string): Promise<WsAccount> => {
    let account = w.accounts.find((a) => a.address === address);
    if (!account) {
      await w.features["standard:connect"]!.connect();
      account = w.accounts.find((a) => a.address === address);
    }
    if (!account) throw new AppError("differentAccount", { name: w.name, address: `${address.slice(0, 4)}…${address.slice(-4)}` });
    return account;
  };
  return {
    async connect(silent = false) {
      const { accounts } = await w.features["standard:connect"]!.connect(silent ? { silent: true } : undefined);
      return accounts.filter((a) => a.chains.some(isSolanaChain)).map((a) => a.address);
    },
    async signTransaction(tx, address) {
      const f = w.features["solana:signTransaction"];
      if (!f) throw new AppError("cantSignTx", { name: w.name });
      const [{ signedTransaction }] = await f.signTransaction({ transaction: tx, account: await accountFor(address), chain: "solana:mainnet" });
      return signedTransaction;
    },
    async signMessage(message, address) {
      const f = w.features["solana:signMessage"];
      if (!f) throw new AppError("cantSignMessage", { name: w.name });
      const [{ signature }] = await f.signMessage({ message, account: await accountFor(address) });
      return signature;
    },
  };
}

function registerSolana(w: WsWallet) {
  if (!w.chains.some(isSolanaChain) || !w.features["standard:connect"]) return;
  upsert(walletKey(w.name), { name: w.name, icon: w.icon, solana: wrapSolana(w) });
}

/* Legacy Phantom-style Solana API: what wallet in-app browsers inject when they skip Wallet Standard. */
interface LegacySolana {
  publicKey: { toString(): string } | null;
  /** Phantom-style wallets resolve with the key; Solflare resolves with a boolean and sets `publicKey`. */
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } } | boolean | void>;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
}

function wrapLegacySolana(name: string, get: () => LegacySolana | undefined): SolanaProvider {
  const provider = () => {
    const p = get();
    if (!p) throw new AppError("unavailable", { name });
    return p;
  };
  const connected = async (p: LegacySolana, opts?: { onlyIfTrusted?: boolean }) => {
    const result = await p.connect(opts);
    const key = (typeof result === "object" && result?.publicKey) || p.publicKey;
    if (!key) throw new AppError("unavailable", { name });
    return key.toString();
  };
  const ensureAccount = async (address: string) => {
    const p = provider();
    if (p.publicKey?.toString() === address) return p;
    if ((await connected(p)) !== address) throw new AppError("differentAccount", { name, address: `${address.slice(0, 4)}…${address.slice(-4)}` });
    return p;
  };
  return {
    async connect(silent = false) {
      return [await connected(provider(), silent ? { onlyIfTrusted: true } : undefined)];
    },
    async signTransaction(tx, address) {
      const signed = await (await ensureAccount(address)).signTransaction(VersionedTransaction.deserialize(tx));
      return signed.serialize();
    },
    async signMessage(message, address) {
      const { signature } = await (await ensureAccount(address)).signMessage(message, "utf8");
      return signature;
    },
  };
}

/* Bitcoin has no discovery standard; these are the injection points of the wallets we know. */
interface PhantomBitcoin {
  requestAccounts(): Promise<{ address: string; purpose: "payment" | "ordinals" }[]>;
}
interface UnisatBitcoin {
  requestAccounts(): Promise<string[]>;
}
/** Xverse speaks sats-connect's JSON-RPC; Leather has its own `request`. */
interface RpcBitcoin {
  request(method: string, params?: unknown): Promise<{ result?: unknown; error?: { message?: string } }>;
}
interface InjectedEthereum extends Eip1193Provider {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isOkxWallet?: boolean;
  isBinance?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isRabby?: boolean;
  isBraveWallet?: boolean;
}
interface InjectedWindow {
  ethereum?: InjectedEthereum;
  phantom?: { solana?: LegacySolana & { isPhantom?: boolean }; ethereum?: Eip1193Provider; bitcoin?: PhantomBitcoin };
  okxwallet?: (Eip1193Provider & { solana?: LegacySolana; bitcoin?: UnisatBitcoin }) | undefined;
  binancew3w?: { ethereum?: Eip1193Provider; solana?: LegacySolana; bitcoin?: UnisatBitcoin };
  trustwallet?: { ethereum?: Eip1193Provider; solana?: LegacySolana };
  coinbaseSolana?: LegacySolana;
  solflare?: LegacySolana & { isSolflare?: boolean };
  unisat?: UnisatBitcoin;
  XverseProviders?: { BitcoinProvider?: RpcBitcoin };
  LeatherProvider?: RpcBitcoin;
}
const win = () => (typeof window === "undefined" ? ({} as InjectedWindow) : (window as unknown as InjectedWindow));

const btcNote = (address: string): WalletAddress["note"] => (address.toLowerCase().startsWith("bc1p") ? "ordinals" : "payment");

function unisatStyle(get: () => UnisatBitcoin | undefined): BitcoinProvider | undefined {
  if (!get()) return undefined;
  return {
    async requestAccounts() {
      const addresses = await get()!.requestAccounts();
      return addresses.map((a) => ({ kind: "bitcoin", address: a.toLowerCase(), note: btcNote(a) }));
    },
  };
}

function bitcoinProviderFor(key: string): BitcoinProvider | undefined {
  const w = win();
  // Phantom's injected Bitcoin provider is deprecated but still the only keyless way to read its addresses.
  if (key === "phantom" && w.phantom?.bitcoin)
    return {
      requestAccounts: async () =>
        (await w.phantom!.bitcoin!.requestAccounts()).map((a) => ({ kind: "bitcoin", address: a.address.toLowerCase(), note: a.purpose })),
    };
  if (key === "okx") return unisatStyle(() => win().okxwallet?.bitcoin);
  if (key === "binance") return unisatStyle(() => win().binancew3w?.bitcoin);
  if (key === "unisat") return unisatStyle(() => win().unisat);
  if (key === "xverse" && w.XverseProviders?.BitcoinProvider)
    return {
      async requestAccounts() {
        const res = await rpc(win().XverseProviders!.BitcoinProvider!, "getAccounts", { purposes: ["payment", "ordinals"] });
        return (res as { address: string; purpose: string }[])
          .filter((a) => a.purpose === "payment" || a.purpose === "ordinals")
          .map((a) => ({ kind: "bitcoin", address: a.address.toLowerCase(), note: a.purpose as "payment" | "ordinals" }));
      },
    };
  if (key === "leather" && w.LeatherProvider)
    return {
      async requestAccounts() {
        const res = (await rpc(win().LeatherProvider!, "getAddresses")) as { addresses: { symbol?: string; address: string }[] };
        return res.addresses.filter((a) => a.symbol === "BTC").map((a) => ({ kind: "bitcoin", address: a.address.toLowerCase(), note: btcNote(a.address) }));
      },
    };
  return undefined;
}

async function rpc(provider: RpcBitcoin, method: string, params?: unknown): Promise<unknown> {
  const res = await provider.request(method, params);
  if (res.error) throw new Error(res.error.message ?? `${method} failed`);
  return res.result;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("eip6963:announceProvider", (e) => {
    const { info, provider } = (e as AnnounceEvent).detail;
    upsert(walletKey(info.name, info.rdns), { name: info.name, icon: info.icon, evm: { rdns: info.rdns, provider } });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  window.addEventListener("wallet-standard:register-wallet", (e) => {
    (e as WsRegisterEvent).detail({
      register: (...ws) => {
        ws.forEach(registerSolana);
        return () => undefined;
      },
    });
  });
  window.dispatchEvent(
    new CustomEvent("wallet-standard:app-ready", {
      detail: {
        register: (...ws: WsWallet[]) => {
          ws.forEach(registerSolana);
          return () => undefined;
        },
      },
    }),
  );

  // Always offered when configured: it reaches a wallet on another device, whatever is installed here.
  if (walletConnectEnabled()) upsert(WALLETCONNECT_KEY, { name: "WalletConnect", evm: { rdns: WALLETCONNECT_KEY, provider: walletConnectProvider } });

  // Some wallet in-app browsers (mostly on phones) only inject their legacy globals, and not
  // always before we mount. Give the announcements a beat, then fall back to those, a few times.
  for (const delay of [400, 1500, 3000]) setTimeout(adoptLegacyGlobals, delay);
}

function adoptLegacyGlobals() {
  const w = win();
  const has = (key: string, chain: "evm" | "solana") => Boolean(wallets.get(key)?.[chain]);
  const legacy = (key: string, name: string, rdns: string, evm?: Eip1193Provider, solana?: () => LegacySolana | undefined) => {
    const patch: Partial<DiscoveredWallet> & { name: string } = { name };
    if (evm && !has(key, "evm")) patch.evm = { rdns, provider: evm };
    if (solana?.() && !has(key, "solana")) patch.solana = wrapLegacySolana(name, solana);
    if (patch.evm || patch.solana) upsert(key, patch);
  };
  legacy("okx", "OKX Wallet", "com.okex.wallet", w.okxwallet?.request ? w.okxwallet : undefined, () => win().okxwallet?.solana);
  legacy("binance", "Binance Wallet", "com.binance.wallet", w.binancew3w?.ethereum, () => win().binancew3w?.solana);
  legacy("phantom", "Phantom", "app.phantom", w.phantom?.ethereum, () => (win().phantom?.solana?.isPhantom ? win().phantom?.solana : undefined));
  legacy("trust", "Trust Wallet", "com.trustwallet.app", w.trustwallet?.ethereum, () => win().trustwallet?.solana);
  legacy("coinbase", "Coinbase Wallet", "com.coinbase.wallet", undefined, () => win().coinbaseSolana);
  legacy("solflare", "Solflare", "com.solflare", undefined, () => (win().solflare?.isSolflare ? win().solflare : undefined));

  // Bitcoin-only wallets announce nothing; `upsert` attaches their provider by key.
  if (w.unisat && !wallets.get("unisat")?.bitcoin) upsert("unisat", { name: "UniSat Wallet" });
  if (w.XverseProviders?.BitcoinProvider && !wallets.get("xverse")?.bitcoin) upsert("xverse", { name: "Xverse" });
  if (w.LeatherProvider && !wallets.get("leather")?.bitcoin) upsert("leather", { name: "Leather" });

  const eth = w.ethereum;
  if (!eth || eth.isPhantom || eth.isOkxWallet || eth.isBinance) return;
  if ([...wallets.values()].some((x) => x.evm && x.key !== WALLETCONNECT_KEY)) return;
  // Order matters: several wallets also set isMetaMask for compatibility.
  const [name, rdns] = eth.isCoinbaseWallet
    ? ["Coinbase Wallet", "com.coinbase.wallet"]
    : eth.isTrust || eth.isTrustWallet
      ? ["Trust Wallet", "com.trustwallet.app"]
      : eth.isRabby
        ? ["Rabby Wallet", "io.rabby"]
        : eth.isBraveWallet
          ? ["Brave Wallet", "com.brave.wallet"]
          : eth.isMetaMask
            ? ["MetaMask", "io.metamask"]
            : ["Browser wallet", "injected"];
  upsert(walletKey(name, rdns), { name, evm: { rdns, provider: eth } });
}

export function subscribeWallets(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Multi-chain wallets first, then alphabetical, so Phantom / OKX / Binance lead the picker; WalletConnect last. */
export function getWallets(): DiscoveredWallet[] {
  start();
  // Whoever injects after our timed checks is caught the next time the list is refreshed.
  adoptLegacyGlobals();
  const chains = (w: DiscoveredWallet) => Number(Boolean(w.evm)) + Number(Boolean(w.solana)) + Number(Boolean(w.bitcoin));
  const last = (w: DiscoveredWallet) => Number(w.key === WALLETCONNECT_KEY);
  return [...wallets.values()].sort((a, b) => last(a) - last(b) || chains(b) - chains(a) || a.name.localeCompare(b.name));
}

/** Accepts the current key or the legacy persisted forms ("eip6963:<rdns>"). */
export function getWallet(provider: string | undefined): DiscoveredWallet | undefined {
  if (!provider) return undefined;
  start();
  const direct = wallets.get(provider);
  if (direct) return direct;
  const rdns = provider.replace(/^eip6963:/, "");
  return [...wallets.values()].find((w) => w.evm?.rdns === rdns);
}

/** Which chains a wallet speaks, for the picker to word: "evm-only" when EVM is all it has. */
export function chainsOf(w: DiscoveredWallet): ("solana" | "evm" | "evm-only" | "bitcoin")[] {
  const parts: ("solana" | "evm" | "evm-only" | "bitcoin")[] = [];
  if (w.solana) parts.push("solana");
  if (w.evm) parts.push(w.solana || w.bitcoin ? "evm" : "evm-only");
  if (w.bitcoin) parts.push("bitcoin");
  return parts;
}

/**
 * One connection yields every chain the wallet speaks. The first chain is required; the others
 * are best-effort, since a user may not have enabled them in the wallet.
 */
export async function connectWallet(w: DiscoveredWallet, opts: { onlyIfTrusted?: boolean } = {}): Promise<WalletAddress[]> {
  const out: WalletAddress[] = [];
  const steps: (() => Promise<void>)[] = [];
  if (w.solana) {
    const solana = w.solana;
    steps.push(async () => {
      for (const a of await solana.connect(opts.onlyIfTrusted)) out.push({ kind: "solana", address: a });
    });
  }
  if (w.evm) {
    const { provider } = w.evm;
    steps.push(async () => {
      const accounts = (await provider.request({ method: opts.onlyIfTrusted ? "eth_accounts" : "eth_requestAccounts" })) as string[];
      for (const a of accounts) out.push({ kind: "evm", address: a.toLowerCase() });
    });
  }
  if (w.bitcoin && !opts.onlyIfTrusted) {
    const bitcoin = w.bitcoin;
    steps.push(async () => {
      out.push(...(await bitcoin.requestAccounts()));
    });
  }
  if (steps.length === 0) throw new AppError("noChains", { name: w.name });
  await steps[0]();
  for (const step of steps.slice(1)) {
    try {
      await step();
    } catch {}
  }
  return out;
}
