// Bridges a paid HTTP request to the Swarm receipt layer. Kept separate from
// route-tool so it (and bee-js) is only pulled in for paid requests, via a
// dynamic import — never bundled into Edge middleware or unpaid routes.
import { encryptResponse, appendReceipt, type PaymentInfo } from "./receipt";

/**
 * Decode the base64 `X-PAYMENT` header (x402 v1 "exact" scheme) into the
 * verifiable bits we record. Returns {} on any malformed input.
 */
export function decodePayment(header: string): PaymentInfo {
  try {
    const decoded = JSON.parse(
      Buffer.from(header, "base64").toString("utf-8"),
    ) as {
      network?: string;
      payload?: {
        authorization?: { from?: string; value?: string; nonce?: string };
      };
    };
    const auth = decoded.payload?.authorization ?? {};
    return {
      payer: auth.from,
      amount: auth.value,
      nonce: auth.nonce,
      network: decoded.network,
    };
  } catch {
    return {};
  }
}

/**
 * Encrypt + store the response and kick off the receipt-chain append.
 * Awaits only the encryption (so the caller can return the payer's decrypting
 * reference); the chain append runs fire-and-forget. Returns the full
 * reference, or null if recording could not start.
 */
export async function recordOnResponse(args: {
  endpoint: string;
  request: unknown;
  response: unknown;
  xPaymentHeader: string;
}): Promise<{ responseRef: string } | null> {
  const { responseRef, responseAddress } = await encryptResponse(
    args.response,
  );
  const payment = decodePayment(args.xPaymentHeader);

  // Fire-and-forget: the paid response must not block on the chain write.
  void appendReceipt({
    endpoint: args.endpoint,
    request: args.request,
    responseAddress,
    payment,
  }).catch((e) => console.error("[swarm] appendReceipt failed", e));

  return { responseRef };
}
