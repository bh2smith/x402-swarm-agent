// Feasibility spike for the AI data-analyst loop (Claude + hosted Dune MCP).
// Exercises the full agentic loop WITHOUT the x402 paywall, to confirm the MCP
// connector auth (key in URL), table discovery, query execution, and answer.
//
//   ANTHROPIC_API_KEY=… DUNE_API_KEY=… \
//     bun run script/dune-analyst-spike.ts "How many Ethereum transactions were there yesterday?"
import { queryLlm } from "../src/app/api/tools/query/logic";

async function main() {
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "How many Ethereum transactions were there yesterday?";

  console.log(
    "prompt:",
    prompt,
    "\n(running — table discovery + Dune query can take ~30s)\n",
  );

  const result = await queryLlm({ prompt });

  console.log("\n=== ANSWER ===\n" + result.answer);
  console.log(
    `\nmodel: ${result.model} | tokens: in ${result.usage.inputTokens} / out ${result.usage.outputTokens} | est. cost ~$${result.costUsd.toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
