import { NextRequest, NextResponse } from "next/server";
import { setSettlementOverrides, withX402 } from "@x402/next";
import { QuerySchema } from "@/lib/schema";
import { server, QUERY_ROUTE_CONFIG } from "@/lib/x402-server";
import { queryLlm } from "./logic";

// Uses the Anthropic SDK + bee-js (receipts) and runs an agentic Dune loop that
// can take tens of seconds — Node runtime, extended duration.
export const runtime = "nodejs";
export const maxDuration = 300;

// Hard ceiling matching the route's authorized max in QUERY_ROUTE_CONFIG.
const MAX_SETTLE_USD = 2.0;

async function handler(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = QuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  let result;
  try {
    result = await queryLlm(parsed.data);
  } catch (error) {
    console.error("[query] analyst failed", error);
    // 4xx/5xx makes withX402 cancel (not settle) — a failed query isn't charged.
    return NextResponse.json({ error: "Analyst query failed" }, { status: 500 });
  }

  const payload = {
    answer: result.answer,
    model: result.model,
    usage: result.usage,
  };

  // Record a verifiable, encrypted Swarm receipt — same path as the price route.
  const headers = new Headers();
  const paymentHeader = request.headers.get("payment-signature");
  if (paymentHeader && process.env.BEE_FEED_PK) {
    try {
      const { recordOnResponse } = await import("@/lib/swarm/record");
      const receipt = await recordOnResponse({
        endpoint: "query",
        request: { prompt: parsed.data.prompt, chainId: parsed.data.chainId },
        response: payload,
        paymentHeader,
      });
      if (receipt?.responseRef) headers.set("X-RECEIPT", receipt.responseRef);
    } catch (error) {
      console.error("[swarm] receipt recording failed", error);
    }
  }

  const response = NextResponse.json(payload, { status: 200, headers });

  // Dynamic (upto) settlement: bill the actual per-call cost, capped at the max.
  // withX402 reads this header off the response and settles that amount.
  const amountUsd = Math.min(result.costUsd, MAX_SETTLE_USD);
  setSettlementOverrides(response, { amount: `$${amountUsd.toFixed(4)}` });

  return response;
}

// withX402 verifies payment first (unpaid → 402, so Claude only runs once paid),
// runs the handler, then reads setSettlementOverrides and settles the ACTUAL
// amount. A Next middleware can't do this — it never sees the handler response.
export const POST = withX402(handler, QUERY_ROUTE_CONFIG, server);
