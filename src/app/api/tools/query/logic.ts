// AI data-analyst loop: Claude (sonnet-4-6) + the hosted Dune MCP server.
// The Anthropic Messages API "MCP connector" runs the Dune tool loop
// server-side (discover tables -> write/run DuneSQL -> analyze), so this is a
// single API call plus pause_turn continuations. Returns the written answer and
// token usage, from which the route computes the actual x402 (upto) settlement.
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicKey, getDuneKey } from "@/src/app/config";
import type { Query } from "@/lib/schema";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;
const MAX_CONTINUATIONS = 8;

// Claude Sonnet 4.6 list pricing (USD per token).
const PRICE_IN = 3 / 1_000_000;
const PRICE_OUT = 15 / 1_000_000;
// Margin over raw Claude token cost to cover Dune credits + overhead.
const COST_MARGIN = 1.3;

const ANALYST_SYSTEM = `You are an expert on-chain blockchain data analyst with live access to Dune Analytics through MCP tools.

For each question:
1. Discover the data first — use searchTables, listBlockchains, searchTablesByContractAddress, and getTableSize to find the right tables and understand their schema before writing SQL. Do not guess table or column names.
2. Write correct DuneSQL (Trino/Presto dialect). Create the query (createDuneQuery), execute it (executeQueryById), then poll getExecutionResults until it succeeds.
3. Keep queries cheap: add explicit date filters and LIMIT, and check getTableSize before scanning large tables.
4. Read the returned rows and answer the question directly, leading with the key numbers. Surface the most relevant figures; don't dump raw tables.
5. If you created a Dune query, include its link (https://dune.com/queries/<id>) so the user can inspect or re-run it.

Be concise and factual. If the question is ambiguous or the data isn't available, say so briefly instead of guessing.`;

export interface AnalystResult {
  answer: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
  };
  /** Actual call cost in USD (Claude tokens x rate x margin) — drives upto settlement. */
  costUsd: number;
}

function extractText(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function queryLlm(q: Query): Promise<AnalystResult> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  const duneMcpUrl = `https://api.dune.com/mcp/v1?api_key=${getDuneKey()}`;

  const prompt = q.chainId
    ? `${q.prompt}\n\n(Context: the user is asking about chainId ${q.chainId}.)`
    : q.prompt;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: prompt },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let message: Anthropic.Beta.BetaMessage | undefined;

  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    message = (await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      betas: ["mcp-client-2025-11-20"],
      // The Dune MCP server runs the tool loop server-side via the connector.
      // Auth rides in the URL query (?api_key=…) since the connector is url-only.
      mcp_servers: [{ type: "url", url: duneMcpUrl, name: "dune" }],
      tools: [{ type: "mcp_toolset", mcp_server_name: "dune" }],
      // Cache the stable system + tool prefix so pause_turn continuations re-read
      // it at ~0.1x instead of re-billing it at full input price.
      system: [
        {
          type: "text",
          text: ANALYST_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
      // mcp_servers / mcp_toolset may be ahead of the installed SDK's static types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Anthropic.Beta.BetaMessage;

    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;
    cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    cacheCreateTokens += message.usage.cache_creation_input_tokens ?? 0;

    // pause_turn: the server-side MCP tool loop hit its iteration cap — continue.
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    break;
  }

  if (!message) throw new Error("no response from model");

  // Cache reads bill at ~0.1x and cache writes at ~1.25x of the input rate.
  const costUsd =
    (inputTokens * PRICE_IN +
      cacheCreateTokens * PRICE_IN * 1.25 +
      cacheReadTokens * PRICE_IN * 0.1 +
      outputTokens * PRICE_OUT) *
    COST_MARGIN;
  return {
    answer: extractText(message),
    model: MODEL,
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens },
    costUsd,
  };
}
