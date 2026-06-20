// Receipt layer: turns a paid (request, payment, response) tuple into a
// tamper-evident, append-only chain on Swarm.
//
// For each paid request:
//   1. the response is uploaded ENCRYPTED -> a 64-byte reference. The full
//      reference (address + key) is returned to the payer ONLY; the public
//      receipt records just the bare 32-byte content address as a commitment.
//   2. a public receipt JSON is uploaded and the `agent-receipts` feed head is
//      advanced to it. Each receipt embeds `prevHash` (the prior receipt's
//      reference) so the whole history is walkable from the head.
//
// Writes are serialized within the process so concurrent requests don't race
// on the feed head and drop links. (Cross-instance ordering is best-effort.)
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

export interface ReceiptInput {
  endpoint: string;
  request: unknown;
  response: unknown;
  payment: PaymentInfo;
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

export interface ReceiptResult {
  /** Reference of the receipt stored at the feed head. */
  receiptRef: string;
  /** FULL encrypting reference of the response — deliver to the payer only. */
  responseRef: string;
  receipt: Receipt;
}

// Serialize receipt writes within this process.
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

async function buildAndStore(input: ReceiptInput): Promise<ReceiptResult> {
  // 1. Encrypt + upload the response.
  const responseRef = await uploadBytes(JSON.stringify(input.response), {
    encrypt: true,
  });
  const responseAddress = responseRef.slice(0, 64);

  // 2. Determine chain position from the current head.
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
    responseAddress,
    payment: input.payment,
    prevHash,
  };

  // 3. Upload the public receipt and advance the feed head.
  const receiptRef = await uploadBytes(JSON.stringify(receipt), {});
  await feedUpdate(receiptRef);

  return { receiptRef, responseRef, receipt };
}

/**
 * Record a receipt for a paid request. Resolves with the refs (the caller
 * delivers `responseRef` privately to the payer). Throws if Swarm is
 * unconfigured or the write fails — callers should treat this as best-effort.
 */
export function recordReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  if (!swarmConfigured()) {
    return Promise.reject(new Error("Swarm not configured"));
  }
  return enqueue(() => buildAndStore(input));
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
