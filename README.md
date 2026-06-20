# x402 Swarm Agent

A token-data API that is **paywalled with [x402](https://x402.org) (USDC on Base)** and writes an
**encrypted, verifiable receipt of every paid request to [Swarm](https://www.ethswarm.org/)**.

Pay a few hundredths of a cent in USDC, get a token price back, and a tamper-evident record of
`(payer, payment, request, response)` is appended to an on-Swarm, append-only chain — with the response
stored encrypted so only the paying caller can read it.

**Live:** https://x402-swarm-agent.vercel.app
&nbsp;·&nbsp; **Swagger UI:** https://x402-swarm-agent.vercel.app/

> Provenance: a clean fork of [`bh2smith/price-agent`](https://github.com/bh2smith/price-agent), with the
> Bitte coupling removed, x402 upgraded to v2 (`@x402/*`), and the Swarm receipt layer added.

## How it works

```
client ──GET /api/tools/prices──▶  x402 middleware (proxy.ts)
                                     │  no payment? → 402 PAYMENT-REQUIRED
                                     │  paid (PAYMENT-SIGNATURE)? → settle via CDP facilitator
                                     ▼
                              price handler (FeedRevolver: CoinGecko / DeFiLlama /
                                     │                      DexScreener / Alchemy / Zerion)
                                     ▼
                              encrypt response → Swarm  ─┐
                              append receipt to feed ────┤ lib/swarm
                                     │                    │
                       200 + price + X-RECEIPT ◀──────────┘  (payer's decrypting ref)
```

- **Paywall** — `src/proxy.ts` uses x402 v2 (`@x402/next` `paymentProxy` + `@x402/evm` exact scheme +
  Coinbase CDP facilitator) to charge USDC per request on Base.
- **Prices** — `lib/prices/` aggregates multiple sources with fallback (`FeedRevolver`).
- **Receipts** — `lib/swarm/` encrypts the response to Swarm, commits the bare content address in a
  public, `prevHash`-linked receipt on the `agent-receipts` feed, and returns the payer's full
  decrypting reference in the `X-RECEIPT` response header. Best-effort: a Swarm failure never blocks
  the paid response.

## Endpoints

| Route | Description |
|---|---|
| `GET /api/tools/prices?address=<token>&chainId=<id>` | x402-paywalled token price → `{ price, source }` (+ `X-RECEIPT`) |
| `POST /api/tools/query` `{ prompt }` | **AI data analyst** — a Claude agent writes & runs DuneSQL via the Dune MCP and returns a written answer. Paid with x402 `upto` (billed for actual usage). |
| `GET /api/ai-plugin` | OpenAPI 3.0 spec for the agent |
| `GET /` | Demo UI (price lookups + the analyst); Swagger at `/docs` |

## Quick start

```bash
bun install
cp .env.example .env          # fill in keys — see .env.example and DEPLOY.md
bun run dev                   # next dev on http://localhost:3000
```

Other scripts: `bun run build` · `bun run start` · `bun test` · `bun run fmt`.

### Calling a paid endpoint

A v2 client helper lives in [`example/x402-payment-handler.ts`](./example/x402-payment-handler.ts):

```ts
import { withPayment } from "./example/x402-payment-handler";

// Needs a funded EOA (USDC + a little gas) on the target network.
const res = await withPayment(
  "https://x402-swarm-agent.vercel.app/api/tools/prices?address=0x...&chainId=8453",
  process.env.PAYER_PRIVATE_KEY as `0x${string}`,
);
console.log(await res.json(), res.headers.get("x-receipt"));
```

### Verifying the receipt chain

`script/receipt-e2e.ts` records receipts and walks the chain (encryption + links + payment decode):

```bash
BEE_FEED_PK=<hex> BEE_FEED_TOPIC="e2e-$(date +%s)" bun run script/receipt-e2e.ts
```

## Configuration & deployment

All credentials (data sources, x402/CDP payments, Swarm) and a Vercel deployment plan are documented in
**[DEPLOY.md](./DEPLOY.md)**. See **[.env.example](./.env.example)** for the full env list. In short:

- **Data:** `ALCHEMY_KEY`, `ZERION_KEY` (optional — keyless sources also work)
- **Payments:** `ADDRESS` (payTo), `NETWORK` (CAIP-2, e.g. `eip155:8453`), `USE_CDP_FACILITATOR=true`,
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`
- **Receipts:** `BEE_FEED_PK` (required); `BEE_URL` / `BEE_POSTAGE_BATCH_ID` / `BEE_FEED_TOPIC` (optional;
  the public gateway works out of the box)

## Tech stack

Next.js 16 · TypeScript · x402 v2 (`@x402/next`, `@x402/core`, `@x402/evm`) · `@coinbase/x402` CDP
facilitator · viem · `@ethersphere/bee-js` (Swarm) · zod.
