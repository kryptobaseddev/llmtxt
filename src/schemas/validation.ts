// Zod validation schemas
import { z } from 'zod';

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(100000),
  metadata: z.record(z.unknown()).optional(),
});

export const documentParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

export const shortIdSchema = z.object({
  shortId: z.string().min(1).max(20),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type DocumentParams = z.infer<typeof documentParamsSchema>;
export type ShortIdParams = z.infer<typeof shortIdSchema>;
