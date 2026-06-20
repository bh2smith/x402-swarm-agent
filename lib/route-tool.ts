import { NextRequest, NextResponse } from "next/server";
import { validateQuery } from "./schema";
import z from "zod";

export async function toolRouter<S extends z.ZodTypeAny, T>(
  request: NextRequest,
  schema: S,
  handler: (input: z.infer<S>) => Promise<T> | T,
  routeName: string,
): Promise<NextResponse> {
  const url = new URL(request.url);
  const validationResult = validateQuery(url.searchParams, schema);
  if (!validationResult.ok) {
    return NextResponse.json(
      { error: validationResult.error },
      { status: 400 },
    );
  }
  console.log(`${routeName}`, validationResult.query);
  try {
    const res = await handler(validationResult.query);

    // Record a verifiable Swarm receipt for paid requests. The presence of a
    // `payment-signature` header means the x402 v2 middleware admitted a paid
    // request. bee-js is dynamically imported so unpaid/Edge paths never bundle
    // it; a failure here is best-effort and never blocks the paid response.
    const headers = new Headers();
    const paymentHeader = request.headers.get("payment-signature");
    if (paymentHeader && process.env.BEE_FEED_PK) {
      try {
        const { recordOnResponse } = await import("./swarm/record");
        const receipt = await recordOnResponse({
          endpoint: routeName,
          request: validationResult.query,
          response: res,
          paymentHeader,
        });
        if (receipt?.responseRef) headers.set("X-RECEIPT", receipt.responseRef);
      } catch (error) {
        console.error("[swarm] receipt recording failed", error);
      }
    }

    return NextResponse.json(res, { status: 200, headers });
  } catch (error) {
    // TODO: Improve Error Message.
    const publicMessage = "Internal Server Error";
    console.error(publicMessage, error);
    return NextResponse.json({ error: publicMessage }, { status: 500 });
  }
}
