"use client";

import { useCallback, useEffect, useState } from "react";
import { getEvmWallet, getEvmWallets, subscribeEvmWallets, type EvmWalletInfo } from "./eip6963";
import { isMobileBrowser, walletBrowserLinks, type WalletBrowserLinks } from "./mobile";
import { connectPhantom, hasPhantom } from "./phantom";
import { loadWallets, saveWallets, watchedWallet } from "./store";
import { detectKind, normalizeAddress, sameAddress, type Wallet, type WalletAddress } from "./types";

/** Attach addresses to a connected wallet, absorbing any watched entries for the same addresses. */
function mergeConnected(wallets: Wallet[], provider: string, label: string, addresses: WalletAddress[]): Wallet[] {
  const isNew = (a: WalletAddress) => !addresses.some((b) => sameAddress(a.address, b.address));
  const rest = wallets
    .filter((w) => w.provider !== provider)
    .map((w) => (w.mode === "watched" ? { ...w, addresses: w.addresses.filter(isNew) } : w))
    .filter((w) => w.addresses.length > 0);
  const existing = wallets.find((w) => w.provider === provider);
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
  const [evmWallets, setEvmWallets] = useState<EvmWalletInfo[]>([]);
  const [phantomAvailable, setPhantomAvailable] = useState(false);
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
    setPhantomAvailable(hasPhantom());
    setEvmWallets(getEvmWallets());
    if (isMobileBrowser()) setMobileLinks(walletBrowserLinks());
    const unsubscribe = subscribeEvmWallets(() => setEvmWallets(getEvmWallets()));
    // Extensions inject late sometimes; look again after a beat.
    const timer = setTimeout(() => setPhantomAvailable(hasPhantom()), 800);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
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

  const connectPhantomWallet = useCallback(async (): Promise<WalletAddress[]> => {
    const addresses = await connectPhantom();
    setWallets((prev) => mergeConnected(prev, "phantom", "Phantom", addresses));
    return addresses;
  }, [setWallets]);

  const connectEvmWallet = useCallback(
    async (rdns: string) => {
      const info = getEvmWallet(rdns);
      if (!info) throw new Error("Wallet not found.");
      const accounts = (await info.provider.request({ method: "eth_requestAccounts" })) as string[];
      const addresses: WalletAddress[] = accounts.map((a) => ({ kind: "evm", address: a.toLowerCase() }));
      setWallets((prev) => mergeConnected(prev, `eip6963:${rdns}`, info.name, addresses));
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
    phantomAvailable,
    evmWallets,
    /** Set on phones and tablets: links that reopen the page inside a wallet app's browser. */
    mobileLinks,
    allAddresses: wallets.flatMap((w) => w.addresses.map((a) => a.address)),
    addWatched,
    connectPhantom: connectPhantomWallet,
    connectEvm: connectEvmWallet,
    rename,
    remove,
    addAddressesTo,
    attachWallet,
    walletFor,
  };
}

export type WalletsApi = ReturnType<typeof useWallets>;
