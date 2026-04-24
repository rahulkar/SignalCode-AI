import { z } from "zod";

export const generateRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  context: z.object({
    filePath: z.string().min(1),
    selectionOrCaretSnippet: z.string().min(1),
    languageId: z.string().optional()
  })
});

export const telemetryRequestSchema = z.object({
  task_id: z.string().min(1),
  diff_id: z.string().min(1),
  event: z.enum(["DIFF_RENDERED", "ACCEPTED", "REJECTED", "ITERATED"]),
  timestamp: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional()
});
