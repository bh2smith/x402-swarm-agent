import { z } from "zod";
import { Address, isAddress } from "viem";

const evmAddressSchema = z.custom<Address>(
  (val: unknown) => {
    return typeof val === "string" && isAddress(val, { strict: false });
  },
  {
    message: "Invalid EVM address",
  },
);

export const TokenQuerySchema = z.object({
  address: evmAddressSchema,
  chainId: z.coerce.number(),
});

export type TokenQuery = z.infer<typeof TokenQuerySchema>;

/** Body for the AI data-analyst endpoint (POST /api/tools/query). */
export const QuerySchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  chainId: z.coerce.number().optional(),
});

export type Query = z.infer<typeof QuerySchema>;

type ValidationResult<T> =
  | { ok: true; query: T }
  | { ok: false; error: string };

/** If you only need single-use validation */
export function validateQuery<S extends z.ZodTypeAny>(
  params: URLSearchParams,
  schema: S,
): ValidationResult<z.infer<S>> {
  const input = Object.fromEntries(params); // see array-safe version below
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, query: result.data }
    : { ok: false, error: result.error.message };
}
