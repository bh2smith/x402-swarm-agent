// Browser-side x402 v2 payment client. Connects an injected wallet, builds a
// ClientEvmSigner from it (just `address` + `signTypedData` — gasless ERC-3009,
// so the user signs once and the facilitator settles on-chain), and returns a
// `fetch` that auto-pays 402 challenges.
"use client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";

// The agent prices requests on Base mainnet by default.
export const PAYMENT_NETWORK = "eip155:8453";
const BASE_MAINNET_HEX = "0x2105"; // 8453

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function injected(): Eip1193 {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  if (!eth) {
    throw new Error(
      "No wallet found. Install a Base-compatible wallet (e.g. MetaMask, Rabby).",
    );
  }
  return eth;
}

export interface Connection {
  address: `0x${string}`;
  paidFetch: typeof fetch;
}

/** Prompt the wallet, switch to Base mainnet, and return a payment-enabled fetch. */
export async function connectWallet(): Promise<Connection> {
  const eth = injected();
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts[0] as `0x${string}`;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_MAINNET_HEX }],
    });
  } catch {
    // Wallet may not have the chain / user declined — payment will surface it.
  }

  const wallet = createWalletClient({
    account: address,
    chain: base,
    transport: custom(eth),
  });

  const signer = {
    address,
    signTypedData: (msg: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      // viem validates EIP-712 shapes; x402 passes them through verbatim.
      wallet.signTypedData({
        account: address,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        domain: msg.domain as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        types: msg.types as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        primaryType: msg.primaryType as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: msg.message as any,
      }),
  };

  // Register both Base networks so the client satisfies whatever the server
  // requires (mainnet by default; testnet still works if NETWORK is changed).
  const client = new x402Client()
    .register("eip155:8453", new ExactEvmScheme(signer))
    .register("eip155:84532", new ExactEvmScheme(signer));
  const paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return { address, paidFetch };
}

/** Decode the base64 `payment-response` settlement header, if present. */
export function decodeSettlement(header: string | null): {
  success?: boolean;
  transaction?: string;
  payer?: string;
  amount?: string;
} | null {
  if (!header) return null;
  try {
    return JSON.parse(atob(header));
  } catch {
    return null;
  }
}
