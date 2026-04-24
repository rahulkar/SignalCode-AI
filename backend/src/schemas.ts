import { z } from "zod";

export const generateRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  mode: z.enum(["update_selection", "insert_into_file", "create_file"]).optional(),
  context: z.object({
    filePath: z.string().min(1),
    projectRootPath: z.string().min(1).optional(),
    targetFilePath: z.string().min(1).optional(),
    selectionOrCaretSnippet: z.string(),
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
