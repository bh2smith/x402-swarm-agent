// Minimal server-side Swarm client built on @ethersphere/bee-js (v12).
//
// This runs inside Next.js route handlers (Node runtime only — never in Edge
// middleware) to persist request/response receipts to Swarm. It deliberately
// exposes just the four primitives the receipt layer needs:
//   - uploadBytes  : store immutable data (optionally encrypted) -> reference
//   - downloadUtf8 : read data back by reference
//   - feedUpdate   : advance the receipts feed head to a reference
//   - feedHead     : read the current feed head reference (or null)
//
// Config comes from env. If BEE_FEED_PK / BEE_POSTAGE_BATCH_ID are absent the
// client reports itself unconfigured so callers can no-op gracefully rather
// than failing a paid request (receipts are best-effort, never blocking).
import { Bee, PrivateKey, Topic } from "@ethersphere/bee-js";

export interface SwarmConfig {
  url: string;
  feedPk: string;
  postageBatchId: string;
  feedTopic: string;
}

const DEFAULT_BEE_URL = "https://api.gateway.ethswarm.org";
const DEFAULT_FEED_TOPIC = "agent-receipts";
// The public Swarm gateway exposes no postage batches; passing the all-zero
// batch ID makes the gateway stamp uploads on your behalf. A dedicated Bee
// node instead needs a real BEE_POSTAGE_BATCH_ID. (Mirrors swarm-mcp.)
const DEFAULT_GATEWAY_BATCH_ID =
  "0000000000000000000000000000000000000000000000000000000000000000";

let cachedConfig: SwarmConfig | null | undefined;
let cachedBee: Bee | undefined;

/** Resolve config from env once. Returns null when the signing key is absent. */
function loadConfig(): SwarmConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const feedPk = process.env.BEE_FEED_PK;
  if (!feedPk) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    url: process.env.BEE_URL || process.env.BEE_API_URL || DEFAULT_BEE_URL,
    feedPk,
    // Defaults to the gateway batch so uploads work with only BEE_FEED_PK set.
    postageBatchId: process.env.BEE_POSTAGE_BATCH_ID || DEFAULT_GATEWAY_BATCH_ID,
    feedTopic: process.env.BEE_FEED_TOPIC || DEFAULT_FEED_TOPIC,
  };
  return cachedConfig;
}

/** True when the env is set up for Swarm writes. */
export function swarmConfigured(): boolean {
  return loadConfig() !== null;
}

function requireConfig(): SwarmConfig {
  const cfg = loadConfig();
  if (!cfg) {
    throw new Error("Swarm not configured: set BEE_FEED_PK");
  }
  return cfg;
}

function bee(): Bee {
  if (!cachedBee) cachedBee = new Bee(requireConfig().url);
  return cachedBee;
}

/** The feed owner address (derived from BEE_FEED_PK), 0x-prefixed hex. */
export function feedOwner(): string {
  return `0x${new PrivateKey(requireConfig().feedPk).publicKey().address().toHex()}`;
}

function feedTopic(): Topic {
  return Topic.fromString(requireConfig().feedTopic);
}

/**
 * Upload immutable data. With `{ encrypt: true }` the returned reference is
 * 128 hex chars (64 bytes = content address + decryption key); the bare
 * content address is the first 64 hex chars. Unencrypted references are 64 hex.
 */
export async function uploadBytes(
  data: string | Uint8Array,
  opts: { encrypt?: boolean } = {},
): Promise<string> {
  const cfg = requireConfig();
  const res = await bee().uploadData(cfg.postageBatchId, data, {
    encrypt: opts.encrypt ?? false,
  });
  return res.reference.toHex();
}

/** Download data by reference (full ref, incl. key for encrypted) as UTF-8. */
export async function downloadUtf8(reference: string): Promise<string> {
  const bytes = await bee().downloadData(reference);
  return bytes.toUtf8();
}

/** Advance the receipts feed head to point at `reference`. */
export async function feedUpdate(reference: string): Promise<void> {
  const cfg = requireConfig();
  const writer = bee().makeFeedWriter(feedTopic(), cfg.feedPk);
  await writer.uploadReference(cfg.postageBatchId, reference);
}

/** Current feed head reference (hex), or null if the feed has no updates yet. */
export async function feedHead(): Promise<string | null> {
  const cfg = requireConfig();
  const reader = bee().makeFeedReader(feedTopic(), feedOwner());
  try {
    const res = await reader.downloadReference();
    return res.reference.toHex();
  } catch {
    // No update published yet (404) — treat as empty chain.
    return null;
  }
}

/** Reset memoized config/bee (used by tests / spikes after changing env). */
export function _resetSwarmClient(): void {
  cachedConfig = undefined;
  cachedBee = undefined;
}
