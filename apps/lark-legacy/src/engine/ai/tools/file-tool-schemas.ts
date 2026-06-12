import { z } from "zod";

export const fileWriteInputSchema = z.object({
  content: z.string(),
  filepath: z.string().min(1),
});

export const fileReadInputSchema = z.object({
  filePath: z.string().min(1),
});

export const fileModifyInputSchema = z.object({
  filePath: z.string().min(1),
  replaceStr: z.string(),
  searchStr: z.string().min(1),
});

export const fileDeleteInputSchema = z.object({
  filePath: z.string().min(1),
});

export const dirReadInputSchema = z.object({
  dirPath: z.string().min(1).optional(),
});

export const exitInputSchema = z.object({
  reason: z.string().optional(),
});
