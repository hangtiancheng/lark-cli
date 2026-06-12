import { z } from "zod";

export const shellExecInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});
