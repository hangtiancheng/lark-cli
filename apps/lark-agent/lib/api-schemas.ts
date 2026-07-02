import { z } from "zod/v4";

// Unified API response shape { message, data }, used by the client hook to
// parse fetch responses with zod instead of type assertions. Mirrors the
// shapes returned by the route handlers in app/api/*.

export const chatResponseSchema = z.object({
  message: z.string(),
  data: z.object({ answer: z.string() }).optional(),
});

export const aiOpsResponseSchema = z.object({
  message: z.string(),
  data: z
    .object({
      result: z.string(),
      detail: z.array(z.string()).optional(),
    })
    .optional(),
});

export const uploadResponseSchema = z.object({
  message: z.string(),
  data: z.unknown().optional(),
});
