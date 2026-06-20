/**
 * v2 x402 client helper for exercising the paid endpoints.
 *
 * Wraps `fetch` so a `402 Payment Required` is auto-paid via an ERC-3009 USDC
 * authorization (x402 protocol v2 — the server reads the `PAYMENT-SIGNATURE`
 * header). Requires a funded EOA (USDC + a little gas) on the target network.
 *
 * This replaces the previous hand-rolled v1 signer with the official
 * `@x402/fetch` client, which can't interoperate with a v2 server otherwise.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  wrapFetchWithPayment,
  x402Client,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Network } from "@x402/core/types";

/**
 * Build a `fetch` that auto-pays x402 v2 challenges with the given signer.
 *
 * @param privateKey 0x-prefixed EOA key holding USDC (+ gas) on `network`
 * @param network CAIP-2 network the resource is priced on (default Base mainnet)
 */
export function makePaidFetch(
  privateKey: `0x${string}`,
  network: Network = "eip155:8453",
) {
  const signer = privateKeyToAccount(privateKey);
  const client = new x402Client().register(network, new ExactEvmScheme(signer));
  return wrapFetchWithPayment(fetch, client);
}

/**
 * GET a paid URL, auto-handling the 402 + payment. Logs the decoded settlement
 * (`PAYMENT-RESPONSE`) and the Swarm receipt ref (`X-RECEIPT`) when present.
 */
export async function withPayment(
  url: string,
  privateKey: `0x${string}`,
  network?: Network,
): Promise<Response> {
  const paidFetch = makePaidFetch(privateKey, network);
  const response = await paidFetch(url);

  const settlement = response.headers.get("payment-response");
  if (settlement) {
    console.log("settlement:", decodePaymentResponseHeader(settlement));
  }
  const receipt = response.headers.get("x-receipt");
  if (receipt) {
    console.log("swarm receipt (decrypting ref):", receipt);
  }
  return response;
}
