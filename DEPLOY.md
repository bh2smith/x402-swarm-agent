# Deployment & Credentials

This agent is a Next.js 16 app: an x402-paywalled token-price API that writes an
encrypted, verifiable receipt of every paid request to Swarm.

Three independent subsystems each need their own credentials:

1. **Data sources** — where prices come from
2. **x402 payments** — how callers pay (USDC on Base, via the Coinbase CDP facilitator)
3. **Swarm receipts** — the signing key + storage that records each paid request

## Credentials & environment variables

Set these in `.env` (local, in this directory) and as Vercel project env vars (prod).
Secrets must be encrypted env vars — never commit them. `.env*` and `.mcp.json` are gitignored.

| Variable | Required? | What it is | Where to get it |
|---|---|---|---|
| `ALCHEMY_KEY` | recommended | Alchemy price feed key (one of several price sources; throws only if that feed is invoked) | https://dashboard.alchemy.com |
| `ZERION_KEY` | optional | Zerion price feed key (another source) | https://developers.zerion.io |
| `ADDRESS` | **yes (prod)** | Your **payTo** wallet — the address that *receives* USDC. Falls back to a placeholder if unset | any wallet address you control |
| `NETWORK` | yes | CAIP-2 network. Base mainnet `eip155:8453`, Base Sepolia `eip155:84532` | — |
| `USE_CDP_FACILITATOR` | yes (mainnet) | `"true"` to settle via Coinbase CDP (required on Base mainnet) | — |
| `CDP_API_KEY_ID` | yes (mainnet) | Coinbase Developer Platform API key id (facilitator verify/settle) | https://portal.cdp.coinbase.com |
| `CDP_API_KEY_SECRET` | yes (mainnet) | CDP API key secret | same |
| `BEE_FEED_PK` | **yes** | Private key (hex, no `0x`) that owns & signs the `agent-receipts` feed | any 32-byte key; this is the agent's Swarm identity |
| `BEE_URL` / `BEE_API_URL` | optional | Bee endpoint. Defaults to the public gateway `https://api.gateway.ethswarm.org` | your Bee node, or leave default |
| `BEE_POSTAGE_BATCH_ID` | optional | Postage stamp. Defaults to the all-zero gateway batch (the public gateway stamps for you). A dedicated Bee node needs a real funded batch | buy with BZZ on a Bee node |
| `BEE_FEED_TOPIC` | optional | Feed topic, default `agent-receipts` | — |

### Wallets you need
- **payTo wallet** (`ADDRESS`) — receives USDC. Address only; no key on the server.
- **Swarm feed key** (`BEE_FEED_PK`) — signs feed updates. On the public gateway it needs **no funds**. On a dedicated Bee node it needs BZZ (Gnosis Chain) for postage.
- **Test payer wallet** (client side only) — a funded EOA with **USDC + a little ETH for gas on Base**, used by `example/x402-payment-handler.ts` to actually pay a request. Not server config.

### External accounts
Coinbase Developer Platform (mainnet facilitator) · Alchemy (prices) · Zerion (prices, optional) · Vercel (hosting) · optionally a Bee node + BZZ for durable Swarm storage.

## Deployment plan (Vercel)

1. **Repo** — push this directory to GitHub (recommended: as a fork of `bh2smith/price-agent`). Set it as `origin`.
2. **Import to Vercel** — new project from the repo; framework auto-detects as Next.js. Build command `next build` (default).
3. **Env vars** — add all of the above for Production (and Preview). Mark `CDP_API_KEY_SECRET` and `BEE_FEED_PK` as secrets.
4. **Start on testnet first** — set `NETWORK=eip155:84532` (Base Sepolia) and `USE_CDP_FACILITATOR=false` (uses the free `x402.org` facilitator). Fund the test payer wallet from a Base Sepolia faucet + testnet USDC. Verify the whole flow, then flip to mainnet (`eip155:8453`, `USE_CDP_FACILITATOR=true`, real CDP keys).
5. **Verify after deploy**:
   - `GET /api/tools/prices?address=<token>&chainId=8453` with no payment → **402** with payment requirements.
   - Pay via `withPayment(url, payerKey)` from `example/x402-payment-handler.ts` → **200** + price + an `X-RECEIPT` header (the payer's decrypting Swarm ref).
   - Read the `agent-receipts` feed (owner = address derived from `BEE_FEED_PK`) to see the chained receipt.

## Operational notes & risks

- **Swarm durability** — the public gateway + all-zero batch is great for a demo but does **not** guarantee long-term persistence. For a real service, run a Bee node with a funded postage batch and point `BEE_URL`/`BEE_POSTAGE_BATCH_ID` at it.
- **Receipts are best-effort** — a Swarm write failure never blocks the paid response (the data still returns 200; only the receipt/`X-RECEIPT` is skipped). The route awaits one encryption upload to return the payer's ref, then writes the chain async.
- **x402 v2 only** — the server reads the `PAYMENT-SIGNATURE` header; v1 clients (`x-payment`) cannot pay it. Use the v2 client in `example/`.
- **Billing on failures** — `paymentProxy` (in `src/proxy.ts`) charges for the request even if the API returns a non-2xx. If you only want to bill successful responses, switch that route to `withX402(handler, routeConfig, server)` instead.
- **Runtime** — `/api/tools/prices` is pinned to the Node runtime (`export const runtime = "nodejs"`) because bee-js needs Node crypto. The `proxy.ts` middleware runs on Edge — keep Swarm code out of it.
- **Secrets** — `BEE_FEED_PK` currently lives in the repo-root `.mcp.json` (gitignored). Rotate to a dedicated production key for a real deployment.
