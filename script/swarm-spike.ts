// Feasibility spike for the Swarm receipt layer. Run with BEE_FEED_PK set:
//   BEE_FEED_PK=<hex> bun run script/swarm-spike.ts
//
// Proves, against the configured Bee endpoint (default: public gateway):
//   1. an encrypted upload returns a 128-hex (64-byte) reference
//   2. the full reference decrypts back to the plaintext
//   3. the bare 32-byte content address does NOT yield the plaintext
//   4. a feed update advances the head and reads back the same reference
import {
  swarmConfigured,
  feedOwner,
  uploadBytes,
  downloadUtf8,
  feedUpdate,
  feedHead,
} from "../lib/swarm/client";

async function main() {
  if (!swarmConfigured()) {
    console.error("✗ Swarm not configured. Set BEE_FEED_PK (and optionally BEE_URL/BEE_POSTAGE_BATCH_ID).");
    process.exit(1);
  }

  console.log("owner address:", feedOwner());
  console.log("bee url:", process.env.BEE_URL || process.env.BEE_API_URL || "https://api.gateway.ethswarm.org");

  // 1. Encrypted upload
  const secret = JSON.stringify({ price: 1234.56, source: "spike", ts: "test" });
  const fullRef = await uploadBytes(secret, { encrypt: true });
  console.log("\n1) encrypted upload");
  console.log("   full ref   :", fullRef, `(${fullRef.length} hex chars)`);
  const bareAddress = fullRef.slice(0, 64);
  console.log("   bare addr  :", bareAddress, `(${bareAddress.length} hex chars)`);
  console.log("   encrypted? :", fullRef.length === 128 ? "yes (64 bytes)" : "NO — unexpected length");

  // 2. Full reference decrypts
  const roundTrip = await downloadUtf8(fullRef);
  console.log("\n2) decrypt via full ref:", roundTrip === secret ? "OK matches plaintext" : `MISMATCH: ${roundTrip}`);

  // 3. Bare address must not reveal plaintext
  console.log("\n3) read via bare address (expect ciphertext / failure):");
  try {
    const viaBare = await downloadUtf8(bareAddress);
    console.log("   got:", viaBare === secret ? "PLAINTEXT — encryption ineffective!" : "non-plaintext bytes (ok)");
  } catch (e) {
    console.log("   download failed (ok):", (e as Error).message.slice(0, 80));
  }

  // 4. Feed update + readback (store a plain receipt-like reference)
  const receiptRef = await uploadBytes(JSON.stringify({ seq: 0, responseAddress: bareAddress }), {});
  await feedUpdate(receiptRef);
  const head = await feedHead();
  console.log("\n4) feed update");
  console.log("   wrote head :", receiptRef);
  console.log("   read head  :", head);
  console.log("   match?     :", head === receiptRef ? "OK" : "MISMATCH");

  console.log("\n✓ spike complete");
}

main().catch((e) => {
  console.error("✗ spike failed:", e);
  process.exit(1);
});
