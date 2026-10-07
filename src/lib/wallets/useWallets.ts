"use client";

import { useCallback, useEffect, useState } from "react";
import { isMobileBrowser, walletBrowserLinks, type WalletBrowserLinks } from "./mobile";
import { connectWallet, getWallet, getWallets, subscribeWallets, type DiscoveredWallet } from "./registry";
import { loadWallets, saveWallets, watchedWallet } from "./store";
import { detectKind, normalizeAddress, sameAddress, type Wallet, type WalletAddress } from "./types";

/** Attach addresses to a connected wallet, absorbing any watched entries for the same addresses. */
function mergeConnected(wallets: Wallet[], provider: string, label: string, addresses: WalletAddress[]): Wallet[] {
  const isNew = (a: WalletAddress) => !addresses.some((b) => sameAddress(a.address, b.address));
  // Wallets saved before the registry carry "eip6963:<rdns>" ids; they are the same wallet.
  const same = (w: Wallet) => w.provider === provider || (w.mode === "connected" && getWallet(w.provider)?.key === provider);
  const rest = wallets
    .filter((w) => !same(w))
    .map((w) => (w.mode === "watched" ? { ...w, addresses: w.addresses.filter(isNew) } : w))
    .filter((w) => w.addresses.length > 0);
  const existing = wallets.find(same);
  const merged: Wallet = {
    id: existing?.id ?? `conn:${provider}`,
    mode: "connected",
    provider,
    label: existing?.label ?? label,
    addresses: [...addresses, ...(existing?.addresses.filter(isNew) ?? [])],
  };
  return [merged, ...rest];
}

export function useWallets() {
  const [wallets, setWalletsState] = useState<Wallet[]>([]);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState<DiscoveredWallet[]>([]);
  const [mobileLinks, setMobileLinks] = useState<WalletBrowserLinks | null>(null);

  const setWallets = useCallback((next: Wallet[] | ((prev: Wallet[]) => Wallet[])) => {
    setWalletsState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      saveWallets(value);
      return value;
    });
  }, []);

  useEffect(() => {
    // Persisted wallets and extension detection are only knowable in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWalletsState(loadWallets());
    setReady(true);
    setAvailable(getWallets());
    if (isMobileBrowser()) setMobileLinks(walletBrowserLinks());
    return subscribeWallets(() => setAvailable(getWallets()));
  }, []);

  const addWatched = useCallback(
    (input: string): string[] => {
      const rejected: string[] = [];
      setWallets((prev) => {
        let next = prev;
        for (const raw of input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
          if (!detectKind(raw)) {
            rejected.push(raw);
            continue;
          }
          if (next.some((w) => w.addresses.some((a) => sameAddress(a.address, raw)))) continue;
          const n = next.filter((w) => w.mode === "watched").length + 1;
          next = [...next, watchedWallet(raw, `Watched ${n}`)];
        }
        return next;
      });
      return rejected;
    },
    [setWallets],
  );

  /** Re-read the injected providers; wallet in-app browsers sometimes inject after we mount. */
  const refresh = useCallback(() => setAvailable(getWallets()), []);

  const connect = useCallback(
    async (key: string): Promise<WalletAddress[]> => {
      const info = getWallet(key);
      if (!info) throw new Error("Wallet not found.");
      const addresses = await connectWallet(info);
      setWallets((prev) => mergeConnected(prev, info.key, info.name, addresses));
      return addresses;
    },
    [setWallets],
  );

  /** Bitcoin addresses inside a multi-chain wallet get the same purpose label Phantom uses. */
  const withNote = (a: WalletAddress): WalletAddress =>
    a.kind === "bitcoin" && !a.note ? { ...a, note: a.address.startsWith("bc1p") ? "ordinals" : "payment" } : a;

  /** Attach pasted addresses to an existing wallet (e.g. a Bitcoin address Phantom won't share). */
  const addAddressesTo = useCallback(
    (walletId: string, input: string): string[] => {
      const rejected: string[] = [];
      setWallets((prev) => {
        const incoming: WalletAddress[] = [];
        for (const raw of input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
          const kind = detectKind(raw);
          if (!kind) {
            rejected.push(raw);
            continue;
          }
          const address = normalizeAddress(raw);
          if (prev.some((w) => w.id === walletId && w.addresses.some((a) => sameAddress(a.address, address)))) continue;
          incoming.push(withNote({ kind, address }));
        }
        if (incoming.length === 0) return prev;
        const taken = (a: WalletAddress) => incoming.some((b) => sameAddress(a.address, b.address));
        return prev
          .map((w) =>
            w.id === walletId
              ? { ...w, addresses: [...w.addresses, ...incoming] }
              : { ...w, addresses: w.addresses.filter((a) => !taken(a)) },
          )
          .filter((w) => w.addresses.length > 0);
      });
      return rejected;
    },
    [setWallets],
  );

  /** Fold a watched wallet into another wallet. */
  const attachWallet = useCallback(
    (fromId: string, toId: string) =>
      setWallets((prev) => {
        const from = prev.find((w) => w.id === fromId);
        if (!from || fromId === toId) return prev;
        return prev
          .filter((w) => w.id !== fromId)
          .map((w) =>
            w.id === toId
              ? { ...w, addresses: [...w.addresses, ...from.addresses.filter((a) => !w.addresses.some((b) => sameAddress(a.address, b.address))).map(withNote)] }
              : w,
          );
      }),
    [setWallets],
  );

  const rename = useCallback((id: string, label: string) => setWallets((p) => p.map((w) => (w.id === id ? { ...w, label } : w))), [setWallets]);
  const remove = useCallback((id: string) => setWallets((p) => p.filter((w) => w.id !== id)), [setWallets]);

  const walletFor = useCallback(
    (address: string) => wallets.find((w) => w.addresses.some((a) => sameAddress(a.address, address))),
    [wallets],
  );

  return {
    wallets,
    ready,
    /** Wallets installed in this browser, every chain each one speaks already folded together. */
    available,
    refresh,
    /** Set on phones and tablets: links that reopen the page inside a wallet app's browser. */
    mobileLinks,
    allAddresses: wallets.flatMap((w) => w.addresses.map((a) => a.address)),
    addWatched,
    connect,
    rename,
    remove,
    addAddressesTo,
    attachWallet,
    walletFor,
  };
}

export type WalletsApi = ReturnType<typeof useWallets>;
