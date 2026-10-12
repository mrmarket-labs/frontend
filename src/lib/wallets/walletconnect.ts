import type EthereumProvider from "@walletconnect/ethereum-provider";
import { EVM_CHAIN_IDS } from "../tokens";
import type { Eip1193Provider } from "./types";

/**
 * WalletConnect: reach a wallet that isn't injected into this browser, by QR code on a desktop
 * or by deep link on a phone. EVM only; the Solana wallets people use here inject instead.
 */
export const WALLETCONNECT_KEY = "walletconnect";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const walletConnectEnabled = (): boolean => Boolean(projectId) && typeof window !== "undefined";

let instance: Promise<EthereumProvider> | null = null;

/** The SDK and its QR modal are heavy; nothing loads until a WalletConnect wallet is used. */
function load(): Promise<EthereumProvider> {
  instance ??= import("@walletconnect/ethereum-provider")
    .then(({ EthereumProvider }) => {
      const [first, ...rest] = Object.values(EVM_CHAIN_IDS);
      return EthereumProvider.init({
        projectId: projectId!,
        optionalChains: [first, ...rest],
        showQrModal: true,
        qrModalOptions: { themeMode: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" },
        metadata: {
          name: "Invest Like Buffett",
          description: "A second opinion on what you hold, before anything moves.",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.ico`],
        },
      });
    })
    .catch((e) => {
      instance = null;
      throw e;
    });
  return instance;
}

/** An EIP-1193 provider that loads the SDK on first use and reconnects if the session has ended. */
export const walletConnectProvider: Eip1193Provider = {
  async request({ method, params }) {
    const p = await load();
    if (method === "eth_accounts") return p.session ? p.accounts : [];
    if (method === "eth_requestAccounts") return p.enable();
    if (!p.session) await p.connect();
    return p.request({ method, params });
  },
};

/** End the session on the phone too, so it doesn't linger in the wallet's connected sites. */
export async function disconnectWalletConnect(): Promise<void> {
  if (!walletConnectEnabled()) return;
  const p = await load();
  if (p.session) await p.disconnect();
}
