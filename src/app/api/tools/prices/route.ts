import { NextRequest } from "next/server";
import { TokenQuerySchema } from "@/lib/schema";
import { getTokenPrice } from "./logic";
import { toolRouter } from "@/lib/route-tool";

// Receipts use bee-js (Node crypto), so this route must run on the Node runtime.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return toolRouter(request, TokenQuerySchema, getTokenPrice, "prices");
}
