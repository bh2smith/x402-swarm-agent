import { Address } from "viem";
import { paymentProxy, x402ResourceServer, type Network } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { facilitator } from "@coinbase/x402";

const useCdpFacilitator = process.env.USE_CDP_FACILITATOR === "true";
const payTo = (process.env.ADDRESS ||
  "0x54F08c27e75BeA0cdDdb8aA9D69FD61551B19BbA") as Address;
// x402 v2 networks are CAIP-2 (Base mainnet = eip155:8453, Base Sepolia =
// eip155:84532). Accept legacy x402 v1 names too so older env vars keep working.
const LEGACY_NETWORKS: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
};
const rawNetwork = process.env.NETWORK || "eip155:8453";
const network = (LEGACY_NETWORKS[rawNetwork] ?? rawNetwork) as Network;

// CDP facilitator (Base mainnet) when enabled; otherwise the default
// x402.org facilitator (testnet). Reads CDP_API_KEY_ID / CDP_API_KEY_SECRET.
const facilitatorClient = new HTTPFacilitatorClient(
  useCdpFacilitator ? facilitator : undefined,
);

// Resource server with the EVM "exact" scheme (fixed-price routes) and the
// "upto" scheme (dynamic/variable pricing — used by the AI analyst endpoint,
// which bills the actual per-call cost up to a max).
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.register(network, new UptoEvmScheme());

export const proxy = paymentProxy(
  {
    "/api/tools/prices": {
      accepts: { scheme: "exact", payTo, price: "$0.001", network },
      description: "Token price endpoint",
    },
    "/api/tools/query": {
      accepts: { scheme: "upto", payTo, price: "$2.00", network },
      description:
        "AI data-analyst query (Dune Analytics) — billed for actual usage up to the max",
    },
  },
  server,
  {
    appName: "Token Price API",
    appLogo: "/x402-icon-blue.png",
  },
);

// Configure which paths the middleware should run on
export const config = {
  matcher: ["/api/tools/:path*"],
};
