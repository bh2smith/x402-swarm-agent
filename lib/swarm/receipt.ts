// Receipt layer: turns a paid (request, payment, response) tuple into a
// tamper-evident, append-only chain on Swarm.
//
// For each paid request:
//   1. the response is uploaded ENCRYPTED -> a 64-byte reference. The full
//      reference (address + key) is handed back to the payer ONLY; the public
//      receipt records just the bare 32-byte content address as a commitment.
//   2. a public receipt JSON is uploaded and the `agent-receipts` feed head is
//      advanced to it. Each receipt embeds `prevHash` (the prior receipt's
//      reference) so the whole history is walkable from the head.
//
// The two steps are exposed separately so callers can await the (fast) encrypt
// to return the payer's reference, then fire-and-forget the (slower) chain
// append. Appends are serialized within the process so concurrent requests
// don't race on the feed head and drop links. (Cross-instance ordering is
// best-effort.)
import {
  uploadBytes,
  downloadUtf8,
  feedUpdate,
  feedHead,
  swarmConfigured,
} from "./client";

export interface PaymentInfo {
  payer?: string;
  amount?: string;
  asset?: string;
  network?: string;
  nonce?: string;
  txHash?: string;
}

export interface Receipt {
  seq: number;
  ts: string;
  endpoint: string;
  request: unknown;
  /** Bare 32-byte content address of the encrypted response (no key). */
  responseAddress: string;
  payment: PaymentInfo;
  /** Previous receipt reference, or null for the first link. */
  prevHash: string | null;
}

export interface AppendInput {
  endpoint: string;
  request: unknown;
  responseAddress: string;
  payment: PaymentInfo;
}

export interface AppendResult {
  receiptRef: string;
  receipt: Receipt;
}

export interface ReceiptResult extends AppendResult {
  /** FULL encrypting reference of the response — deliver to the payer only. */
  responseRef: string;
}

/**
 * Encrypt and upload a response. Returns the full decrypting reference (give to
 * the payer) and the bare content address (safe to publish in the receipt).
 */
export async function encryptResponse(
  response: unknown,
): Promise<{ responseRef: string; responseAddress: string }> {
  const responseRef = await uploadBytes(JSON.stringify(response), {
    encrypt: true,
  });
  return { responseRef, responseAddress: responseRef.slice(0, 64) };
}

// Serialize receipt appends within this process.
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  // Keep the chain alive regardless of individual failures.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function buildAndStore(input: AppendInput): Promise<AppendResult> {
  // Determine chain position from the current head.
  const prevHash = await feedHead();
  let seq = 0;
  if (prevHash) {
    try {
      const prev = JSON.parse(await downloadUtf8(prevHash)) as Receipt;
      seq = (prev.seq ?? 0) + 1;
    } catch {
      // Unreadable predecessor — keep linking but restart the counter.
      seq = 0;
    }
  }

  const receipt: Receipt = {
    seq,
    ts: new Date().toISOString(),
    endpoint: input.endpoint,
    request: input.request,
    responseAddress: input.responseAddress,
    payment: input.payment,
    prevHash,
  };

  const receiptRef = await uploadBytes(JSON.stringify(receipt), {});
  await feedUpdate(receiptRef);
  return { receiptRef, receipt };
}

/**
 * Append a receipt to the chain (serialized). Commits only the bare response
 * address — never the decryption key. Throws if Swarm is unconfigured; callers
 * should treat this as best-effort.
 */
export function appendReceipt(input: AppendInput): Promise<AppendResult> {
  if (!swarmConfigured()) {
    return Promise.reject(new Error("Swarm not configured"));
  }
  return enqueue(() => buildAndStore(input));
}

/** Convenience (encrypt + append, fully awaited) — used by tests/verification. */
export async function recordReceipt(input: {
  endpoint: string;
  request: unknown;
  response: unknown;
  payment: PaymentInfo;
}): Promise<ReceiptResult> {
  const { responseRef, responseAddress } = await encryptResponse(
    input.response,
  );
  const appended = await appendReceipt({
    endpoint: input.endpoint,
    request: input.request,
    responseAddress,
    payment: input.payment,
  });
  return { ...appended, responseRef };
}

/** Walk the receipt chain from the feed head, newest first (for verification). */
export async function readReceiptChain(limit = 50): Promise<Receipt[]> {
  const out: Receipt[] = [];
  let ref = await feedHead();
  while (ref && out.length < limit) {
    const receipt = JSON.parse(await downloadUtf8(ref)) as Receipt;
    out.push(receipt);
    ref = receipt.prevHash;
  }
  return out;
}
