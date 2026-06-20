import { NextResponse } from "next/server";
import { PLUGIN_URL } from "../../config";

// OpenAPI parameter fragments (previously imported from @bitte-ai/agent-sdk).
const addressParam = {
  name: "address",
  in: "query",
  required: true,
  description: "EVM token contract address (0x-prefixed)",
  schema: { type: "string" },
};

const chainIdParam = {
  name: "chainId",
  in: "query",
  required: true,
  description: "EVM chain ID",
  schema: { type: "number" },
};

export async function GET() {
  const pluginData = {
    openapi: "3.0.0",
    info: {
      title: "Token Data Agent",
      description: "An aggregation of curated token data from various sources.",
      version: "1.0.0",
    },
    servers: [{ url: PLUGIN_URL }],
    paths: {
      "/api/tools/prices": {
        get: {
          tags: ["prices"],
          operationId: "getPrice",
          summary: "Get token price",
          description:
            "Returns the price for a given token address and chain ID.",
          parameters: [
            { $ref: "#/components/parameters/XPaymentHeader" },
            {
              ...addressParam,
              example: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1",
            },
            { ...chainIdParam },
          ],
          responses: {
            "200": {
              description: "Price response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      price: {
                        type: "number",
                        description: "The price of the token",
                      },
                      source: {
                        type: "string",
                        description: "The source of the price data",
                      },
                    },
                    required: ["price", "source"],
                  },
                },
              },
            },
            "400": { description: "Missing parameters" },
            "402": { $ref: "#/components/responses/X402PaymentRequired" },
          },
        },
      },
    },
    components: {
      parameters: {
        XPaymentHeader: {
          name: "payment-signature",
          in: "header",
          // required: true,
          schema: {
            type: "string",
          },
          description: "Base64-encoded x402 v2 PAYMENT-SIGNATURE payload",
        },
      },
      responses: {
        X402PaymentRequired: {
          description: "Payment required via x402",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/X402PaymentRequired",
              },
            },
          },
        },
      },
      schemas: {
        X402PaymentRequired: {
          type: "object",
          properties: {
            x402Version: { type: "number", example: 2 },
            error: {
              type: "string",
              example: "PAYMENT-SIGNATURE header is required",
            },
            accepts: {
              type: "array",
              items: { $ref: "#/components/schemas/X402Accept" },
            },
          },
          required: ["x402Version", "error", "accepts"],
        },
        X402Accept: {
          type: "object",
          properties: {
            scheme: { type: "string", enum: ["exact"] },
            network: {
              type: "string",
              enum: ["eip155:8453", "eip155:84532"],
              description: "CAIP-2 network id (Base mainnet / Base Sepolia)",
            },
            maxAmountRequired: {
              type: "string",
              description: "Wei Amount of required payment (not token units)",
            },
            resource: { type: "string", format: "uri" },
            description: { type: "string" },
            mimeType: { type: "string" },
            payTo: { type: "string" },
            maxTimeoutSeconds: { type: "integer" },
            asset: { type: "string" },
            extra: {
              type: "object",
              properties: {
                name: { type: "string" },
                version: { type: "string" },
              },
              required: ["name", "version"],
            },
          },
          required: [
            "scheme",
            "network",
            "maxAmountRequired",
            "resource",
            "description",
            "mimeType",
            "payTo",
            "maxTimeoutSeconds",
            "asset",
            "extra",
          ],
        },
      },
    },
  };

  return NextResponse.json(pluginData);
}
