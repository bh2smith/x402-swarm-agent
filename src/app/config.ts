import { DEPLOYMENT_URL } from "vercel-url";

// Plugin URL: Vercel deployment URL, else local host/port.
const PLUGIN_URL =
  DEPLOYMENT_URL ||
  `${process.env.NEXT_PUBLIC_HOST || "localhost"}:${process.env.PORT || 3000}`;

export function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value) {
    if (defaultValue) {
      return defaultValue;
    }
    throw new Error(`${key} is not set`);
  }
  return value;
}

export function getZerionKey(): string {
  return getEnvVar("ZERION_KEY");
}

export function getAlchemyKey(): string {
  return getEnvVar("ALCHEMY_KEY");
}

const SUPPORTED_NETWORKS = [
  1, // mainnet
  100, // gnosis
  137, // polygon
  8453, // base
  42161, // arbitrum
  43114, // avalanche
  11155111, // sepolia
];

export { PLUGIN_URL, SUPPORTED_NETWORKS };
