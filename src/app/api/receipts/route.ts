import { NextResponse } from "next/server";

// Reads the Swarm receipt chain (bee-js needs the Node runtime).
export const runtime = "nodejs";

export async function GET() {
  try {
    const { readReceiptChain } = await import("@/lib/swarm/receipt");
    const { swarmConfigured, feedOwner } = await import("@/lib/swarm/client");
    if (!swarmConfigured()) {
      return NextResponse.json({ configured: false, receipts: [] });
    }
    const receipts = await readReceiptChain(25);
    return NextResponse.json({ configured: true, owner: feedOwner(), receipts });
  } catch (error) {
    // The feed may simply be empty, or Swarm unreachable — never hard-fail the UI.
    return NextResponse.json({
      configured: true,
      receipts: [],
      note: error instanceof Error ? error.message : "unavailable",
    });
  }
}
