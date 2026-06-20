import { NextRequest, NextResponse } from "next/server";
import { setSettlementOverrides } from "@x402/next";
import { QuerySchema } from "@/lib/schema";
import { queryLlm } from "./logic";

// Uses the Anthropic SDK + bee-js (receipts), and runs an agentic Dune loop
// that can take tens of seconds — Node runtime, extended duration.
export const runtime = "nodejs";
export const maxDuration = 300;

// Hard ceiling that matches the route's `accepts.price` max in proxy.ts.
const MAX_SETTLE_USD = 2.0;

export async function POST(request: NextRequest) {
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
    return NextResponse.json(
      { error: "Analyst query failed" },
      { status: 500 },
    );
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
  const amountUsd = Math.min(result.costUsd, MAX_SETTLE_USD);
  setSettlementOverrides(response, { amount: `$${amountUsd.toFixed(4)}` });

  return response;
}
