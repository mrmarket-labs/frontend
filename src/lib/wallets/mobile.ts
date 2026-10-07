/** Phones and tablets: no browser extensions, so no wallet is injected into an ordinary browser tab. */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export type MobileWalletId = "phantom" | "okx" | "binance" | "metamask";
/** `app` is a custom-scheme deep link that only works when the app is installed; `web` is the universal link. */
export type WalletBrowserLinks = Record<MobileWalletId, { app?: string; web: string }>;

/** What each one speaks is worded by the dictionary (`connect.mobileChains`). */
export const MOBILE_WALLETS: { id: MobileWalletId; label: string }[] = [
  { id: "phantom", label: "Phantom" },
  { id: "okx", label: "OKX Wallet" },
  { id: "binance", label: "Binance Wallet" },
  { id: "metamask", label: "MetaMask" },
];

/**
 * Universal links that reopen this page inside a wallet app's own browser, where the wallet
 * injects its provider and the normal connect / sign flow works.
 */
export function walletBrowserLinks(): WalletBrowserLinks {
  const { origin, host, pathname } = window.location;
  const page = origin + pathname;
  // OKX: an okx:// deep link wrapped in the download page's universal link.
  const okxDeepLink = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(page)}`;
  // Binance: the app's mini-program router, base64 like @binance/w3w-utils' getDeepLink builds it.
  const binanceDeepLink =
    `bnc://app.binance.com/mp/app?appId=yFK5FCqYprrXDiVFbhyRx7` +
    `&startPagePath=${btoa("/pages/browser/index")}&startPageQuery=${btoa(`url=${page}&defaultChainId=1`)}`;
  return {
    phantom: { web: `https://phantom.com/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(origin)}` },
    okx: { app: okxDeepLink, web: `https://www.okx.com/download?deeplink=${encodeURIComponent(okxDeepLink)}` },
    binance: { app: binanceDeepLink, web: `https://app.binance.com/en/download?_dp=${btoa(binanceDeepLink)}` },
    metamask: { web: `https://link.metamask.io/dapp/${host}${pathname}` },
  };
}

/**
 * Prefer the app's own scheme, which launches the app directly when installed; if the page is
 * still in front after a beat, the app isn't there, so go to the universal link (the store page).
 */
export function openInWallet(link: { app?: string; web: string }): void {
  if (!link.app) {
    window.location.href = link.web;
    return;
  }
  const started = Date.now();
  const fallback = setTimeout(() => {
    if (!document.hidden && Date.now() - started < 2500) window.location.href = link.web;
  }, 1500);
  window.addEventListener("pagehide", () => clearTimeout(fallback), { once: true });
  window.location.href = link.app;
}
