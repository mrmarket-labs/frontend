"use client";

import { useCallback, useEffect, useState } from "react";
import { getEvmWallet, getEvmWallets, subscribeEvmWallets, type EvmWalletInfo } from "./eip6963";
import { connectPhantom, hasPhantom } from "./phantom";
import { loadWallets, saveWallets, watchedWallet } from "./store";
import { detectKind, sameAddress, type Wallet, type WalletAddress } from "./types";

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

  const connectPhantomWallet = useCallback(async () => {
    const addresses = await connectPhantom();
    setWallets((prev) => mergeConnected(prev, "phantom", "Phantom", addresses));
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
    allAddresses: wallets.flatMap((w) => w.addresses.map((a) => a.address)),
    addWatched,
    connectPhantom: connectPhantomWallet,
    connectEvm: connectEvmWallet,
    rename,
    remove,
    walletFor,
  };
}

export type WalletsApi = ReturnType<typeof useWallets>;
