/** Phones and tablets: no browser extensions, so no wallet is injected into an ordinary browser tab. */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export interface WalletBrowserLinks {
  phantom: string;
  metamask: string;
}

/**
 * Universal links that reopen this page inside a wallet app's own browser, where the wallet
 * injects its provider and the normal connect / sign flow works.
 */
export function walletBrowserLinks(): WalletBrowserLinks {
  const { origin, host, pathname } = window.location;
  const page = origin + pathname;
  return {
    phantom: `https://phantom.com/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(origin)}`,
    metamask: `https://link.metamask.io/dapp/${host}${pathname}`,
  };
}
