// End-to-end verification of the receipt layer against the live Bee endpoint.
// Records three receipts on a fresh feed topic, then walks the chain and checks
// ordering, links, encryption, and payment decoding.
//
//   BEE_FEED_PK=<hex> BEE_FEED_TOPIC="e2e-$(date +%s)" bun run script/receipt-e2e.ts
import { recordReceipt, readReceiptChain } from "../lib/swarm/receipt";
import { downloadUtf8, swarmConfigured } from "../lib/swarm/client";
import { decodePayment } from "../lib/swarm/record";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!swarmConfigured()) {
    console.error("Set BEE_FEED_PK (and ideally a fresh BEE_FEED_TOPIC).");
    process.exit(1);
  }
  console.log("topic:", process.env.BEE_FEED_TOPIC || "agent-receipts", "\n");

  // 1. Record three receipts with distinct payloads.
  const recorded = [];
  for (let i = 0; i < 3; i++) {
    const r = await recordReceipt({
      endpoint: "prices",
      request: { address: `0x${"0".repeat(39)}${i}`, chainId: 8453 },
      response: { price: 1000 + i, source: "e2e" },
      payment: { payer: `0xpayer${i}`, amount: "1000", network: "base", nonce: `0x0${i}` },
    });
    recorded.push(r);
    console.log(`  recorded #${i}: receipt=${r.receiptRef.slice(0, 12)}… response(full)=${r.responseRef.slice(0, 12)}…`);
  }
  console.log();

  // 2. Walk the chain (newest first).
  const chain = await readReceiptChain(10);
  check("chain has >= 3 receipts", chain.length >= 3, `got ${chain.length}`);

  // 3. Ordering: seq strictly decreasing by 1, newest first.
  const seqOk = chain[0].seq === chain[1].seq + 1 && chain[1].seq === chain[2].seq + 1;
  check("seq is consecutive & descending", seqOk, `${chain[0].seq},${chain[1].seq},${chain[2].seq}`);

  // 4. Links: each receipt's prevHash points at the next-older receiptRef.
  check("newest.prevHash -> middle receiptRef", chain[0].prevHash === recorded[1].receiptRef);
  check("middle.prevHash -> oldest receiptRef", chain[1].prevHash === recorded[0].receiptRef);
  check("oldest.prevHash is null (fresh feed)", chain[2].prevHash === null, String(chain[2].prevHash));

  // 5. Commitment: receipts carry the bare 32-byte address only (no key).
  check("responseAddress is bare (64 hex)", chain.every((r) => r.responseAddress.length === 64));

  // 6. Encryption: full ref decrypts; bare address does not.
  const latest = recorded[2];
  const decrypted = await downloadUtf8(latest.responseRef);
  check("full ref decrypts to response", decrypted === JSON.stringify({ price: 1002, source: "e2e" }), decrypted);
  let bareLeaks = false;
  try {
    bareLeaks = (await downloadUtf8(latest.responseRef.slice(0, 64))) === decrypted;
  } catch {
    bareLeaks = false; // download failed -> good, no leak
  }
  check("bare address does NOT reveal plaintext", !bareLeaks);

  // 7. Payment recorded.
  check("payer recorded on chain", chain[0].payment.payer === "0xpayer2", chain[0].payment.payer);

  // 8. decodePayment parses a synthetic x402 v1 header.
  const header = Buffer.from(
    JSON.stringify({ network: "base", payload: { authorization: { from: "0xabc", value: "1000", nonce: "0x01" } } }),
  ).toString("base64");
  const p = decodePayment(header);
  check("decodePayment extracts payer/amount/network", p.payer === "0xabc" && p.amount === "1000" && p.network === "base");

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ e2e failed:", e);
  process.exit(1);
});
