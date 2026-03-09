// Zod validation schemas for LLMtxt dual format support
import { z } from 'zod';

// Legacy schemas (keep for backward compatibility)
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

// ===== DUAL FORMAT SCHEMAS =====

/**
 * JSON Format Schema - Validates that content is valid JSON
 * Allows any valid JSON structure (object, array, string, number, boolean, null)
 */
export const jsonFormatSchema = z.union([
  z.record(z.unknown()), // Object
  z.array(z.unknown()),  // Array
  z.string(),            // String
  z.number(),            // Number
  z.boolean(),           // Boolean
  z.null(),              // Null
]);

/**
 * Text Format Schema - Accepts any string content
 * Used for text/markdown format documents
 */
export const textFormatSchema = z.string();

/**
 * Markdown Format Schema - Accepts any string content
 */
export const markdownFormatSchema = z.string();

// ===== PREDEFINED SCHEMAS =====

/**
 * Prompt V1 Schema - Standard LLM prompt format
 * Matches OpenAI/Anthropic style chat completions
 */
export const promptMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export const promptV1Schema = z.object({
  system: z.string().optional(),
  messages: z.array(promptMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

// Schema registry for predefined schemas
export const predefinedSchemas = {
  'prompt-v1': promptV1Schema,
} as const;

export type PredefinedSchemaName = keyof typeof predefinedSchemas;

/**
 * Check if a schema name is a valid predefined schema
 */
export function isPredefinedSchema(name: string): name is PredefinedSchemaName {
  return name in predefinedSchemas;
}

/**
 * Get a predefined schema by name
 * Returns undefined if schema doesn't exist
 */
export function getPredefinedSchema(name: string): z.ZodSchema | undefined {
  return predefinedSchemas[name as PredefinedSchemaName];
}

// ===== API REQUEST SCHEMAS =====

/**
 * Schema parameter validation - validates schema name parameter
 */
export const schemaParamSchema = z
  .string()
  .refine((val) => isPredefinedSchema(val), {
    message: `Invalid schema. Must be one of: ${Object.keys(predefinedSchemas).join(', ')}`,
  })
  .optional();

/**
 * Compress Request Schema - Validates POST /api/compress body
 */
export const compressRequestSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  format: z.enum(['json', 'text', 'markdown']).optional().default('text'),
  schema: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Decompress Request Schema - Validates POST /api/decompress body
 */
export const decompressRequestSchema = z.object({
  slug: z.string().min(1, 'Document slug is required'),
});

/**
 * Search Request Schema - Validates POST /api/search body
 */
export const searchRequestSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  slugs: z.array(z.string().min(1)).min(1, 'At least one slug is required'),
});

// ===== TYPE EXPORTS =====

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type DocumentParams = z.infer<typeof documentParamsSchema>;
export type ShortIdParams = z.infer<typeof shortIdSchema>;

export type JsonFormat = z.infer<typeof jsonFormatSchema>;
export type TextFormat = z.infer<typeof textFormatSchema>;
export type MarkdownFormat = z.infer<typeof markdownFormatSchema>;
export type PromptV1 = z.infer<typeof promptV1Schema>;
export type PromptMessage = z.infer<typeof promptMessageSchema>;

export type CompressRequest = z.infer<typeof compressRequestSchema>;
export type DecompressRequest = z.infer<typeof decompressRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
