// Shared x402 resource server + route config. Used by both the price-route
// middleware (src/proxy.ts) and the analyst route's withX402 wrapper
// (src/app/api/tools/query/route.ts). The "upto" (dynamic) scheme only settles
// the actual amount when the route is wrapped with withX402 — a Next middleware
// can't see the handler's setSettlementOverrides, so it would settle the max.
import { Address } from "viem";
import { x402ResourceServer, type Network } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { facilitator } from "@coinbase/x402";

const useCdpFacilitator = process.env.USE_CDP_FACILITATOR === "true";

export const payTo = (process.env.ADDRESS ||
  "0x54F08c27e75BeA0cdDdb8aA9D69FD61551B19BbA") as Address;

// x402 v2 networks are CAIP-2 (Base mainnet = eip155:8453). Accept legacy v1
// names too so older env vars keep working.
const LEGACY_NETWORKS: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
};
const rawNetwork = process.env.NETWORK || "eip155:8453";
export const network = (LEGACY_NETWORKS[rawNetwork] ?? rawNetwork) as Network;

const facilitatorClient = new HTTPFacilitatorClient(
  useCdpFacilitator ? facilitator : undefined,
);

// Resource server with the EVM "exact" (fixed price) and "upto" (dynamic)
// schemes registered on the eip155:* wildcard.
export const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.register("eip155:*" as Network, new UptoEvmScheme());

// Route config for the analyst endpoint (passed to withX402 in the route).
export const QUERY_ROUTE_CONFIG = {
  accepts: { scheme: "upto" as const, payTo, price: "$2.00", network },
  description:
    "AI data-analyst query (Dune Analytics) — billed for actual usage up to the max",
};
